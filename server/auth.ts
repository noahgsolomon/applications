import {
  getServerSession,
  type DefaultSession,
  type NextAuthOptions,
} from "next-auth";
import { db } from "@/server/db";
import { users } from "./db/schemas/users/schema";
import CredentialsProvider from "next-auth/providers/credentials";
import { eq } from "drizzle-orm";
import { compare } from "bcrypt";

/**
 * Module augmentation for `next-auth` types. Allows us to add custom properties to the `session`
 * object and keep type safety.
 *
 * @see https://next-auth.js.org/getting-started/typescript#module-augmentation
 */
declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      // ...other properties
      // role: UserRole;
    } & DefaultSession["user"];
  }

  // interface User {
  //   // ...other properties
  //   // role: UserRole;
  // }
}

/**
 * Options for NextAuth.js used to configure adapters, providers, callbacks, etc.
 *
 * @see https://next-auth.js.org/configuration/options
 */
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
          .where(eq(users.email, credentials.email))
          .then((results) => results[0]);

        const passwordCorrect = await compare(
          credentials?.password || "",
          user.password
        );

        if (user && passwordCorrect) {
          console.log("yippieee!");

          return { id: user.id, email: user.email, name: user.name };
        }

        return null;
      },
    }),
  ],
  secret: "mwrj5Ob5vR0qneAwXOTgwk7qvLfjGvohb+wUP51vs54=",
};

/**
 * Wrapper for `getServerSession` so that you don't need to import the `authOptions` in every file.
 *
 * @see https://next-auth.js.org/configuration/nextjs
 */
export const getServerAuthSession = async () => {
  return getServerSession(authOptions);
};
