import { graphql } from "@octokit/graphql";
import * as userSchema from "../server/db/schemas/users/schema";
import { drizzle } from "drizzle-orm/neon-serverless";
import { eq, isNull } from "drizzle-orm";
import { RateLimiter } from "./graphql";
import { Pool } from "@neondatabase/serverless";

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

async function updateLinkedInUrls() {
  // Fetch all GitHub users from the database
  const allUsers = await db
    .select()
    .from(userSchema.githubUsers)
    .where(isNull(userSchema.githubUsers.linkedinUrl));

  for (const user of allUsers) {
    console.log(`Fetching LinkedIn URL for user: ${user.login}`);

    const query = `
      query($login: String!) {
        user(login: $login) {
          login
          socialAccounts(first: 10) {
            nodes {
              provider
              url
            }
          }
        }
      }
    `;

    try {
      const result: any = await rateLimiter.execute(async () => {
        return graphql<any>({
          query,
          login: user.login,
          headers: {
            authorization: `Bearer ${GITHUB_TOKEN}`,
          },
        });
      });

      if (result === null) {
        console.log(`Failed to fetch data for user: ${user.login}`);
        continue;
      }

      const linkedInAccount = result.user.socialAccounts.nodes.find(
        (account: any) => account.provider === "LINKEDIN",
      );

      let linkedinUrl = "";

      if (linkedInAccount) {
        linkedinUrl = linkedInAccount.url;
        console.log(`Found LinkedIn URL for ${user.login}: ${linkedinUrl}`);
      } else {
        console.log(`No LinkedIn URL found for ${user.login}`);
      }

      await db
        .update(userSchema.githubUsers)
        .set({ linkedinUrl: linkedinUrl })
        .where(eq(userSchema.githubUsers.login, user.login));
    } catch (error) {
      console.error(`Error processing user ${user.login}:`, error);
    }
  }

  console.log("Finished updating LinkedIn URLs for all users");
}

// Call the function to update LinkedIn URLs
updateLinkedInUrls().catch((error) =>
  console.error("Error in updateLinkedInUrls function:", error),
);
