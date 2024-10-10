import * as schema from "../../server/db/schemas/users/schema";
import dotenv from "dotenv";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, inArray, isNull } from "drizzle-orm";
dotenv.config({ path: "../../.env" });

const pool = new Pool({ connectionString: process.env.DB_URL });
export const db = drizzle(pool, {
  schema,
});

function computeAverageEmbedding(embeddings: number[][]): number[] {
  const vectorLength = embeddings[0].length;
  const sumVector = new Array(vectorLength).fill(0);

  embeddings.forEach((embedding) => {
    for (let i = 0; i < vectorLength; i++) {
      sumVector[i] += embedding[i];
    }
  });

  return sumVector.map((val) => val / embeddings.length);
}

async function updatePersonEmbeddings(personId: string, updates: any) {
  await db
    .update(schema.people)
    .set(updates)
    .where(eq(schema.people.id, personId));
}

async function computeAndStoreAverageEmbeddingsForAllUsers() {
  const allJobTitles = await db.select().from(schema.jobTitlesVectorNew);

  console.log(`Processing ${allJobTitles.length} job titles...`);
  for (const jobTitle of allJobTitles) {
    if (jobTitle.personIds && jobTitle.personIds.length > 0) {
      for (const personId of jobTitle.personIds) {
        try {
          // Get all job titles for this person
          const personJobTitles = allJobTitles.filter(
            (jt) => jt.personIds && jt.personIds.includes(personId)
          );

          // Extract vectors from these job titles
          const jobTitleEmbeddings = personJobTitles.map((jt) => jt.vector);

          if (jobTitleEmbeddings.length > 0) {
            const averageJobTitleVector =
              computeAverageEmbedding(jobTitleEmbeddings);

            // Update the person's record
            await updatePersonEmbeddings(personId, { averageJobTitleVector });
            console.log(`Updated job title embeddings for user: ${personId}`);
          } else {
            console.log(
              `No job title embeddings to update for user: ${personId}`
            );
          }
        } catch (error) {
          console.error(
            `Error updating job title embeddings for user ${personId}:`,
            error
          );
        }
      }
    }
  }
  console.log("Finished processing all users.");
}

// Execute the function
console.log("Starting the job title embedding update process...");
computeAndStoreAverageEmbeddingsForAllUsers()
  .then(() => {
    console.log("All user job title embeddings updated successfully.");
  })
  .catch((error) => {
    console.error("Error updating user job title embeddings:", error);
  })
  .finally(() => {
    console.log("Job title embedding update process completed.");
  });
