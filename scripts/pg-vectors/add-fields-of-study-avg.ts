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
  const allFieldsOfStudy = await db.select().from(schema.fieldsOfStudy);

  console.log(`Processing ${allFieldsOfStudy.length} fields of study...`);
  for (const field of allFieldsOfStudy) {
    if (field.personIds && field.personIds.length > 0) {
      for (const personId of field.personIds) {
        try {
          // Get all fields of study for this person
          const personFields = allFieldsOfStudy.filter(
            (f) => f.personIds && f.personIds.includes(personId)
          );

          // Extract vectors from these fields of study
          const fieldEmbeddings = personFields.map((f) => f.vector);

          if (fieldEmbeddings.length > 0) {
            const averageFieldOfStudyVector =
              computeAverageEmbedding(fieldEmbeddings);

            // Update the person's record
            await updatePersonEmbeddings(personId, {
              averageFieldOfStudyVector,
            });
            console.log(
              `Updated field of study embeddings for user: ${personId}`
            );
          } else {
            console.log(
              `No field of study embeddings to update for user: ${personId}`
            );
          }
        } catch (error) {
          console.error(
            `Error updating field of study embeddings for user ${personId}:`,
            error
          );
        }
      }
    }
  }
  console.log("Finished processing all users.");
}

// Execute the function
console.log("Starting the field of study embedding update process...");
computeAndStoreAverageEmbeddingsForAllUsers()
  .then(() => {
    console.log("All user field of study embeddings updated successfully.");
  })
  .catch((error) => {
    console.error("Error updating user field of study embeddings:", error);
  })
  .finally(() => {
    console.log("Field of study embedding update process completed.");
  });
