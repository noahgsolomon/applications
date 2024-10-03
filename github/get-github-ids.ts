import { graphql } from "@octokit/graphql";
import * as userSchema from "../server/db/schemas/users/schema";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { RateLimiter } from "./graphql";
import { Pool } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config({ path: "../.env" });

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  throw new Error("GitHub token is required in .env file");
}

const pool = new Pool({ connectionString: process.env.DB_URL });
const db = drizzle(pool, {
  schema: {
    ...userSchema,
  },
});
const rateLimiter = new RateLimiter();

async function updateGithubIds() {
  // Fetch all GitHub users from the database where githubId is null
  const allUsers = await db
    .select({ githubLogin: userSchema.people.githubLogin })
    .from(userSchema.people)
    .where(
      and(
        isNotNull(userSchema.people.githubLogin),
        isNull(userSchema.people.githubImage),
      ),
    );

  const batchSize = 200;

  for (let i = 0; i < allUsers.length; i += batchSize) {
    const batch = allUsers.slice(i, i + batchSize);
    for (const user of batch) {
      await processUser(user as { githubLogin: string });
    }
    console.log(`Processed batch ${i / batchSize + 1}`);
  }

  console.log("Finished updating GitHub IDs for all users");
}

async function processUser(user: { githubLogin: string }) {
  console.log(`Fetching GitHub ID for user: ${user.githubLogin}`);

  const query = `
    query($login: String!) {
      user(login: $login) {
        id
        login
        avatarUrl
      }
    }
  `;

  try {
    const result: any = await rateLimiter.execute(async () => {
      return graphql<any>({
        query,
        login: user.githubLogin,
        headers: {
          authorization: `Bearer ${GITHUB_TOKEN}`,
        },
      });
    });

    if (result === null) {
      console.log(`Failed to fetch data for user: ${user.githubLogin}`);
      return;
    }

    const avatarUrl = result.user.avatarUrl as string;
    console.log(
      `Found GitHub ID for ${user.githubLogin}: Avatar URL: ${avatarUrl}`,
    );

    // Update the database with the githubId
    await db
      .update(userSchema.people)
      .set({ githubImage: avatarUrl })
      .where(
        eq(userSchema.people.githubLogin, user.githubLogin ?? "dwddwdadaf"),
      );
  } catch (error) {
    console.error(`Error processing user ${user.githubLogin}:`, error);
  }
}

// Call the function to update GitHub IDs
updateGithubIds().catch((error) =>
  console.error("Error in updateGithubIds function:", error),
);
