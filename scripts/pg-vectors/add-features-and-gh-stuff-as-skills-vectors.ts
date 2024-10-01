import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import { eq, isNotNull, or } from "drizzle-orm/expressions";
import { people, skills } from "../../server/db/schemas/users/schema";
import dotenv from "dotenv";
import OpenAI from "openai";

// Load environment variables from .env file
dotenv.config({ path: "../../.env" });

// Initialize OpenAI with your API key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// Initialize database connection
const pool = new Pool({ connectionString: process.env.DB_URL });
const db = drizzle(pool, {
  schema: { people, skills },
});

// Function to generate embeddings using OpenAI
async function getEmbedding(text: string): Promise<number[]> {
  const input = text.replace(/\n/g, " ");
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input,
  });

  if (!response.data || response.data.length === 0) {
    throw new Error("No embedding returned from OpenAI API");
  }

  return response.data[0].embedding;
}

// Function to compute cosine similarity between two vectors
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  const dotProduct = vecA.reduce((sum, a, idx) => sum + a * vecB[idx], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return magnitudeA && magnitudeB ? dotProduct / (magnitudeA * magnitudeB) : 0;
}

// Function to insert or upsert a skill into the skills table
async function upsertSkill(personId: string, skill: string) {
  try {
    const skillVector = await getEmbedding(skill);
    await db
      .insert(skills)
      .values({
        personId: personId,
        skill: skill,
        vector: skillVector,
      })
      .onConflictDoNothing(); // Prevent duplicate entries based on uniqueSkillPerPerson
    console.log(
      `[upsertSkill] Inserted/upserted skill "${skill}" for person ID: ${personId}`,
    );
  } catch (error) {
    console.error(
      `[upsertSkill] Failed to insert/upsert skill "${skill}" for person ID: ${personId}`,
      error,
    );
  }
}

// Utility function to chunk an array into smaller arrays of a specified size
function chunkArray<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

// Main function to upsert skills and features
async function upsertSkillsAndFeatures() {
  console.log("[upsertSkillsAndFeatures] Starting the upsert process...");

  // Step 1: Select people where githubLanguages, uniqueTopics, topFeatures are not null OR linkedinData.skills is not null
  const targetPeople = await db
    .select({
      id: people.id,
      githubLanguages: people.githubLanguages,
      uniqueTopics: people.uniqueTopics,
      topFeatures: people.topFeatures,
      linkedinData: people.linkedinData,
    })
    .from(people)
    .where(
      or(
        isNotNull(people.githubLanguages),
        isNotNull(people.uniqueTopics),
        isNotNull(people.topFeatures),
        isNotNull(people.linkedinData),
      ),
    );

  console.log(
    `[upsertSkillsAndFeatures] Found ${targetPeople.length} people to process.`,
  );

  if (targetPeople.length === 0) {
    console.log(
      "[upsertSkillsAndFeatures] No people found with the specified criteria.",
    );
    return;
  }

  // Step 2: Chunk the people into manageable batches (e.g., 10000 per batch)
  const batches = chunkArray(targetPeople, 10000);

  // Step 3: Process each batch sequentially
  for (const [batchIndex, batch] of batches.entries()) {
    console.log(
      `[upsertSkillsAndFeatures] Processing batch ${batchIndex + 1} of ${batches.length}...`,
    );

    // Process all people in the current batch concurrently
    await Promise.all(
      batch.map(async (person) => {
        const {
          id: personId,
          githubLanguages,
          uniqueTopics,
          topFeatures,
          linkedinData,
        } = person;

        // Upsert GitHub Languages as skills
        if (githubLanguages && typeof githubLanguages === "object") {
          const languages = Object.keys(githubLanguages);
          for (const language of languages) {
            await upsertSkill(personId, language);
          }
        }

        // Upsert Unique Topics as skills
        if (uniqueTopics && Array.isArray(uniqueTopics)) {
          for (const topic of uniqueTopics) {
            await upsertSkill(personId, topic);
          }
        }

        // Upsert Top Features as skills
        if (topFeatures && Array.isArray(topFeatures)) {
          for (const feature of topFeatures) {
            await upsertSkill(personId, feature);
          }
        }

        // Upsert LinkedIn Skills as skills
        if (linkedinData && Array.isArray((linkedinData as any).skills)) {
          for (const skill of (linkedinData as any).skills) {
            await upsertSkill(personId, skill);
          }
        }
      }),
    );

    console.log(
      `[upsertSkillsAndFeatures] Completed processing batch ${batchIndex + 1}.`,
    );
  }

  console.log(
    "[upsertSkillsAndFeatures] Upsert process completed successfully.",
  );
}

// Execute the main function
upsertSkillsAndFeatures()
  .then(() => {
    console.log("[upsertSkillsAndFeatures] Script finished successfully.");
    process.exit(0);
  })
  .catch((error) => {
    console.error(
      "[upsertSkillsAndFeatures] Error during upsert process:",
      error,
    );
    process.exit(1);
  });
