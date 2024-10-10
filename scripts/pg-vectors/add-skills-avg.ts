import * as schema from "../../server/db/schemas/users/schema";
import dotenv from "dotenv";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, inArray, isNull } from "drizzle-orm";
dotenv.config({ path: "../../.env" });

const pool = new Pool({ connectionString: process.env.DB_URL });
export const db = drizzle(pool, {
  schema,
});

function computeAverageEmbedding(embeddings: number[][]): number[] {
  const vectorLength = embeddings[0].length;
  const sumVector = new Array(vectorLength).fill(0);

  embeddings.forEach((embedding) => {
    for (let i = 0; i < vectorLength; i++) {
      sumVector[i] += embedding[i];
    }
  });

  return sumVector.map((val) => val / embeddings.length);
}

async function updatePersonEmbeddings(personId: string, updates: any) {
  await db
    .update(schema.people)
    .set(updates)
    .where(eq(schema.people.id, personId));
}

async function computeAndStoreAverageEmbeddingsForAllUsers() {
  const allSkills = await db.select().from(schema.skillsNew);

  console.log(`Processing ${allSkills.length} skills...`);
  for (const skill of allSkills) {
    if (skill.personIds && skill.personIds.length > 0) {
      for (const personId of skill.personIds) {
        try {
          // Get all skills for this person
          const personSkills = allSkills.filter(
            (s) => s.personIds && s.personIds.includes(personId)
          );

          // Extract vectors from these skills
          const skillEmbeddings = personSkills.map((s) => s.vector);

          if (skillEmbeddings.length > 0) {
            const averageSkillVector = computeAverageEmbedding(skillEmbeddings);

            // Update the person's record
            await updatePersonEmbeddings(personId, { averageSkillVector });
            console.log(`Updated skill embeddings for user: ${personId}`);
          } else {
            console.log(`No skill embeddings to update for user: ${personId}`);
          }
        } catch (error) {
          console.error(
            `Error updating skill embeddings for user ${personId}:`,
            error
          );
        }
      }
    }
  }
  console.log("Finished processing all users.");
}

// Execute the function
console.log("Starting the skill embedding update process...");
computeAndStoreAverageEmbeddingsForAllUsers()
  .then(() => {
    console.log("All user skill embeddings updated successfully.");
  })
  .catch((error) => {
    console.error("Error updating user skill embeddings:", error);
  })
  .finally(() => {
    console.log("Skill embedding update process completed.");
  });
