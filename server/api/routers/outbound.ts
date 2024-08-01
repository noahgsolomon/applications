import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { pendingOutbound } from "@/server/db/schemas/users/schema";
//@ts-ignore
import { v4 as uuid } from "uuid";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const outboundRouter = createTRPCRouter({
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
            content:
              'You are to return a valid parseable JSON object with one attribute "condition" which can either be true or false. All questions users ask will always be able to be answered in a yes or no. An example response would be { "isValid": true}',
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
      const isValid = JSON.parse(
        completion.choices[0].message.content ?? '{ "isValid": false }',
      ).isValid;

      if (!isValid) {
        return { isValid };
      }

      await ctx.db.insert(pendingOutbound).values({
        job: input.job,
        query: input.query,
        progress: 0,
        status: "Starting scrape",
        userId: ctx.user_id,
        outboundId: uuid(),
        nearBrooklyn: input.nearBrooklyn,
      });

      await fetch(ctx.hono_url, {
        method: "POST",
        body: JSON.stringify(input),
      });
    }),
  hono: protectedProcedure.query(async ({ ctx }) => {
    const res = await fetch(ctx.hono_url);
    const jsonResponse = await res.json();
    return {
      message: jsonResponse.message as string,
    };
  }),
});
