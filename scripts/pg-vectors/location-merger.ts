import { people, locationsVector } from "../../server/db/schemas/users/schema";
import * as userSchema from "../../server/db/schemas/users/schema";
import { gt, sql, asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config({ path: "../../.env" });

const pool = new Pool({ connectionString: process.env.DB_URL });
const db = drizzle(pool, {
  schema: {
    ...userSchema,
  },
});

async function migrateLocations() {
  const batchSize = 10000;
  let cursor = "a1935205-2247-4c04-aae1-e79b8230317a";
  let hasMore = true;

  while (hasMore) {
    const peopleBatch = await db
      .select({
        id: people.id,
        normalizedLocation: people.normalizedLocation,
        linkedinData: people.linkedinData,
        location: people.location,
        vector: people.locationVector,
      })
      .from(people)
      .where(cursor ? gt(people.id, cursor) : undefined)
      .limit(batchSize)
      .orderBy(asc(people.id));

    if (peopleBatch.length === 0) {
      hasMore = false;
      continue;
    }

    // Group locations by chosenLocation
    const groupedLocations = peopleBatch.reduce(
      (acc, curr) => {
        let chosenLocation: string | null = null;

        if (
          curr.normalizedLocation &&
          curr.normalizedLocation.trim() !== "" &&
          curr.normalizedLocation.trim().toUpperCase() !== "UNKNOWN"
        ) {
          chosenLocation = curr.normalizedLocation.trim();
        } else if (
          curr.normalizedLocation &&
          curr.normalizedLocation.trim().toUpperCase() === "UNKNOWN" &&
          (curr.linkedinData as any)?.location
        ) {
          chosenLocation = (curr.linkedinData as any).location.trim();
        } else if (
          curr.location &&
          curr.location.trim() !== "" &&
          curr.location.trim().toUpperCase() !== "UNKNOWN"
        ) {
          chosenLocation = curr.location.trim();
        }

        if (chosenLocation) {
          if (
            !acc[chosenLocation] ||
            !acc[chosenLocation].vector ||
            !acc[chosenLocation].personIds
          ) {
            acc[chosenLocation] = { personIds: [], vector: curr.vector };
          }
          acc[chosenLocation].personIds.push(curr.id);
        }

        return acc;
      },
      {} as Record<string, { personIds: string[]; vector: unknown }>,
    );

    // Prepare batch operations
    const insertBatch = [];
    const updateBatch: { id: number; personIds: string[] }[] = [];

    for (const [location, data] of Object.entries(groupedLocations)) {
      // Check if the location already exists
      const existingLocation = await db
        .select({
          id: locationsVector.id,
          personIds: locationsVector.personIds,
        })
        .from(locationsVector)
        .where(
          sql`LOWER(TRIM(${locationsVector.location})) = ${location.toLowerCase().trim()}`,
        )
        .limit(1);

      if (existingLocation.length > 0) {
        // If location exists, prepare update operation
        const combinedPersonIds = Array.from(
          new Set([
            ...(existingLocation[0].personIds ?? []),
            ...data.personIds,
          ]),
        );
        updateBatch.push({
          id: existingLocation[0].id,
          personIds: combinedPersonIds,
        });
      } else {
        // If location doesn't exist, prepare insert operation
        insertBatch.push({
          location: location,
          personIds: data.personIds,
          vector: data.vector as number[],
        });
      }
    }

    // Perform batch insert
    if (insertBatch.length > 0) {
      try {
        await db.insert(locationsVector).values(insertBatch);
      } catch (e) {}
    }

    // Perform batch update
    if (updateBatch.length > 0) {
      try {
        await db.transaction(async (tx) => {
          for (const update of updateBatch) {
            await tx
              .update(locationsVector)
              .set({ personIds: update.personIds })
              .where(sql`id = ${update.id}`);
          }
        });
      } catch (e) {}
    }

    cursor = peopleBatch[peopleBatch.length - 1]?.id;
    console.log(
      `Processed ${peopleBatch.length} people. Last processed ID: ${cursor}`,
    );
  }

  console.log("Location migration completed");
}

migrateLocations().catch(console.error);
