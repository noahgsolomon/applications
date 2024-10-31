import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "../server/db/schemas/users/schema";
import dotenv from "dotenv";
import OpenAI from "openai";
import { eq } from "drizzle-orm";

dotenv.config({ path: "../.env" });

const pool = new Pool({ connectionString: process.env.DB_URL });
const db = drizzle(pool, { schema });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: text,
  });

  if (!response.data.length) {
    throw new Error("No embeddings returned from OpenAI API");
  }

  return response.data[0].embedding;
}

async function addVcInvestorsVectors() {
  try {
    // Get all companies with VC investors
    const companies = await db.query.company.findMany({
      columns: {
        id: true,
        vcInvestors: true,
      },
    });

    // Create a map of VC investors to company IDs
    const vcToCompanyIds = new Map<string, Set<string>>();

    // Populate the map
    companies.forEach((company) => {
      if (company.vcInvestors && company.vcInvestors.length > 0) {
        company.vcInvestors.forEach((vc) => {
          const companyIds = vcToCompanyIds.get(vc) || new Set<string>();
          companyIds.add(company.id);
          vcToCompanyIds.set(vc, companyIds);
        });
      }
    });

    // Process each unique VC investor
    for (const [vcInvestor, companyIdsSet] of vcToCompanyIds.entries()) {
      try {
        // Check if VC investor already exists
        const existingVc = await db.query.vcInvestorsVectors.findFirst({
          where: eq(schema.vcInvestorsVectors.vcInvestor, vcInvestor),
        });

        if (existingVc) {
          console.log(`Updating existing VC investor: ${vcInvestor}`);
          // Update company IDs for existing VC
          const updatedCompanyIds = Array.from(companyIdsSet);
          await db
            .update(schema.vcInvestorsVectors)
            .set({
              companyIds: updatedCompanyIds,
            })
            .where(eq(schema.vcInvestorsVectors.vcInvestor, vcInvestor));
        } else {
          console.log(`Adding new VC investor: ${vcInvestor}`);
          // Get embedding for VC investor name
          const vector = await getEmbedding(vcInvestor);

          // Insert new VC investor
          await db.insert(schema.vcInvestorsVectors).values({
            vcInvestor,
            companyIds: Array.from(companyIdsSet),
            vector,
          });
        }
      } catch (error) {
        console.error(`Error processing VC investor ${vcInvestor}:`, error);
      }
    }

    console.log("Finished adding VC investors vectors");
  } catch (error) {
    console.error("Error in addVcInvestorsVectors:", error);
  } finally {
    await pool.end();
  }
}

// Run the script
addVcInvestorsVectors().catch(console.error);
