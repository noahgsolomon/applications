import { users } from "@/server/db/schemas/users/schema";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { eq } from "drizzle-orm";

export const userRouter = createTRPCRouter({
  me: protectedProcedure.query(async ({ ctx }) => {
    const user = await ctx.db
      .select()
      .from(users)
      .where(eq(users.id, ctx.session.user.id));
    return user;
  }),
});
