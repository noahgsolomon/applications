import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import { eq, or, and, isNotNull } from "drizzle-orm/expressions";
import { people } from "../server/db/schemas/users/schema";
import dotenv from "dotenv";
import OpenAI from "openai";

// Load environment variables
dotenv.config({ path: "../.env" });

// Initialize OpenAI with API key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// Initialize the database connection
const pool = new Pool({ connectionString: process.env.DB_URL });
const db = drizzle(pool, {
  schema: { people },
});

// Utility function to chunk an array into smaller arrays of a specified size
function chunkArray<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

// Function to ask the OpenAI model a condition and parse the result
async function askCondition(condition: string): Promise<boolean> {
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          'You are to return a valid parseable JSON object with one attribute "condition" which can either be true or false. An example response would be { "condition": true }',
      },
      {
        role: "user",
        content: condition,
      },
    ],
    response_format: { type: "json_object" },
    model: "gpt-4o-mini",
    temperature: 0,
    max_tokens: 256,
  });

  const result = JSON.parse(
    completion.choices[0].message.content ?? '{ "condition": false }',
  ).condition as boolean;

  return result;
}

// Main function to update `workedInBigTech` status
async function updateBigTechStatus() {
  console.log("[updateBigTechStatus] Starting update process...");

  // Step 1: Select people who have `workedInBigTech` set to false and have either `twitterBio`, `organizations`, or `linkedinData`
  const peopleToProcess = await db
    .select()
    .from(people)
    .where(
      and(
        eq(people.workedInBigTech, false),
        or(isNotNull(people.twitterBio), isNotNull(people.organizations)),
      ),
    );

  console.log(
    `[updateBigTechStatus] Found ${peopleToProcess.length} people to process.`,
  );

  if (peopleToProcess.length === 0) {
    console.log("[updateBigTechStatus] No people found to process.");
    return;
  }

  // Step 2: Chunk the people into manageable batches (e.g., 10,000 per batch)
  const batchSize = 1000;
  const batches = chunkArray(peopleToProcess, batchSize);

  // Step 3: Process each batch sequentially
  for (const [batchIndex, batch] of batches.entries()) {
    console.log(
      `[updateBigTechStatus] Processing batch ${batchIndex + 1} of ${batches.length}...`,
    );

    // Process all people in the current batch concurrently
    await Promise.all(
      batch.map(async (person) => {
        const {
          id: personId,
          twitterBio,
          organizations,
          linkedinData,
        } = person;

        // Construct the condition string based on available data
        let conditionText = "";

        if ((linkedinData as any)?.positions?.positionHistory) {
          const companies = (linkedinData as any).positions.positionHistory.map(
            (experience: any) => experience.companyName,
          );
          conditionText += `LinkedIn Companies: ${JSON.stringify(companies, null, 2)} `;
        }

        if (twitterBio) {
          conditionText += `Twitter Bio: ${twitterBio} `;
        }

        if (organizations && Array.isArray(organizations)) {
          const orgNames = organizations.map((org: any) => org.name);
          conditionText += `GitHub Organizations: ${JSON.stringify(orgNames, null, 2)}`;
        }

        // Ask the condition using OpenAI
        const workedInBigTech = await askCondition(
          `Has this person worked in big tech? ${conditionText}`,
        );

        // Update the `workedInBigTech` status if the condition is true
        if (workedInBigTech) {
          try {
            await db
              .update(people)
              .set({ workedInBigTech: true })
              .where(eq(people.id, personId));
            console.log(
              `[updateBigTechStatus] Updated workedInBigTech for person ID: ${personId}`,
            );
          } catch (error) {
            console.error(
              `[updateBigTechStatus] Failed to update workedInBigTech for person ID: ${personId}`,
              error,
            );
          }
        }
      }),
    );

    console.log(
      `[updateBigTechStatus] Completed processing batch ${batchIndex + 1}.`,
    );
  }

  console.log("[updateBigTechStatus] Update process completed.");
}

// Execute the main function
updateBigTechStatus()
  .then(() => {
    console.log("[updateBigTechStatus] Script finished successfully.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("[updateBigTechStatus] Error during update process:", error);
    process.exit(1);
  });
