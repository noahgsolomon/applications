import * as schema from "../../server/db/schemas/users/schema";
import dotenv from "dotenv";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNull } from "drizzle-orm";
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

async function computeAndStoreLocationVectorsForAllUsers() {
  const allLocations = await db.select().from(schema.locationsVector);

  console.log(`Processing ${allLocations.length} locations...`);
  for (const location of allLocations) {
    if (location.personIds && location.personIds.length > 0) {
      for (const personId of location.personIds) {
        try {
          // Get all locations for this person
          const personLocations = allLocations.filter(
            (l) => l.personIds && l.personIds.includes(personId)
          );

          // Extract vectors from these locations
          const locationEmbeddings = personLocations.map((l) => l.vector);

          if (locationEmbeddings.length > 0) {
            const locationVector = computeAverageEmbedding(locationEmbeddings);

            // Update the person's record
            await updatePersonEmbeddings(personId, { locationVector });
            console.log(`Updated location vector for user: ${personId}`);
          } else {
            console.log(`No location vector to update for user: ${personId}`);
          }
        } catch (error) {
          console.error(
            `Error updating location vector for user ${personId}:`,
            error
          );
        }
      }
    }
  }
  console.log("Finished processing all users.");
}

// Execute the function
console.log("Starting the location vector update process...");
computeAndStoreLocationVectorsForAllUsers()
  .then(() => {
    console.log("All user location vectors updated successfully.");
  })
  .catch((error) => {
    console.error("Error updating user location vectors:", error);
  })
  .finally(() => {
    console.log("Location vector update process completed.");
  });
