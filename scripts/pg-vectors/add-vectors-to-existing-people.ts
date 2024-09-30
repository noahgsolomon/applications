import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import { eq, isNull, or, and, not, exists } from "drizzle-orm/expressions";
import {
  people,
  jobTitles,
  skills,
} from "../../server/db/schemas/users/schema";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config({ path: "../../.env" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const pool = new Pool({ connectionString: process.env.DB_URL });
const db = drizzle(pool, {
  schema: { people, jobTitles, skills },
});

const API_KEY = process.env.SOCIAL_DATA_API_KEY;

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

async function updateLocationVector(
  personId: string,
  normalizedLocation: string | null,
  location: string | null,
  linkedinData: any,
) {
  let chosenLocation: string | null = null;

  if (
    normalizedLocation &&
    normalizedLocation.trim() !== "" &&
    normalizedLocation.trim().toUpperCase() !== "UNKNOWN"
  ) {
    chosenLocation = normalizedLocation.trim();
  } else if (
    normalizedLocation &&
    normalizedLocation.trim().toUpperCase() === "UNKNOWN" &&
    linkedinData?.location
  ) {
    chosenLocation = linkedinData.location.trim();
  } else if (
    location &&
    location.trim() !== "" &&
    location.trim().toUpperCase() !== "UNKNOWN"
  ) {
    chosenLocation = location.trim();
  }

  if (!chosenLocation || chosenLocation.toUpperCase() === "UNKNOWN") {
    console.log(
      `[updateLocationVector] No valid location found for person ID: ${personId}`,
    );
    return;
  }

  try {
    const locationVector = await getEmbedding(chosenLocation);
    await db
      .update(people)
      .set({ locationVector })
      .where(eq(people.id, personId));
    console.log(
      `[updateLocationVector] Updated location vector for person ID: ${personId}`,
    );
  } catch (error) {
    console.error(
      `[updateLocationVector] Failed to update location vector for person ID: ${personId}`,
      error,
    );
  }
}

async function insertJobTitle(personId: string, title: string) {
  try {
    const titleVector = await getEmbedding(title);
    await db.insert(jobTitles).values({
      personId: personId,
      title: title,
      vector: titleVector,
    });
    console.log(
      `[insertJobTitle] Inserted job title "${title}" for person ID: ${personId}`,
    );
  } catch (error) {
    console.error(
      `[insertJobTitle] Failed to insert job title "${title}" for person ID: ${personId}`,
      error,
    );
  }
}

async function insertSkill(personId: string, skill: string) {
  try {
    const skillVector = await getEmbedding(skill);
    await db.insert(skills).values({
      personId: personId,
      skill: skill,
      vector: skillVector,
    });
    console.log(
      `[insertSkill] Inserted skill "${skill}" for person ID: ${personId}`,
    );
  } catch (error) {
    console.error(
      `[insertSkill] Failed to insert skill "${skill}" for person ID: ${personId}`,
      error,
    );
  }
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

async function updateMissingVectors() {
  console.log("[updateMissingVectors] Starting update process...");

  const unprocessedPeople = await db
    .select()
    .from(people)
    .where(
      and(
        isNull(people.locationVector),
        not(
          exists(
            db
              .select()
              .from(jobTitles)
              .where(eq(jobTitles.personId, people.id)),
          ),
        ),
        not(
          exists(
            db.select().from(skills).where(eq(skills.personId, people.id)),
          ),
        ),
      ),
    );

  console.log(
    `[updateMissingVectors] Found ${unprocessedPeople.length} people without locationVector`,
  );

  const batches = chunkArray(unprocessedPeople, 100);

  for (const batch of batches) {
    await Promise.all(
      batch.map(async (person) => {
        console.log(
          `[updateMissingVectors] Processing person ID: ${person.id}`,
        );
        await updateLocationVector(
          person.id,
          person.normalizedLocation,
          person.location,
          person.linkedinData,
        );

        if (Array.isArray(person.jobTitles) && person.jobTitles.length > 0) {
          for (const title of person.jobTitles) {
            await insertJobTitle(person.id, title);
          }
        }

        if (
          Array.isArray(person.topTechnologies) &&
          person.topTechnologies.length > 0
        ) {
          for (const skill of person.topTechnologies) {
            await insertSkill(person.id, skill);
          }
        }
      }),
    );
  }

  console.log("[updateMissingVectors] Update process completed.");
}

updateMissingVectors()
  .then(() => {
    console.log("[updateMissingVectors] Script finished successfully.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("[updateMissingVectors] Error during update:", error);
    process.exit(1);
  });
