import * as userSchema from "../server/db/schemas/users/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import dotenv from "dotenv";
import { eq, InferSelectModel } from "drizzle-orm";
import { InferResultType } from "@/utils/infer";

dotenv.config({
  path: "../.env",
});

const connection = neon(process.env.DB_URL!);

const db = drizzle(connection, {
  schema: {
    ...userSchema,
  },
});

export async function findCompaniesWithTopTechnologyOrFeature(
  techOrFeature: string,
) {
  const companiesList = await db.query.company.findMany();
  const companies: InferResultType<"company", { candidates: true }>[] = [];
  for (const company of companiesList) {
    const companyDb = await db.query.company.findFirst({
      with: {
        candidates: {
          where: eq(userSchema.candidates.isEngineer, true),
        },
      },
      where: eq(userSchema.company.id, company.id),
    });
    companies.push(companyDb!);
  }

  const matchingCompanies: string[] = [];

  for (const company of companies) {
    const techFrequencyMap: Record<string, number> = {};
    const featuresFrequencyMap: Record<string, number> = {};

    company.candidates.forEach((candidate) => {
      candidate.topTechnologies?.forEach((tech: string) => {
        techFrequencyMap[tech] = (techFrequencyMap[tech] || 0) + 1;
      });

      candidate.topFeatures?.forEach((feature: string) => {
        featuresFrequencyMap[feature] =
          (featuresFrequencyMap[feature] || 0) + 1;
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

    if (
      topTechnologies.includes(techOrFeature) ||
      topFeatures.includes(techOrFeature)
    ) {
      matchingCompanies.push(company.name);
    }
  }

  console.log(
    `Companies with ${techOrFeature} in their top 10 technologies or features:`,
  );
  console.log(matchingCompanies);

  return matchingCompanies;
}

findCompaniesWithTopTechnologyOrFeature("Notifications");
