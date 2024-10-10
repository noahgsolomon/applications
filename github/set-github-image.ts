import * as dotenv from "dotenv";
import * as userSchema from "../server/db/schemas/users/schema";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { promises as fs } from "fs";
import { eq } from "drizzle-orm";

dotenv.config({ path: "../.env" });

const pool = new Pool({ connectionString: process.env.DB_URL });
export const db = drizzle(pool, {
  schema: userSchema,
});

const updateUser = async (row: string) => {
  const imageMatch = row.match(/github_image='([^']+)'/);
  const loginMatch = row.match(/github_login='([^']+)'/);

  if (imageMatch && loginMatch) {
    const githubImage = imageMatch[1];
    const githubLogin = loginMatch[1];

    await db
      .update(userSchema.people)
      .set({ githubImage })
      .where(eq(userSchema.people.githubLogin, githubLogin));
    console.log("Updated", githubLogin);
  } else {
    console.warn("Skipping invalid row:", row);
  }
};

const main = async () => {
  try {
    const sqlContent = await fs.readFile("get-github.sql", "utf-8");
    const rows = sqlContent.trim().split("\n");

    const updatePromises = rows.map((row) => () => updateUser(row));
    await Promise.all(updatePromises.map((fn) => fn()));

    console.log("All updates completed successfully");
  } catch (error) {
    console.error("Error updating GitHub images:", error);
    throw error;
  }
};

main()
  .then(() => {
    console.log("Done");
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
