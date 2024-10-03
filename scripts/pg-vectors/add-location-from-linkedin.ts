import { and, eq, isNotNull, isNull } from "drizzle-orm";
import * as dotenv from "dotenv";
import * as userSchema from "../../server/db/schemas/users/schema";
import { locationsVector, people } from "../../server/db/schemas/users/schema";
import { Pool } from "@neondatabase/serverless";
import OpenAI from "openai";
import { drizzle } from "drizzle-orm/neon-serverless";

// Load environment variables
dotenv.config({ path: "../../.env" });

// Utility function to chunk an array into smaller arrays of a specified size
function chunk<T>(array: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(array.length / size) }, (_, index) =>
    array.slice(index * size, index * size + size),
  );
}

// Initialize OpenAI with API key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Initialize the database connection
const pool = new Pool({ connectionString: process.env.DB_URL });
const db = drizzle(pool, {
  schema: {
    ...userSchema,
  },
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

// Function to insert or update location in locationsVector table
async function upsertLocationEmbedding(
  personId: string,
  normalizedLocation: string,
) {
  try {
    const existingLocation = await db
      .select()
      .from(locationsVector)
      .where(eq(locationsVector.location, normalizedLocation))
      .limit(1);

    if (existingLocation.length > 0) {
      // Location exists, update the personIds
      const currentPersonIds = existingLocation[0].personIds || [];
      const updatedPersonIds = Array.from(
        new Set([...currentPersonIds, personId]),
      );

      await db
        .update(locationsVector)
        .set({ personIds: updatedPersonIds })
        .where(eq(locationsVector.location, normalizedLocation));

      console.log(
        `[upsertLocationEmbedding] Updated location "${normalizedLocation}" with person ID: ${personId}`,
      );
    } else {
      // Location does not exist, insert a new row
      const locationVector = await getEmbedding(normalizedLocation);

      await db
        .insert(locationsVector)
        .values({
          personIds: [personId],
          location: normalizedLocation,
          vector: locationVector,
        })
        .onConflictDoNothing();

      console.log(
        `[upsertLocationEmbedding] Inserted new location "${normalizedLocation}" with person ID: ${personId}`,
      );
    }
  } catch (error) {
    console.error(
      `[upsertLocationEmbedding] Error processing location "${normalizedLocation}" for person ID: ${personId}`,
      error,
    );
  }
}

// Function to normalize location using OpenAI
async function getNormalizedLocation(location: string): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a location normalizer. Given a location, return the uppercase state name if it's a US location, or the uppercase country name if it's outside the US. If it's a city, return the state (for US) or country it's in. If unsure or the location is invalid, return "UNKNOWN".
Examples:
- New York City -> NEW YORK
- New York -> NEW YORK
- London -> UNITED KINGDOM
- California -> CALIFORNIA
- Tokyo -> JAPAN
- Paris, France -> FRANCE
- Sydney -> AUSTRALIA
- 90210 -> CALIFORNIA
- SF, USA -> CALIFORNIA
- Earth -> UNKNOWN`,
        },
        {
          role: "user",
          content: location,
        },
      ],
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 256,
    });
    return (
      completion.choices[0].message.content?.trim().toUpperCase() || "UNKNOWN"
    );
  } catch (error) {
    console.error(`Error normalizing location for "${location}":`, error);
    return "UNKNOWN";
  }
}

// Main function to process LinkedIn data locations in batches of 100
async function processLinkedInLocations() {
  console.log("[processLinkedInLocations] Starting processing...");

  try {
    // Fetch all people with LinkedIn data having a location
    const allPeople = await db
      .select()
      .from(people)
      .where(
        and(isNotNull(people.linkedinData), isNull(people.normalizedLocation)),
      );

    console.log(
      `[processLinkedInLocations] Found ${allPeople.length} people with LinkedIn data.`,
    );

    if (allPeople.length === 0) {
      console.log("[processLinkedInLocations] No people found to process.");
      return;
    }

    // Split the list into batches of 100
    const batches = chunk(allPeople, 100);

    // Process each batch sequentially
    for (let i = 0; i < batches.length; i++) {
      console.log(
        `[processLinkedInLocations] Processing batch ${i + 1} of ${batches.length}`,
      );

      // Process each person in the current batch concurrently
      await Promise.all(
        batches[i].map(async (person) => {
          const { id: personId, linkedinData } = person;
          const location = (linkedinData as any)?.location;

          if (location) {
            const normalizedLocation = await getNormalizedLocation(location);
            await upsertLocationEmbedding(personId, normalizedLocation);
          }
        }),
      );

      console.log(
        `[processLinkedInLocations] Completed processing batch ${i + 1}`,
      );
    }

    console.log("[processLinkedInLocations] Processing completed.");
  } catch (error) {
    console.error("[processLinkedInLocations] Error during processing:", error);
  }
}

// Execute the main function
processLinkedInLocations()
  .then(() => {
    console.log("[processLinkedInLocations] Script finished successfully.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("[processLinkedInLocations] Error during processing:", error);
    process.exit(1);
  });
