import axios from "axios";
import * as userSchema from "../server/db/schemas/users/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import dotenv from "dotenv";

dotenv.config({
  path: "../.env",
});

const connection = neon(process.env.DB_URL!);

const db = drizzle(connection, {
  schema: {
    ...userSchema,
  },
});

const scrapeCompanyProfile = async (linkedinUrl: string) => {
  const options = {
    method: "GET",
    url: "https://api.scrapin.io/enrichment/company",
    params: {
      apikey: process.env.SCRAPIN_API_KEY,
      linkedInUrl: linkedinUrl,
    },
  };

  try {
    const response = await axios.request(options);
    return response.data;
  } catch (error) {
    console.error(`Error fetching company profile data: ${error}`);
    return null;
  }
};

const processCompanyProfile = async (linkedinUrl: string) => {
  const companyData = await scrapeCompanyProfile(linkedinUrl);

  if (companyData && companyData.success) {
    const { company } = companyData;
    await db.insert(userSchema.company).values({
      linkedinId: company.linkedInId,
      name: company.name,
      universalName: company.universalName,
      linkedinUrl: company.linkedInUrl,
      employeeCount: company.employeeCount,
      websiteUrl: company.websiteUrl,
      tagline: company.tagline,
      description: company.description,
      industry: company.industry,
      phone: company.phone,
      specialities: company.specialities,
      headquarter: company.headquarter,
      logo: company.logo,
      foundedOn: company.foundedOn,
    });
    console.log(`Company profile for ${company.name} inserted successfully.`);
  } else {
    console.error(`Failed to process company profile for URL: ${linkedinUrl}`);
  }
};

async function main() {
  await processCompanyProfile(
    "https://www.linkedin.com/company/the-browser-company/",
  );
}

main().catch((error) => console.error(error));
