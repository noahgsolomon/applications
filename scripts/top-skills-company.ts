import * as userSchema from "../server/db/schemas/users/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";
import { gatherTopSkills } from "./top-skills-candidate";
import { candidates } from "../server/db/schemas/users/schema";

dotenv.config({
  path: "../.env",
});

const connection = neon(process.env.DB_URL!);

const db = drizzle(connection, {
  schema: {
    ...userSchema,
  },
});

export async function gatherTopSkillsCompany() {
  let offset = 0;
  let hasMoreCompanies = true;

  while (hasMoreCompanies) {
    const companies = await db.query.company.findMany({
      limit: 1,
      offset,
      with: {
        candidates: {
          where: eq(userSchema.candidates.isEngineer, true),
        },
      },
    });

    if (companies.length === 0) {
      hasMoreCompanies = false;
      break;
    }

    for (const company of companies) {
      console.log(
        `Processing company ${company.name} ${company.candidates.length}`,
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
    }

    offset += 1;
  }

  console.log("All companies processed.");
}

gatherTopSkillsCompany();
