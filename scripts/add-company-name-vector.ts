import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "../server/db/schemas/users/schema";
import dotenv from "dotenv";
import OpenAI from "openai";
import axios from "axios";
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

const linkedinCompanyUrls = [
  "https://www.linkedin.com/company/the-new-york-times/",
  "https://www.linkedin.com/company/redgames/",
  "https://www.linkedin.com/company/procreate-art/",
  "https://www.linkedin.com/company/happy-juice-games/",
  "https://www.linkedin.com/company/the-pixel-hunt/",
  "https://www.linkedin.com/company/lykkestudios/",
  "https://www.linkedin.com/company/duolingo/",
  "https://www.linkedin.com/company/flighty/",
  "https://www.linkedin.com/company/afterburngames/",
  "https://www.linkedin.com/company/headspace-meditation-limited/",
  "https://www.linkedin.com/company/handy-games/",
  "https://www.linkedin.com/company/any-distance/",
  "https://www.linkedin.com/company/capcom/",
  "https://www.linkedin.com/company/swing-vision/",
  "https://www.linkedin.com/company/seconddinner/",
  "https://www.linkedin.com/company/jack-morton-worldwide/",
  "https://www.linkedin.com/company/supercell/",
  "https://www.linkedin.com/company/good-snooze/",
  "https://www.linkedin.com/company/inkle/",
  "https://www.linkedin.com/company/breakpoint-studio/",
  "https://www.linkedin.com/company/rebelgirls/",
  "https://www.linkedin.com/company/broken-rules/",
  "https://www.linkedin.com/company/lux-optics/",
  "https://www.linkedin.com/company/gameloft/",
  "https://www.linkedin.com/company/netmarble-games/",
  "https://www.linkedin.com/company/volst/",
];

async function scrapeLinkedInCompany(linkedinCompanyUrl: string) {
  console.log(`Scraping LinkedIn company for URL: ${linkedinCompanyUrl}`);
  const options = {
    method: "GET",
    url: `https://api.scrapin.io/enrichment/company`,
    params: {
      apikey: process.env.SCRAPIN_API_KEY!,
      linkedInUrl: linkedinCompanyUrl,
    },
  };

  try {
    const response = await axios.request(options);
    console.log("Company data fetched successfully.");
    return response.data;
  } catch (error) {
    console.error(
      `Error fetching LinkedIn company data for ${linkedinCompanyUrl}:`,
      error
    );
    return null;
  }
}

async function addCompanies() {
  for (const linkedinUrl of linkedinCompanyUrls) {
    try {
      const companyDataRes = await scrapeLinkedInCompany(linkedinUrl);
      if (!companyDataRes) {
        console.error(`No data returned for ${linkedinUrl}`);
        continue;
      }

      const companyData = companyDataRes.company;

      console.log(companyData);

      // Extract required fields from companyData
      const companyName = companyData.name ?? "";
      const linkedinId = companyData.linkedInId ?? "";

      if (!companyName || !linkedinId) {
        console.error(`Missing essential data for company from ${linkedinUrl}`);
        continue;
      }

      // Check if the company already exists
      const existingCompany = await db.query.company.findFirst({
        where: eq(schema.company.linkedinId, linkedinId),
        columns: {
          id: true,
          groups: true,
        },
      });

      if (existingCompany) {
        console.log(
          `Company with LinkedIn ID ${linkedinId} exists. Updating vector and groups.`
        );

        const companyNameVector = await getEmbedding(companyName);

        await db
          .update(schema.company)
          .set({
            companyNameVector: companyNameVector,
            groups: [...(existingCompany.groups ?? []), "apple-design-award"],
          })
          .where(eq(schema.company.linkedinId, linkedinId));

        console.log(`Updated company: ${companyName}`);
        continue;
      }

      // Compute the companyNameVector
      const companyNameVector = await getEmbedding(companyName);

      // Prepare company data for insertion
      const newCompanyData = {
        linkedinId: linkedinId,
        name: companyName,
        universalName: companyData.universalName || null,
        linkedinUrl: linkedinUrl,
        employeeCount: companyData.employeeCount || null,
        websiteUrl: companyData.websiteUrl || null,
        tagline: companyData.tagline || null,
        description: companyData.description || null,
        industry: companyData.industry || null,
        phone: companyData.phone || null,
        specialities: companyData.specialities || [],
        headquarter: companyData.headquarter || null,
        logo: companyData.logo || null,
        foundedOn: companyData.foundedOn || null,
        linkedinData: companyData,
        topTechnologies: companyData.topTechnologies || [],
        topFeatures: companyData.topFeatures || [],
        specialties: companyData.specialties || [],
        companyNameVector: companyNameVector,
        groups: ["apple-design-award"],
      };

      // Insert the company into the database
      await db.insert(schema.company).values(newCompanyData);

      console.log(`Inserted company: ${companyName}`);
    } catch (error) {
      console.error(`Error processing company URL ${linkedinUrl}:`, error);
    }
  }

  console.log("Finished adding companies.");
}

async function main() {
  await addCompanies();
  await pool.end();
}

main().catch((error) => {
  console.error("Error in main:", error);
});
