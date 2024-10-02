import { skills, skillsNew } from "../../server/db/schemas/users/schema";
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

async function migrateSkills() {
  const batchSize = 1000;
  let cursor = "lost-and-found";
  let hasMore = true;

  while (hasMore) {
    const skillsBatch = await db
      .select({
        skill: sql<string>`LOWER(TRIM(${skills.skill}))`,
        personId: skills.personId,
        vector: skills.vector,
      })
      .from(skills)
      .where(cursor ? gt(skills.skill, cursor) : undefined)
      .limit(batchSize)
      .orderBy(asc(skills.skill));

    if (skillsBatch.length === 0) {
      hasMore = false;
      continue;
    }

    // Group skills by uppercase skill name
    const groupedSkills = skillsBatch.reduce(
      (acc, curr) => {
        const skill = curr.skill.toLowerCase().trim();
        if (!acc[skill] || !acc[skill].vector || !acc[skill].personIds) {
          acc[skill] = { personIds: [], vector: curr.vector };
        }
        acc[skill].personIds.push(curr.personId);
        return acc;
      },
      {} as Record<string, { personIds: string[]; vector: unknown }>,
    );

    // Prepare batch operations
    const insertBatch = [];
    const updateBatch: { id: number; personIds: string[] }[] = [];

    for (const [skill, data] of Object.entries(groupedSkills)) {
      // Check if the skill already exists
      const existingSkill = await db
        .select({ id: skillsNew.id, personIds: skillsNew.personIds })
        .from(skillsNew)
        .where(
          sql`LOWER(TRIM(${skillsNew.skill})) = ${skill.toLowerCase().trim()}`,
        )
        .limit(1);

      if (existingSkill.length > 0) {
        // If skill exists, prepare update operation
        const combinedPersonIds = Array.from(
          new Set([...(existingSkill[0].personIds ?? []), ...data.personIds]),
        );
        updateBatch.push({
          id: existingSkill[0].id,
          personIds: combinedPersonIds,
        });
      } else {
        // If skill doesn't exist, prepare insert operation
        insertBatch.push({
          skill: skill,
          personIds: data.personIds,
          vector: data.vector as number[],
        });
      }
    }

    // Perform batch insert
    if (insertBatch.length > 0) {
      await db.insert(skillsNew).values(insertBatch);
    }

    // Perform batch update
    if (updateBatch.length > 0) {
      await db.transaction(async (tx) => {
        for (const update of updateBatch) {
          await tx
            .update(skillsNew)
            .set({ personIds: update.personIds })
            .where(sql`id = ${update.id}`);
        }
      });
    }

    cursor = skillsBatch[skillsBatch.length - 1]?.skill;
    const processedCount = skillsBatch.length;
    const totalProcessed = cursor
      ? await db
          .select({ count: sql<number>`count(*)` })
          .from(skills)
          .where(gt(skills.skill, cursor))
          .then((result) => result[0].count)
      : 0;
    console.log(
      `Processed ${processedCount} skills. Total processed: ${totalProcessed}. Last skill: ${cursor}`,
    );
  }

  console.log("Migration completed");
}

migrateSkills().catch(console.error);
