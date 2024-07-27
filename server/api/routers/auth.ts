import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { z } from "zod";
import { hash } from "bcryptjs";
import { users } from "@/server/db/schemas/users/schema";
import { getServerAuthSession } from "@/server/auth";

export const authRouter = createTRPCRouter({
  getSession: publicProcedure.query(async ({ ctx }) => {
    const session = await getServerAuthSession();
    return session;
  }),
  secret: protectedProcedure.query(async ({ ctx }) => {
    return "secret";
  }),
  register: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string().min(6),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const { email, password } = input;
      console.log(email, password);

      const hashedPassword = await hash(password, 10);

      try {
        await ctx.db.insert(users).values({
          email,
          password: hashedPassword,
        });
        return { message: "success", email, password };
      } catch (e) {
        console.log({ e });
        throw new Error("Error creating user");
      }
    }),
});
