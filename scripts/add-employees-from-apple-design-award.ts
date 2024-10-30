import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "../server/db/schemas/users/schema";
import dotenv from "dotenv";
import OpenAI from "openai";
import axios from "axios";
//@ts-ignore
import { v4 as uuid } from "uuid";
import { eq, or, sql } from "drizzle-orm";
import { jsonArrayContains } from "@/lib/utils";
import { insertPersonFromLinkedin, scrapeLinkedInProfile } from "@/src/sort";

dotenv.config({ path: "../.env" });

const pool = new Pool({ connectionString: process.env.DB_URL });
const db = drizzle(pool, { schema });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function processLinkedInProfile(profileData: any) {
  try {
    await insertPersonFromLinkedin(profileData.person);
  } catch (error) {
    console.error(`Error processing LinkedIn profile:`, error);
  }
}

export const googleSearch = async (query: string) => {
  console.log(`Starting Google search with query: ${query}`);
  const apiKey = process.env.GOOGLE_API_KEY!;
  const cseId = process.env.GOOGLE_CSE_ID!;
  const resultsPerPage = 10;
  const maxResults = 250;
  let allLinkedinUrls: string[] = [];

  for (let start = 1; start < maxResults; start += resultsPerPage) {
    const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(
      query
    )}&key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(
      cseId
    )}&start=${start}`;

    try {
      const response = await axios.get(url);
      console.log("Search results fetched successfully.");
      const results = response.data.items || [];
      const linkedinUrls = results
        .filter((result: any) => result.link.includes("linkedin.com/in"))
        .map((result: any) => result.link);
      allLinkedinUrls = allLinkedinUrls.concat(linkedinUrls);

      if (linkedinUrls.length < resultsPerPage) {
        console.log("Fewer results than expected, stopping search.");
        break;
      }
    } catch (error) {
      console.error("Error fetching search results:", error);
      break;
    }
  }

  console.log(
    `Google search completed. Found ${allLinkedinUrls.length} LinkedIn URLs.`
  );
  return allLinkedinUrls;
};

async function searchAndProcessEmployees() {
  let companies = await db.query.company.findMany({
    where: jsonArrayContains(schema.company.groups, ["apple-design-award"]),
    columns: {
      name: true,
      linkedinUrl: true,
    },
  });

  //randomly shuffle the companies
  companies = companies.sort(() => Math.random() - 0.5);

  const processedUrls = new Set<string>();
  const BATCH_SIZE = 10;

  for (const company of companies) {
    const queries = [`site:linkedin.com/in AND company:"${company.name}"`];

    let linkedinUrls: string[] = [];
    for (const query of queries) {
      linkedinUrls = linkedinUrls.concat(await googleSearch(query));
    }

    // Filter out duplicates
    const uniqueUrls = linkedinUrls.filter((url) => !processedUrls.has(url));
    console.log(
      `Found ${uniqueUrls.length} unique employees for ${company.name}`
    );

    // Process in batches
    for (let i = 0; i < uniqueUrls.length; i += BATCH_SIZE) {
      const batch = uniqueUrls.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (url) => {
          try {
            const profileData = await scrapeLinkedInProfile(url);
            const existingPerson = await db.query.people.findFirst({
              where: eq(schema.people.linkedinUrl, url),
            });
            if (profileData && !existingPerson) {
              await processLinkedInProfile(profileData);
            } else {
              console.log(`Skipping ${url} because it already exists`);
            }
            processedUrls.add(url);
          } catch (error) {
            console.error(`Error processing profile ${url}:`, error);
          }
        })
      );
      console.log(`Processed batch ${i / BATCH_SIZE + 1} for ${company.name}`);
    }
  }
}

async function main() {
  try {
    await searchAndProcessEmployees();
  } catch (error) {
    console.error("Error in main:", error);
  } finally {
    await pool.end();
  }
}

main();
