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

async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: text,
  });

  return response.data[0].embedding;
}

async function getNormalizedLocation(location: string): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a location normalizer. Given a location, return the uppercase state name if it's a US location, or the uppercase country name if it's outside the US. If it's a city, return the state (for US) or country it's in. If unsure or the location is invalid, return "UNKNOWN".
Examples:
- New York City -> NEW YORK
- New York -> NEW YORK
- London -> UNITED KINGDOM
- California -> CALIFORNIA
- Tokyo -> JAPAN
- Paris, France -> FRANCE
- Sydney -> AUSTRALIA
- 90210 -> CALIFORNIA
- Earth -> UNKNOWN`,
        },
        {
          role: "user",
          content: location,
        },
      ],
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 256,
    });
    return (
      completion.choices[0].message.content?.trim().toUpperCase() || "UNKNOWN"
    );
  } catch (error) {
    console.error(`Error normalizing location for "${location}":`, error);
    return "UNKNOWN";
  }
}

async function computeAverageEmbedding(
  embeddings: number[][]
): Promise<number[] | null> {
  if (embeddings.length === 0) return null;
  const vectorLength = embeddings[0].length;
  const sumVector = new Array(vectorLength).fill(0);

  embeddings.forEach((embedding) => {
    for (let i = 0; i < vectorLength; i++) {
      sumVector[i] += embedding[i];
    }
  });

  return sumVector.map((val) => val / embeddings.length);
}

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
        .filter((result: any) => result.link.includes("www.linkedin.com/in"))
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
  const companies = await db.query.company.findMany({
    where: jsonArrayContains(schema.company.groups, ["60fps.design"]),
    columns: {
      name: true,
      linkedinUrl: true,
    },
  });

  const processedUrls = new Set<string>();
  const BATCH_SIZE = 10;

  let seenLastProcessed = false;
  for (const company of companies) {
    if (!seenLastProcessed) {
      if (company.name.toLowerCase() === "netflix") {
        seenLastProcessed = true;
      }
      console.log(`Skipping ${company.name}`);
      continue;
    }
    const queries = [
      `site:linkedin.com/in/ "${company.name}" current`,
      `site:linkedin.com/in/ "${company.name}"`,
      `site:linkedin.com/in/ "${company.name}" "software engineer"`,
      `site:linkedin.com/in/ "${company.name}" "product designer"`,
      `site:linkedin.com/in/ "${company.name}" "product manager"`,
      `site:linkedin.com/in/ "${company.name}" "engineering manager"`,
      `site:linkedin.com/in/ "${company.name}" "tech lead"`,
      `site:linkedin.com/in/ "${company.name}" "mobile engineer"`,
      `site:linkedin.com/in/ "${company.name}" "ios engineer"`,
      `site:linkedin.com/in/ "${company.name}" "android engineer"`,
      `site:linkedin.com/in/ "${company.name}" "frontend engineer"`,
      `site:linkedin.com/in/ "${company.name}" "ui engineer"`,
      `site:linkedin.com/in/ "${company.name}" "ux designer"`,
      `site:linkedin.com/in/ "${company.name}" "ux researcher"`,
      `site:linkedin.com/in/ "${company.name}" rails`,
      `site:linkedin.com/in/ "${company.name}" New York`,
      `site:linkedin.com/in/ "${company.name}" NYC`,
      `site:linkedin.com/in/ "${company.name}" Next.js`,
      `site:linkedin.com/in/ "${company.name}" React`,
    ];

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
            if (profileData) {
              await processLinkedInProfile(profileData);
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
