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
  const allSchools = await db.select().from(schema.schools);

  console.log(`Processing ${allSchools.length} schools...`);
  for (const school of allSchools) {
    if (school.personIds && school.personIds.length > 0) {
      for (const personId of school.personIds) {
        try {
          // Get all schools for this person
          const personSchools = allSchools.filter(
            (s) => s.personIds && s.personIds.includes(personId)
          );

          // Extract vectors from these schools
          const schoolEmbeddings = personSchools.map((s) => s.vector);

          if (schoolEmbeddings.length > 0) {
            const averageSchoolVector =
              computeAverageEmbedding(schoolEmbeddings);

            // Update the person's record
            await updatePersonEmbeddings(personId, { averageSchoolVector });
            console.log(`Updated school embeddings for user: ${personId}`);
          } else {
            console.log(`No school embeddings to update for user: ${personId}`);
          }
        } catch (error) {
          console.error(
            `Error updating school embeddings for user ${personId}:`,
            error
          );
        }
      }
    }
  }
  console.log("Finished processing all users.");
}

// Execute the function
console.log("Starting the school embedding update process...");
computeAndStoreAverageEmbeddingsForAllUsers()
  .then(() => {
    console.log("All user school embeddings updated successfully.");
  })
  .catch((error) => {
    console.error("Error updating user school embeddings:", error);
  })
  .finally(() => {
    console.log("School embedding update process completed.");
  });
