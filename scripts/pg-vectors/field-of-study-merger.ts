import { fieldsOfStudy, education } from "../../server/db/schemas/users/schema";
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

async function migrateFieldsOfStudy() {
  const batchSize = 1000;
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const fieldOfStudyBatch = await db
      .select({
        fieldOfStudy: sql<string>`LOWER(TRIM(${education.fieldOfStudy}))`,
        personId: education.personId,
        vector: education.fieldOfStudyVector,
      })
      .from(education)
      .where(
        cursor
          ? and(
              isNotNull(education.fieldOfStudy),
              gt(education.fieldOfStudy, cursor),
              or(
                isNotNull(education.fieldOfStudyVector),
                isNull(education.fieldOfStudyVector),
              ),
            )
          : and(
              isNotNull(education.fieldOfStudy),
              or(
                isNotNull(education.fieldOfStudyVector),
                isNull(education.fieldOfStudyVector),
              ),
            ),
      )
      .limit(batchSize)
      .orderBy(asc(education.fieldOfStudy));

    if (fieldOfStudyBatch.length === 0) {
      hasMore = false;
      continue;
    }

    // Group fields of study by lowercase name
    const groupedFieldsOfStudy = await Promise.all(
      fieldOfStudyBatch.map(async (curr) => {
        const field = curr.fieldOfStudy.toLowerCase().trim();
        let vector = curr.vector;
        if (!vector) {
          vector = await getEmbedding(field);
        }
        return { field, personId: curr.personId, vector };
      }),
    ).then((results) =>
      results.reduce(
        (acc, { field, personId, vector }) => {
          if (!acc[field]) {
            acc[field] = { personIds: [], vector };
          }
          acc[field].personIds.push(personId);
          return acc;
        },
        {} as Record<string, { personIds: string[]; vector: number[] }>,
      ),
    );

    // Prepare batch operations
    const insertBatch = [];
    const updateBatch: { id: number; personIds: string[] }[] = [];

    for (const [field, data] of Object.entries(groupedFieldsOfStudy)) {
      // Check if the field of study already exists
      const existingField = await db
        .select({
          id: fieldsOfStudy.id,
          personIds: fieldsOfStudy.personIds,
        })
        .from(fieldsOfStudy)
        .where(
          sql`LOWER(TRIM(${fieldsOfStudy.fieldOfStudy})) = ${field.toLowerCase().trim()}`,
        )
        .limit(1);

      if (existingField.length > 0) {
        // If field exists, prepare update operation
        const combinedPersonIds = Array.from(
          new Set([...(existingField[0].personIds ?? []), ...data.personIds]),
        );
        updateBatch.push({
          id: existingField[0].id,
          personIds: combinedPersonIds,
        });
      } else {
        // If field doesn't exist, prepare insert operation
        insertBatch.push({
          fieldOfStudy: field,
          personIds: data.personIds,
          vector: data.vector,
        });
      }
    }

    // Perform batch insert
    if (insertBatch.length > 0) {
      await db.insert(fieldsOfStudy).values(insertBatch);
    }

    // Perform batch update
    if (updateBatch.length > 0) {
      await db.transaction(async (tx) => {
        for (const update of updateBatch) {
          await tx
            .update(fieldsOfStudy)
            .set({ personIds: update.personIds })
            .where(sql`id = ${update.id}`);
        }
      });
    }

    // Update the cursor to the last processed field of study
    cursor = fieldOfStudyBatch[fieldOfStudyBatch.length - 1]?.fieldOfStudy;

    // Count the total number of fields processed so far
    const processedCount = fieldOfStudyBatch.length;
    console.log(
      `Processed ${processedCount} fields of study. Last field: ${cursor || "None"}`,
    );
  }

  console.log("Migration completed");
}

migrateFieldsOfStudy().catch(console.error);
