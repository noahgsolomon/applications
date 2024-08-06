import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  candidates,
  outbound,
  outboundCandidates,
  pendingOutbound,
} from "@/server/db/schemas/users/schema";
//@ts-ignore
import { v4 as uuid } from "uuid";
import OpenAI from "openai";
import { desc, eq, InferSelectModel, ne } from "drizzle-orm";
import { Resource } from "sst";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const client = new SQSClient();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export const outboundRouter = createTRPCRouter({
  deletePendingOutbound: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(pendingOutbound)
        .where(eq(pendingOutbound.id, input.id));
    }),
  searches: protectedProcedure.query(async ({ ctx }) => {
    const result: (InferSelectModel<typeof outbound> & {
      candidates: (InferSelectModel<typeof candidates> & {
        workedInPosition: boolean;
        workedAtRelevant: boolean;
        similarity: number;
        weight: number;
        matched: boolean;
      })[];
      matches: (InferSelectModel<typeof candidates> & {
        workedInPosition: boolean;
        workedAtRelevant: boolean;
        similarity: number;
        weight: number;
        matched: boolean;
      })[];
    })[] = [];

    // Fetch all outbound entries
    const outboundEntries = await ctx.db.query.outbound.findMany({
      orderBy: [desc(outbound.createdAt)],
    });

    for (const o of outboundEntries) {
      // Fetch related candidates through the junction table
      const outboundCandidatesEntries =
        await ctx.db.query.outboundCandidates.findMany({
          with: {
            candidate: true,
          },
          where: eq(outboundCandidates.outboundId, o.id),
        });

      // Combine candidate details with outboundCandidates details
      const candidates = outboundCandidatesEntries.map((entry) => ({
        ...entry.candidate,
        workedInPosition: entry.workedInPosition,
        workedAtRelevant: entry.workedAtRelevant,
        similarity: entry.similarity,
        weight: entry.weight,
        matched: entry.matched ?? false, // Default to false if null
      }));

      const matchedCandidates = candidates.filter(
        (candidate) => candidate.matched,
      );

      result.push({
        ...o,
        candidates,
        matches: matchedCandidates,
      });
    }

    return result;
  }),
  pollPendingOutbound: protectedProcedure
    .input(z.object({ existingPendingOutboundId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const pendingOutboundRecord = await ctx.db
        .select()
        .from(pendingOutbound)
        .where(eq(pendingOutbound.id, input.existingPendingOutboundId))
        .then((results) => results[0]);

      if (!pendingOutboundRecord) {
        throw new Error("Pending outbound not found.");
      }

      return pendingOutboundRecord;
    }),
  existingPendingOutbound: protectedProcedure.query(async ({ ctx }) => {
    const existingPendingOutbound = await ctx.db.select().from(pendingOutbound);
    return {
      existing: existingPendingOutbound.length > 0,
      id:
        existingPendingOutbound.length > 0 ? existingPendingOutbound[0].id : -1,
    };
  }),
  isValidOutbound: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ ctx, input }) => {
      console.log("");
    }),
  addOutboundRequest: protectedProcedure
    .input(
      z.object({
        query: z.string(),
        job: z.string(),
        nearBrooklyn: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const completion = await openai.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `
You generate search queries for Whop, a consumer tech platform. Given a job description or instructions, return a JSON object with three attributes: "isValid" (true or false), "booleanSearch" (a concise boolean string for search), and ;company" (the company name or "Big Tech" if unclear). The job should be the job title or skills mentioned in query or "Software Engineer" if unclear.

- If the query clearly indicates a job title or company, set "isValid" to true. Otherwise, set it to false.

Ensure the boolean search string includes:
- The company name first
- The job title
- Key skills from the query

Return the answer as a JSON object with "isValid", "booleanSearch", "job", and "company". Don't add backslashes in the query
      `,
          },
          {
            role: "user",
            content: input.query,
          },
        ],
        response_format: { type: "json_object" },
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 256,
      });

      console.log("Condition response received.");
      const response = JSON.parse(
        completion.choices[0].message.content ?? '{ "isValid": false }',
      );

      const isValid = response.isValid;

      if (!isValid) {
        return { isValid };
      }

      console.log(JSON.stringify(response, null, 2));

      const uuidId = uuid();
      await ctx.db.insert(pendingOutbound).values({
        id: uuidId,
        job: response.job,
        company: response.company,
        query: input.query,
        progress: 0,
        status: "Starting scrape",
        userId: ctx.user_id,
        outboundId: uuid(),
        nearBrooklyn: input.nearBrooklyn,
        booleanSearch:
          response.booleanSearch + (input.nearBrooklyn ? " AND New York" : ""),
        logs: "",
      });

      await client.send(
        new SendMessageCommand({
          QueueUrl: Resource.WhopQueue.url,
          MessageBody: JSON.stringify({
            pendingOutboundId: uuidId,
          }),
        }),
      );

      return { isValid };
    }),
});
