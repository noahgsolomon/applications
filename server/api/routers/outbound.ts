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
import { eq, ne } from "drizzle-orm";
import { Resource } from "sst";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const client = new SQSClient();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export const outboundRouter = createTRPCRouter({
  searches: protectedProcedure.query(async ({ ctx }) => {
    const outboundSearch = await ctx.db.query.outbound.findMany({
      with: {
        candidates: true,
      },
    });
    return outboundSearch;
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
        You are a boolean string builder optimized for generating search queries for Whop, a consumer tech platform. When given a job description or set of instructions, return a JSON object with three attributes: "isValid" (true or false), "booleanSearch" (a boolean string for search), and "company" (the company name or "Big Tech" if unclear).

        - If the query is understandable and clearly indicates a job title or company, set "isValid" to true. Otherwise, set it to false.

        Remember, you should try to make the boolean expression as concise and small as possible and all boolean searches should include the company if it's expressed in the query as the first part and also covering things like any technical skills from the query, and other things in the query...

        Ensure each bucket includes all common, uncommon, and rare keyword variations, and never have more than four separate buckets.
        Return the answer as a valid JSON object with "isValid" (boolean), "booleanSearch" (string if isValid is true), and "company" (string).
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
