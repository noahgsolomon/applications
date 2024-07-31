import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { pendingOutbound } from "@/server/db/schemas/users/schema";
//@ts-ignore
import { v4 as uuid } from "uuid";

export const outboundRouter = createTRPCRouter({
  addOutboundRequest: protectedProcedure
    .input(
      z.object({
        query: z.string(),
        job: z.string(),
        nearBrooklyn: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
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
