import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "../server/db/schemas/users/schema";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import dotenv from "dotenv";

dotenv.config({ path: "../.env" });

const pool = new Pool({ connectionString: process.env.DB_URL });
export const db = drizzle(pool, {
  schema,
});

async function main() {
  try {
    // Step 1: Fetch all GitHub users where email is not null
    const githubUsersWithEmail = await db.query.githubUsers.findMany({
      columns: {
        id: true,
        login: true,
        email: true,
      },
      where: and(
        isNotNull(schema.githubUsers.email),
        isNotNull(schema.githubUsers.login)
      ),
    });

    console.log(
      `Found ${githubUsersWithEmail.length} GitHub users with emails.`
    );

    // Create a map of GitHub login to email
    const loginToEmailMap = new Map<string, string>();
    githubUsersWithEmail.forEach((user) => {
      if (user.email) {
        loginToEmailMap.set(user.login, user.email);
      }
    });

    // Step 2: Fetch people where githubLogin matches githubUsers.login
    const githubLogins = Array.from(loginToEmailMap.keys());
    const peopleToUpdate = await db.query.people.findMany({
      columns: {
        id: true,
        githubLogin: true,
        email: true,
      },
      where: and(
        inArray(schema.people.githubLogin, githubLogins),
        isNotNull(schema.people.githubLogin)
      ),
    });

    console.log(`Found ${peopleToUpdate.length} people to update.`);

    // Step 3: Update the email column in the people table
    const updatePromises = peopleToUpdate.map(async (person) => {
      const newEmail = loginToEmailMap.get(person.githubLogin!);
      if (newEmail && newEmail !== person.email) {
        await db
          .update(schema.people)
          .set({ email: newEmail })
          .where(eq(schema.people.id, person.id));

        console.log(
          `Updated email for person ${person.id}: ${person.email} -> ${newEmail}`
        );
      }
    });

    await Promise.all(updatePromises);

    console.log("Email update process completed.");
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

main();
