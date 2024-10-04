import { graphql } from "@octokit/graphql";
import * as userSchema from "../server/db/schemas/users/schema";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { RateLimiter } from "./graphql";
import { Pool } from "@neondatabase/serverless";
import dotenv from "dotenv";
import fs from "fs/promises";

dotenv.config({ path: "../.env" });

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  throw new Error("GitHub token is required in .env file");
}

const pool = new Pool({
  connectionString: process.env.DB_URL,
});
const db = drizzle(pool, {
  schema: {
    ...userSchema,
  },
});
const rateLimiter = new RateLimiter();

async function updateGithubIds() {
  console.log("Starting to update GitHub IDs");

  const allUsers = await db
    .select({ githubLogin: userSchema.people.githubLogin })
    .from(userSchema.people)
    .where(
      and(
        isNotNull(userSchema.people.githubLogin),
        isNull(userSchema.people.githubImage)
      )
    )
    .limit(100000);

  console.log(`Found ${allUsers.length} users to process`);

  const concurrencyLimit = 100;
  const chunkedUsers = chunkArray(allUsers, concurrencyLimit);

  for (const userChunk of chunkedUsers) {
    await Promise.all(
      userChunk.map(async (user) => {
        try {
          await processUser(user as { githubLogin: string });
          console.log(`Successfully processed user: ${user.githubLogin}`);
        } catch (error) {
          console.error(`Error processing user ${user.githubLogin}:`, error);
        }
      })
    );
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log("Finished updating GitHub IDs for all users");
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

async function processUser(user: { githubLogin: string }) {
  console.log(`Fetching GitHub ID for user: ${user.githubLogin}`);
  await new Promise((resolve) => setTimeout(resolve, 1000));

  try {
    const result: any = await rateLimiter.execute(async () => {
      return graphql<any>({
        query: `
        query($login: String!) {
          user(login: $login) {
            id
            login
            avatarUrl
          }
        }
      `,
        login: user.githubLogin,
        headers: {
          authorization: `Bearer ${GITHUB_TOKEN}`,
        },
      });
    });

    console.log(`Result:`, result);

    const avatarUrl = result.user.avatarUrl as string;
    console.log(
      `Found GitHub ID for ${user.githubLogin}: Avatar URL: ${avatarUrl}`
    );

    // Write SQL statement to file instead of updating the database
    const sqlStatement = `update people set github_image='${avatarUrl}' where github_login='${user.githubLogin}';\n`;
    await fs.appendFile("get-github.sql", sqlStatement);
    console.log(`SQL statement written for ${user.githubLogin}`);
  } catch (error) {
    console.error(`Error processing user ${user.githubLogin}:`, error);
  }
}

// Call the function to update GitHub IDs
updateGithubIds().catch((error) =>
  console.error("Error in updateGithubIds function:", error)
);
