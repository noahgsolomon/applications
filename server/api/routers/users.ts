import { users } from "@/server/db/schemas/users/schema";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { eq } from "drizzle-orm";

export const userRouter = createTRPCRouter({
  me: publicProcedure.query(async ({ ctx }) => {
    console.log(ctx.session);

    const user = await ctx.db
      .select()
      .from(users)
      .where(eq(users.email, ctx.session?.user?.email ?? ""));
    return {
      user: user[0],
      isLoggedIn: !!ctx.session && user.length > 0,
    };
  }),
});
