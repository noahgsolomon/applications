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

export async function mostCommonSkills(companyId: string) {
  const company = await db.query.company.findFirst({
    where: eq(userSchema.company.id, companyId),
    with: {
      candidates: {
        where: eq(userSchema.candidates.isEngineer, true),
      },
    },
  });

  if (!company || !company.candidates) {
    throw new Error("Company or candidates not found.");
  }

  const techFrequencyMap: Record<string, number> = {};
  const featuresFrequencyMap: Record<string, number> = {};

  company.candidates.forEach((candidate) => {
    candidate.topTechnologies?.forEach((tech: string) => {
      techFrequencyMap[tech] = (techFrequencyMap[tech] || 0) + 1;
    });

    candidate.topFeatures?.forEach((feature: string) => {
      featuresFrequencyMap[feature] = (featuresFrequencyMap[feature] || 0) + 1;
    });
  });

  const topTechnologies = Object.entries(techFrequencyMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map((entry) => entry[0]);

  const topFeatures = Object.entries(featuresFrequencyMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map((entry) => entry[0]);

  console.log(`10 most common technologies: ${topTechnologies}`);
  console.log(`10 most common features: ${topFeatures}`);

  return {
    topTechnologies,
    topFeatures,
  };
}

mostCommonSkills("afcd9bd7-cd6c-40c1-ac2a-2c0101571bb5");
