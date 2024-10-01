import {
  companiesVectorNew,
  companiesVector,
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

async function migrateCompanies() {
  const batchSize = 1000;
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore) {
    const companiesBatch = await db
      .select({
        company: sql<string>`LOWER(TRIM(${companiesVector.company}))`,
        personId: companiesVector.personId,
        vector: companiesVector.vector,
      })
      .from(companiesVector)
      .where(cursor ? gt(companiesVector.company, cursor) : undefined)
      .limit(batchSize)
      .orderBy(asc(companiesVector.company));

    if (companiesBatch.length === 0) {
      hasMore = false;
      continue;
    }

    // Group companies by lowercase company name
    const groupedCompanies = companiesBatch.reduce(
      (acc, curr) => {
        const company = curr.company.toLowerCase().trim();
        if (!acc[company] || !acc[company].vector || !acc[company].personIds) {
          acc[company] = { personIds: [], vector: curr.vector };
        }
        acc[company].personIds.push(curr.personId);
        return acc;
      },
      {} as Record<string, { personIds: string[]; vector: unknown }>,
    );

    // Prepare batch operations
    const insertBatch = [];
    const updateBatch: { id: number; personIds: string[] }[] = [];

    for (const [company, data] of Object.entries(groupedCompanies)) {
      // Check if the company already exists
      const existingCompany = await db
        .select({
          id: companiesVectorNew.id,
          personIds: companiesVectorNew.personIds,
        })
        .from(companiesVectorNew)
        .where(
          sql`LOWER(TRIM(${companiesVectorNew.company})) = ${company.toLowerCase().trim()}`,
        )
        .limit(1);

      if (existingCompany.length > 0) {
        // If company exists, prepare update operation
        const combinedPersonIds = Array.from(
          new Set([...(existingCompany[0].personIds ?? []), ...data.personIds]),
        );
        updateBatch.push({
          id: existingCompany[0].id,
          personIds: combinedPersonIds,
        });
      } else {
        // If company doesn't exist, prepare insert operation
        insertBatch.push({
          company: company,
          personIds: data.personIds,
          vector: data.vector as number[],
        });
      }
    }

    // Perform batch insert
    if (insertBatch.length > 0) {
      await db.insert(companiesVectorNew).values(insertBatch);
    }

    // Perform batch update
    if (updateBatch.length > 0) {
      await db.transaction(async (tx) => {
        for (const update of updateBatch) {
          await tx
            .update(companiesVectorNew)
            .set({ personIds: update.personIds })
            .where(sql`id = ${update.id}`);
        }
      });
    }

    cursor = companiesBatch[companiesBatch.length - 1]?.company;
    const processedCount = companiesBatch.length;
    const totalProcessed = cursor
      ? await db
          .select({ count: sql<number>`count(*)` })
          .from(companiesVector)
          .where(gt(companiesVector.company, cursor))
          .then((result) => result[0].count)
      : 0;
    console.log(
      `Processed ${processedCount} companies. Total processed: ${totalProcessed}. Last company: ${cursor}`,
    );
  }

  console.log("Migration completed");
}

migrateCompanies().catch(console.error);
