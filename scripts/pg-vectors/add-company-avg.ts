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
  const allCompanies = await db
    .select()
    .from(schema.companiesVectorNew)
    .limit(80000)
    .offset(40000);

  console.log(`Processing ${allCompanies.length} companies...`);
  const processedPersonIds = new Set<string>();

  for (const company of allCompanies) {
    if (company.personIds && company.personIds.length > 0) {
      for (const personId of company.personIds) {
        if (processedPersonIds.has(personId)) {
          continue;
        }

        try {
          // Check if the person already has an average company vector
          const person = await db
            .select({
              averageCompanyVector: schema.people.averageCompanyVector,
            })
            .from(schema.people)
            .where(eq(schema.people.id, personId))
            .limit(1);

          if (person.length > 0 && person[0].averageCompanyVector !== null) {
            console.log(
              `User ${personId} already has an average company vector. Skipping.`
            );
            processedPersonIds.add(personId);
            continue;
          }

          // Get all companies for this person
          const personCompanies = allCompanies.filter(
            (c) => c.personIds && c.personIds.includes(personId)
          );

          // Extract vectors from these companies
          const companyEmbeddings = personCompanies.map((c) => c.vector);

          if (companyEmbeddings.length > 0) {
            const averageCompanyVector =
              computeAverageEmbedding(companyEmbeddings);

            // Update the person's record
            await updatePersonEmbeddings(personId, { averageCompanyVector });
            console.log(`Updated embeddings for user: ${personId}`);
          } else {
            console.log(`No embeddings to update for user: ${personId}`);
          }

          processedPersonIds.add(personId);
        } catch (error) {
          console.error(
            `Error updating embeddings for user ${personId}:`,
            error
          );
        }
      }
    }
  }
  console.log(
    `Finished processing all users. Total processed: ${processedPersonIds.size}`
  );
}

// Execute the function
console.log("Starting the embedding update process...");
computeAndStoreAverageEmbeddingsForAllUsers()
  .then(() => {
    console.log("All user embeddings updated successfully.");
  })
  .catch((error) => {
    console.error("Error updating user embeddings:", error);
  })
  .finally(() => {
    console.log("Embedding update process completed.");
  });
