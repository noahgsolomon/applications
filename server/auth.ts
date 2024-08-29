import NextAuth, { getServerSession, NextAuthOptions } from "next-auth";
import { db } from "@/server/db";
import CredentialsProvider from "next-auth/providers/credentials";
import { eq } from "drizzle-orm";
import { compare } from "bcrypt";
import { users } from "@/server/db/schemas/users/schema";

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      credentials: {
        email: {},
        password: {},
      },
      async authorize(credentials) {
        if (!credentials) {
          return null;
        }

        const user = await db
          .select()
          .from(users)
          .where(eq(users.email, credentials.email as string))
          .then((results) => results[0]);

        if (user) {
          const passwordCorrect = await compare(
            credentials.password as string,
            user.password ?? "",
          );

          if (passwordCorrect) {
            return { id: user.id, email: user.email, name: user.name };
          }
        }

        return null;
      },
    }),
  ],
  secret: ":3",
};

export const getServerAuthSession = () => getServerSession(authOptions);
