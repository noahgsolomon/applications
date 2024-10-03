import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNotNull } from "drizzle-orm/expressions";
import * as schema from "../../server/db/schemas/users/schema";
import {
  companiesVectorNew,
  schools,
  fieldsOfStudy,
  people,
  skillsNew,
} from "../../server/db/schemas/users/schema";
import { Pool } from "@neondatabase/serverless";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config({ path: "../../.env" });

// Utility function to chunk array into smaller arrays
function chunk<T>(array: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(array.length / size) }, (_, index) =>
    array.slice(index * size, index * size + size),
  );
}

// Initialize OpenAI with API key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// Initialize the database connection
const pool = new Pool({ connectionString: process.env.DB_URL });
const db = drizzle(pool, {
  schema,
});

// Function to fetch embeddings for a given text
async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: text,
  });

  if (!response.data || response.data.length === 0) {
    throw new Error("No embedding returned from OpenAI API");
  }

  return response.data[0].embedding;
}

// Function to insert or update skill in skillsNew table
async function upsertSkillEmbedding(personId: string, skill: string) {
  try {
    // Normalize the skill to lowercase and trim
    const normalizedSkill = skill.toLowerCase().trim();

    const existingSkill = await db
      .select()
      .from(skillsNew)
      .where(eq(skillsNew.skill, normalizedSkill))
      .limit(1);

    if (existingSkill.length > 0) {
      const currentPersonIds = existingSkill[0].personIds || [];
      const updatedPersonIds = Array.from(
        new Set([...currentPersonIds, personId]),
      );

      if (
        updatedPersonIds.length === currentPersonIds.length &&
        updatedPersonIds.every((id, index) => id === currentPersonIds[index])
      ) {
        console.log(
          `[upsertSkillEmbedding] No changes for skill "${normalizedSkill}". Skipping update.`,
        );
        return;
      }

      await db
        .update(skillsNew)
        .set({ personIds: updatedPersonIds })
        .where(eq(skillsNew.skill, normalizedSkill));

      console.log(
        `[upsertSkillEmbedding] Updated skill "${normalizedSkill}" with person ID: ${personId}`,
      );
    } else {
      const skillVector = await getEmbedding(normalizedSkill);

      await db
        .insert(skillsNew)
        .values({
          personIds: [personId],
          skill: normalizedSkill,
          vector: skillVector,
        })
        .onConflictDoNothing();

      console.log(
        `[upsertSkillEmbedding] Inserted new skill "${normalizedSkill}" with person ID: ${personId}`,
      );
    }
  } catch (error) {
    console.error(
      `[upsertSkillEmbedding] Error processing skill "${skill}" for person ID: ${personId}`,
      error,
    );
  }
}

// Main function to process LinkedIn data
async function processLinkedInData() {
  console.log("[processLinkedInData] Starting processing...");

  try {
    // Fetch all people with LinkedIn data
    const allPeople = await db
      .select()
      .from(people)
      .where(isNotNull(people.linkedinData));

    console.log(
      `[processLinkedInData] Found ${allPeople.length} people with LinkedIn data.`,
    );

    if (allPeople.length === 0) {
      console.log("[processLinkedInData] No people found to process.");
      return;
    }

    // Split people into batches of 100
    const batches = chunk(allPeople, 100);

    // Process each batch
    for (let i = 0; i < batches.length; i++) {
      console.log(
        `[processLinkedInData] Processing batch ${i + 1} of ${batches.length}`,
      );
      const batch = batches[i];

      // Process each person in the batch concurrently
      await Promise.all(
        batch.map(async (person) => {
          const { id: personId, linkedinData } = person;

          // Extract skills from LinkedIn data
          const skills = ((linkedinData as any).skills || [])
            .map((s: any) => s)
            .filter(Boolean);

          // Insert or update skill embeddings
          await Promise.all(
            skills.map((skill: any) => upsertSkillEmbedding(personId, skill)),
          );
        }),
      );

      console.log(`[processLinkedInData] Completed processing batch ${i + 1}`);
    }

    console.log("[processLinkedInData] Processing completed for all batches.");
  } catch (error) {
    console.error("[processLinkedInData] Error during processing:", error);
  }
}

// Execute the main function
processLinkedInData()
  .then(() => {
    console.log("[processLinkedInData] Script finished successfully.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("[processLinkedInData] Error during processing:", error);
    process.exit(1);
  });
