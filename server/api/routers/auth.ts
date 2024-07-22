import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { z } from "zod";
import { hash } from "bcrypt";
import { getServerAuthSession } from "@/server/auth";
import { users } from "@/server/db/schemas/users/schema";

export const authRouter = createTRPCRouter({
  getSession: publicProcedure.query(async ({ ctx }) => {
    const session = await getServerAuthSession();
    console.log(ctx.session?.user.name);
    return session;
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
        return { message: "success" };
      } catch (e) {
        console.log({ e });
        throw new Error("Error creating user");
      }
    }),
});
