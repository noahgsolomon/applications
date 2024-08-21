import * as userSchema from "../server/db/schemas/users/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";

dotenv.config({
  path: "../.env",
});

const connection = neon(process.env.DB_URL!);

const db = drizzle(connection, {
  schema: {
    ...userSchema,
  },
});

async function computeTopTechnologies(companyId: string) {
  const companyDb = await db.query.company.findFirst({
    with: {
      candidates: {
        where: eq(userSchema.candidates.isEngineer, true),
      },
    },
    where: eq(userSchema.company.id, companyId),
  });

  if (!companyDb) return;

  const techFrequencyMap: Record<string, number> = {};

  companyDb.candidates.forEach((candidate) => {
    candidate.topTechnologies?.forEach((tech: string) => {
      techFrequencyMap[tech] = (techFrequencyMap[tech] || 0) + 1;
    });
  });

  const topTechnologies = Object.entries(techFrequencyMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map((entry) => entry[0]);

  await db
    .update(userSchema.company)
    .set({ topTechnologies })
    .where(eq(userSchema.company.id, companyId));

  console.log(`Updated company ${companyId} with top technologies.`);
}

async function main() {
  const companiesList = await db.query.company.findMany();

  for (const company of companiesList) {
    await computeTopTechnologies(company.id);
  }

  console.log("All companies updated with top technologies.");
}

main().catch((error) => {
  console.error("Error updating companies:", error);
});
