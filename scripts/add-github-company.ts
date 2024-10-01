import { graphql } from "@octokit/graphql";
import * as dotenv from "dotenv";
import { neon, Pool } from "@neondatabase/serverless";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import * as userSchema from "../server/db/schemas/users/schema";
import { drizzle } from "drizzle-orm/neon-serverless";
import { RateLimiter } from "@/github/graphql";

// Load environment variables
dotenv.config({ path: "../.env" });

const pool = new Pool({ connectionString: process.env.DB_URL });
const db = drizzle(pool, { schema: userSchema });

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  throw new Error("GitHub token is required in .env file");
}

const rateLimiter = new RateLimiter();

// Function to fetch the company information of a GitHub user
const fetchUserCompany = async (username: string) => {
  const query = `
    query($login: String!) {
      user(login: $login) {
        company
      }
    }
  `;

  try {
    const result = await rateLimiter.execute(() =>
      graphql({
        query,
        login: username,
        headers: {
          authorization: `Bearer ${GITHUB_TOKEN}`,
        },
      }),
    );

    return result ? (result as any).user.company : null;
  } catch (error) {
    console.error(`Error fetching company for user: ${username}`, error);
    return null;
  }
};

// Function to update the company field in the database
const updateUserCompany = async (personId: string, company: string | null) => {
  try {
    await db
      .update(userSchema.people)
      .set({
        githubCompany: company || null,
        isGithubCompanyChecked: true,
      })
      .where(eq(userSchema.people.id, personId));
    console.log(`Updated company for person ID: ${personId}`);
  } catch (error) {
    console.error(`Error updating company for person ID: ${personId}`, error);
  }
};

// Function to process a batch of users
const processBatch = async (users: any[]) => {
  for (const user of users) {
    const { id: personId, githubLogin } = user;

    // Fetch the company information from GitHub
    const company = await fetchUserCompany(githubLogin!);

    // Update the company in the database
    await updateUserCompany(personId, company);
  }
};

// Main function to process users in the database
const processUsers = async () => {
  console.log("[processUsers] Starting company update process...");

  // Fetch users from the database
  const users = await db
    .select({
      id: userSchema.people.id,
      githubLogin: userSchema.people.githubLogin,
    })
    .from(userSchema.people)
    .where(
      and(
        isNull(userSchema.people.githubCompany),
        eq(userSchema.people.isGithubCompanyChecked, false),
        isNotNull(userSchema.people.githubLogin),
      ),
    );

  console.log(`[processUsers] Found ${users.length} users to process.`);

  // Process users in batches of 1000
  const batchSize = 1000;
  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize);
    await processBatch(batch);
    console.log(`[processUsers] Processed batch ${i / batchSize + 1}`);
  }

  console.log("[processUsers] Company update process completed.");
};

// Execute the main function
processUsers()
  .then(() => {
    console.log("[processUsers] Script finished successfully.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("[processUsers] Error during processing:", error);
    process.exit(1);
  });
