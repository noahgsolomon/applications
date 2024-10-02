import {
  jobTitlesVectorNew,
  jobTitles,
} from "../../server/db/schemas/users/schema";
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

async function migrateJobTitles() {
  const batchSize = 10000;
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const jobTitlesBatch = await db
      .select({
        title: sql<string>`LOWER(TRIM(${jobTitles.title}))`,
        personId: jobTitles.personId,
        vector: jobTitles.vector,
      })
      .from(jobTitles)
      .where(cursor ? gt(jobTitles.title, cursor) : undefined)
      .limit(batchSize)
      .orderBy(asc(jobTitles.title));

    if (jobTitlesBatch.length === 0) {
      hasMore = false;
      continue;
    }

    // Group job titles by lowercase title
    const groupedJobTitles = jobTitlesBatch.reduce(
      (acc, curr) => {
        const title = curr.title.toLowerCase().trim();
        if (!acc[title] || !acc[title].vector || !acc[title].personIds) {
          acc[title] = { personIds: [], vector: curr.vector };
        }
        acc[title].personIds.push(curr.personId);
        return acc;
      },
      {} as Record<string, { personIds: string[]; vector: unknown }>,
    );

    // Prepare batch operations
    const insertBatch = [];
    const updateBatch: { id: number; personIds: string[] }[] = [];

    for (const [jobTitle, data] of Object.entries(groupedJobTitles)) {
      // Check if the job title already exists
      const existingJobTitle = await db
        .select({
          id: jobTitlesVectorNew.id,
          personIds: jobTitlesVectorNew.personIds,
        })
        .from(jobTitlesVectorNew)
        .where(
          sql`LOWER(TRIM(${jobTitlesVectorNew.jobTitle})) = ${jobTitle.toLowerCase().trim()}`,
        )
        .limit(1);

      if (existingJobTitle.length > 0) {
        // If job title exists, prepare update operation
        const combinedPersonIds = Array.from(
          new Set([
            ...(existingJobTitle[0].personIds ?? []),
            ...data.personIds,
          ]),
        );
        updateBatch.push({
          id: existingJobTitle[0].id,
          personIds: combinedPersonIds,
        });
      } else {
        // If job title doesn't exist, prepare insert operation
        insertBatch.push({
          jobTitle: jobTitle,
          personIds: data.personIds,
          vector: data.vector as number[],
        });
      }
    }

    // Perform batch insert
    if (insertBatch.length > 0) {
      await db.insert(jobTitlesVectorNew).values(insertBatch);
    }

    // Perform batch update
    if (updateBatch.length > 0) {
      await db.transaction(async (tx) => {
        for (const update of updateBatch) {
          await tx
            .update(jobTitlesVectorNew)
            .set({ personIds: update.personIds })
            .where(sql`id = ${update.id}`);
        }
      });
    }

    cursor = jobTitlesBatch[jobTitlesBatch.length - 1]?.title;
    const processedCount = jobTitlesBatch.length;
    const totalProcessed = cursor
      ? await db
          .select({ count: sql<number>`count(*)` })
          .from(jobTitles)
          .where(gt(jobTitles.title, cursor))
          .then((result) => result[0].count)
      : 0;
    console.log(
      `Processed ${processedCount} job titles. Total processed: ${totalProcessed}. Last job title: ${cursor}`,
    );
  }

  console.log("Migration completed");
}

migrateJobTitles().catch(console.error);
