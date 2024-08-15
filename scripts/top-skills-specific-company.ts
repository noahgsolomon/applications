import dotenv from "dotenv";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { gatherTopSkills } from "./top-skills-candidate";
import {
  candidates,
  company as companyTable,
} from "../server/db/schemas/users/schema";
import * as userSchema from "../server/db/schemas/users/schema";

dotenv.config({
  path: "../.env",
});

const connection = neon(process.env.DB_URL!);

const db = drizzle(connection, {
  schema: {
    ...userSchema,
  },
});

export async function processCompanyById(companyId: string) {
  const company = await db.query.company.findFirst({
    where: eq(companyTable.id, companyId),
    with: {
      candidates: true,
    },
  });

  if (!company) {
    console.log(`Company with ID ${companyId} not found.`);
    return;
  }

  console.log(
    `Processing company ${company.name} with ${company.candidates.length} candidates.`,
  );

  const totalEmployees = company.candidates.length;

  for (let i = 0; i < totalEmployees; i += 50) {
    const batch = company.candidates.slice(i, i + 50);

    const updates = batch.map(async (employee) => {
      const candidateSkills = await gatherTopSkills(employee.id);
      if (!candidateSkills) {
        return;
      }

      await db
        .update(candidates)
        .set({
          isEngineer: candidateSkills.isEngineer,
          topFeatures: candidateSkills.features,
          topTechnologies: candidateSkills.tech,
        })
        .where(eq(candidates.id, employee.id));
    });

    await Promise.all(updates);
  }

  console.log(`Finished processing company ${company.name}.`);
}

// Replace with the actual company ID you want to process
const companyId = "afcd9bd7-cd6c-40c1-ac2a-2c0101571bb5";

processCompanyById(companyId)
  .then(() => console.log("Company processing complete."))
  .catch((error) => console.error("Error processing company:", error));
