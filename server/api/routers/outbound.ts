import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  candidates,
  outbound,
  pendingOutbound,
} from "@/server/db/schemas/users/schema";
//@ts-ignore
import { v4 as uuid } from "uuid";
import OpenAI from "openai";
import { eq, inArray, InferSelectModel, ne } from "drizzle-orm";
import { Resource } from "sst";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { InferResultType } from "@/utils/infer";

const client = new SQSClient();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export const outboundRouter = createTRPCRouter({
  searches: protectedProcedure.query(async ({ ctx }) => {
    const result: (InferResultType<"outbound", { candidates: true }> & {
      matches: InferSelectModel<typeof candidates>[];
    })[] = [];
    const outboundSearch = await ctx.db.query.outbound.findMany({
      with: {
        candidates: true,
      },
    });
    for (const outbound of outboundSearch) {
      const matches = await ctx.db.query.candidates.findMany({
        where: inArray(candidates.id, outbound.matched ?? []),
      });
      result.push({
        ...outbound,
        matches,
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
    const existingPendingOutbound = await ctx.db
      .select()
      .from(pendingOutbound)
      .where(ne(pendingOutbound.progress, 100));
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
You generate search queries for Whop, a consumer tech platform. Given a job description or instructions, return a JSON object with three attributes: "isValid" (true or false), "booleanSearch" (a concise boolean string for search), and ;company" (the company name or "Big Tech" if unclear).

- If the query clearly indicates a job title or company, set "isValid" to true. Otherwise, set it to false.

Ensure the boolean search string includes:
- The company name first
- The job title
- Key skills from the query

Return the answer as a JSON object with "isValid", "booleanSearch", and "company". Don't add backslashes in the query
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
        job: input.job,
        company: response.company,
        query: input.query,
        progress: 0,
        status: "Starting scrape",
        userId: ctx.user_id,
        outboundId: uuid(),
        nearBrooklyn: input.nearBrooklyn,
        booleanSearch: response.booleanSearch,
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
