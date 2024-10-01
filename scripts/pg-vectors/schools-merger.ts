import { schools, education } from "../../server/db/schemas/users/schema";
import * as userSchema from "../../server/db/schemas/users/schema";
import { gt, sql, asc, isNotNull, and, or, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config({ path: "../../.env" });

const pool = new Pool({ connectionString: process.env.DB_URL });
const db = drizzle(pool, {
  schema: {
    ...userSchema,
  },
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function getEmbedding(text: string) {
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: text,
    encoding_format: "float",
  });

  return response.data[0].embedding;
}

async function migrateSchools() {
  const batchSize = 1000;
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const schoolBatch = await db
      .select({
        school: sql<string>`LOWER(TRIM(${education.school}))`,
        personId: education.personId,
        vector: education.schoolVector,
      })
      .from(education)
      .where(
        cursor
          ? and(isNotNull(education.school), gt(education.school, cursor))
          : and(isNotNull(education.school)),
      )
      .limit(batchSize)
      .orderBy(asc(education.school));

    if (schoolBatch.length === 0) {
      hasMore = false;
      continue;
    }

    // Group schools by lowercase name
    const groupedSchools = await Promise.all(
      schoolBatch.map(async (curr) => {
        const school = curr.school.toLowerCase().trim();
        let vector = curr.vector;
        if (!vector) {
          vector = await getEmbedding(school);
        }
        return { school, personId: curr.personId, vector };
      }),
    ).then((results) =>
      results.reduce(
        (acc, { school, personId, vector }) => {
          if (!acc[school]) {
            acc[school] = { personIds: [], vector };
          }
          acc[school].personIds.push(personId);
          return acc;
        },
        {} as Record<string, { personIds: string[]; vector: number[] }>,
      ),
    );

    // Prepare batch operations
    const insertBatch = [];
    const updateBatch: { id: number; personIds: string[] }[] = [];

    for (const [school, data] of Object.entries(groupedSchools)) {
      // Check if the school already exists
      const existingSchool = await db
        .select({
          id: schools.id,
          personIds: schools.personIds,
        })
        .from(schools)
        .where(
          sql`LOWER(TRIM(${schools.school})) = ${school.toLowerCase().trim()}`,
        )
        .limit(1);

      if (existingSchool.length > 0) {
        // If school exists, prepare update operation
        const combinedPersonIds = Array.from(
          new Set([...(existingSchool[0].personIds ?? []), ...data.personIds]),
        );
        updateBatch.push({
          id: existingSchool[0].id,
          personIds: combinedPersonIds,
        });
      } else {
        // If school doesn't exist, prepare insert operation
        insertBatch.push({
          school: school,
          personIds: data.personIds,
          vector: data.vector,
        });
      }
    }

    // Perform batch insert
    if (insertBatch.length > 0) {
      await db.insert(schools).values(insertBatch);
    }

    // Perform batch update
    if (updateBatch.length > 0) {
      await db.transaction(async (tx) => {
        for (const update of updateBatch) {
          await tx
            .update(schools)
            .set({ personIds: update.personIds })
            .where(sql`id = ${update.id}`);
        }
      });
    }

    cursor = schoolBatch[schoolBatch.length - 1]?.school;
    const processedCount = schoolBatch.length;
    const totalProcessed = cursor
      ? await db
          .select({ count: sql<number>`count(*)` })
          .from(education)
          .where(gt(education.school, cursor))
          .then((result) => result[0].count)
      : 0;
    console.log(
      `Processed ${processedCount} schools. Total processed: ${totalProcessed}. Last school: ${cursor}`,
    );
  }

  console.log("Migration completed");
}

migrateSchools().catch(console.error);
