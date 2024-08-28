import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import dotenv from "dotenv";
import { eq, gt, or, and, asc } from "drizzle-orm";
import OpenAI from "openai";
import * as userSchema from "../server/db/schemas/users/schema";
import fs from "fs";
import path from "path";

dotenv.config({
  path: "../.env",
});

const connection = neon(process.env.DB_URL!);
const db = drizzle(connection, {
  schema: {
    ...userSchema,
  },
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const companies = [
  // {
  //   name: "Netflix",
  //   aliases: ["Netflix"],
  //   startYear: 2010,
  //   endYear: 2020,
  //   type: "data",
  //   id: "07e4e7f5-4a97-459d-94e7-05ae7051f5ac",
  // },
  // {
  //   name: "Meta",
  //   aliases: ["Meta", "Facebook"],
  //   startYear: 2003,
  //   endYear: 2016,
  //   type: "data",
  //   id: "8fdbfb95-fe21-481e-b7e5-fea48a371ad3",
  // },
  // {
  //   name: "Facebook",
  //   aliases: ["Meta", "Facebook"],
  //   startYear: 2003,
  //   endYear: 2016,
  //   type: "data",
  //   id: "175e4a3e-c89e-4b46-ae47-776c4989cbbb",
  // },
  // {
  //   name: "TikTok",
  //   aliases: ["TikTok"],
  //   startYear: 2023,
  //   endYear: 2024,
  //   type: "data",
  //   id: "f7ae8a29-56d7-45e5-9756-8211c038601d",
  // },
  //   name: "YouTube",
  // {
  //   aliases: ["YouTube"],
  //   startYear: 2010,
  //   endYear: 2020,
  //   type: "engineering_product",
  //   id: "8d29eb66-47ef-4409-8ff6-84872847cd5c",
  // },
  // {
  //   name: "Dropbox",
  //   aliases: ["Dropbox"],
  //   startYear: 2009,
  //   endYear: 2016,
  //   type: "engineering_product",
  //   id: "1807721e-b99e-43ef-9a89-c20e6a3041c4",
  // },
  // {
  //   name: "Meta",
  //   aliases: ["Meta", "Facebook"],
  //   startYear: 2007,
  //   endYear: 2014,
  //   type: "engineering_product",
  //   id: "8fdbfb95-fe21-481e-b7e5-fea48a371ad3",
  // },
  // {
  //   name: "Facebook",
  //   aliases: ["Meta", "Facebook"],
  //   startYear: 2007,
  //   endYear: 2014,
  //   type: "engineering_product",
  //   id: "175e4a3e-c89e-4b46-ae47-776c4989cbbb",
  // },
  // {
  //   name: "Meta",
  //   aliases: ["Meta", "Facebook"],
  //   startYear: 2003,
  //   endYear: 2010,
  //   type: "android",
  //   id: "8fdbfb95-fe21-481e-b7e5-fea48a371ad3",
  // },
  // {
  //   name: "Facebook",
  //   aliases: ["Meta", "Facebook"],
  //   startYear: 2003,
  //   endYear: 2010,
  //   type: "android",
  //   id: "175e4a3e-c89e-4b46-ae47-776c4989cbbb",
  // },
  // {
  //   name: "Stripe",
  //   aliases: ["Stripe"],
  //   startYear: 2010,
  //   endYear: 2019,
  //   type: "infrastructure",
  //   id: "4304b1c3-b3c5-491a-8cce-f203a3d1eb74",
  // },
  // {
  //   name: "DoorDash",
  //   aliases: ["DoorDash"],
  //   startYear: 2018,
  //   endYear: 2021,
  //   type: "infrastructure",
  //   id: "b244f9e3-85c9-460e-8a7d-16c70b74c19d",
  // },
  // {
  //   name: "Instagram",
  //   aliases: ["Instagram"],
  //   startYear: 2010,
  //   endYear: 2021,
  //   type: "mobile",
  //   id: "fabe39b8-944e-4c2b-8b4c-1bef56593add",
  // },
  // {
  //   name: "Uber",
  //   aliases: ["Uber"],
  //   startYear: 2010,
  //   endYear: 2016,
  //   type: "mobile",
  //   id: "e0db0e46-458a-4f4b-86ff-707793d5a8b7",
  // },
  // {
  //   name: "DoorDash",
  //   aliases: ["DoorDash"],
  //   startYear: 2018,
  //   endYear: 2021,
  //   type: "mobile",
  //   id: "b244f9e3-85c9-460e-8a7d-16c70b74c19d",
  // },
  {
    name: "Ueno",
    aliases: ["ueno."],
    startYear: 2016,
    endYear: 2021,
    type: "any",
    id: "03c1b280-98f9-42de-ae8b-4c900f12ba9e",
  },
];

const limit = 100;

const roleDescriptions = {
  data: "data engineering, machine learning engineering, or building data infrastructure. This includes roles like Data Engineer, Machine Learning Engineer, Data Scientist (with engineering focus), or Big Data Engineer.",
  engineering_product:
    "software engineering directly related to product development. This includes roles like Software Engineer (Product), Full-Stack Developer, Frontend Engineer, Backend Engineer, or Technical Product Manager with a strong engineering component.",
  infrastructure:
    "infrastructure or platform engineering. This includes roles like Infrastructure Engineer, DevOps Engineer, Site Reliability Engineer (SRE), Platform Engineer, or Cloud Engineer.",
  mobile:
    "mobile app development. This includes roles like iOS Engineer, Android Engineer, Mobile App Developer, or Cross-platform Mobile Developer (e.g., React Native or Flutter).",
  android:
    "Android app development. This includes roles like Android Engineer, Android Developer, or Mobile App Developer with a focus on Android platforms.",
  any: "any type of engineering or technical role.",
};

async function fetchCandidatesWithCursor(
  company: any,
  cursor?: {
    id: string;
    createdAt: Date;
  },
) {
  console.log(
    `Fetching candidates for ${company.name} with cursor: ${JSON.stringify(cursor)}`,
  );
  try {
    const candidates = await db.query.candidates.findMany({
      where: cursor
        ? and(
            eq(userSchema.candidates.companyId, company.id),
            or(
              gt(userSchema.candidates.createdAt, cursor.createdAt),
              and(
                eq(userSchema.candidates.createdAt, cursor.createdAt),
                gt(userSchema.candidates.id, cursor.id),
              ),
            ),
          )
        : eq(userSchema.candidates.companyId, company.id),
      limit: limit,
      orderBy: (candidates) => [asc(candidates.createdAt), asc(candidates.id)],
    });
    console.log(`Fetched ${candidates.length} candidates for ${company.name}`);
    return candidates;
  } catch (error) {
    console.error(`Error fetching candidates for ${company.name}:`, error);
    throw error;
  }
}

async function fetchAllCandidates(company: any) {
  console.log(`Starting to fetch all candidates for ${company.name}`);
  let allCandidates: any[] = [];
  let lastCursor: { id: string; createdAt: Date } | undefined = undefined;

  while (true) {
    const candidates = await fetchCandidatesWithCursor(company, lastCursor);

    if (candidates.length === 0) {
      console.log(`No more candidates to fetch for ${company.name}`);
      break;
    }

    allCandidates = allCandidates.concat(candidates);
    lastCursor = {
      id: candidates[candidates.length - 1].id,
      createdAt: candidates[candidates.length - 1].createdAt!,
    };

    console.log(
      `Updated cursor for ${company.name}: ${JSON.stringify(lastCursor)}`,
    );
  }

  console.log(
    `Total candidates fetched for ${company.name}: ${allCandidates.length}`,
  );
  return allCandidates;
}

async function checkCompanyExperience(positionHistory: any[], company: any) {
  console.log(`Checking company experience for ${company.name}`);
  const relevantPositions = positionHistory
    .filter((position: any) => {
      const companyMatch = company.aliases
        ? company.aliases.some(
            (alias: string) =>
              position.companyName.toLowerCase() === alias.toLowerCase(),
          )
        : position.companyName.toLowerCase() === company.name.toLowerCase();

      const startYear = position.startEndDate?.start?.year;
      const endYear = position.startEndDate?.end?.year;

      return (
        companyMatch &&
        ((startYear &&
          startYear >= company.startYear &&
          startYear <= company.endYear) ||
          (endYear &&
            endYear >= company.startYear &&
            endYear <= company.endYear))
      );
    })
    .map((position: any) => ({
      title: position.title,
      description: position.description,
    }));

  if (relevantPositions.length === 0) {
    console.log(`No relevant positions found for ${company.name}`);
    return false;
  }

  console.log(
    `Relevant positions found for ${company.name}: ${relevantPositions.length}`,
  );

  if (company.type === "any") {
    console.log(`Company type is 'any'. Skipping OpenAI completion.`);
    return true;
  }

  const condition = JSON.stringify({
    relevantPositions,
    company: company.name,
    type: company.type,
  });

  try {
    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content:
            'You are to return a valid parseable JSON object with one attribute "condition" which can either be true or false. All questions users ask will always be able to be answered in a yes or no. An example response would be { "condition": true }',
        },
        {
          role: "user",
          content: `Did any of these roles involve engineering work specifically related to ${
            roleDescriptions[company.type as keyof typeof roleDescriptions]
          } at ${company.name}? 

1. The role must indicate engineering work in the specified area.
2. For ambiguous cases like just says software engineer with no description indicating working at that relevant job area, err on the side of caution and return false.

Here are the positions to evaluate: ${condition}`,
        },
      ],
      response_format: { type: "json_object" },
      model: "gpt-4o",
      temperature: 0,
      max_tokens: 256,
    });

    const result = JSON.parse(
      completion.choices[0].message.content ?? '{ "condition": false }',
    );
    console.log(`OpenAI response for ${company.name}:`, result);
    return result.condition;
  } catch (error) {
    console.error(
      `Error processing OpenAI response for ${company.name}:`,
      error,
    );
    return false;
  }
}

async function main() {
  const results: { [key: string]: any[] } = {};

  // Function to process a single company
  async function processCompany(company: any) {
    // Define the file name with the date range, company name, and job type
    const fileName = `${company.name.toLowerCase()}/${company.type}_${company.startYear}-${company.endYear}.json`;

    // Check if the file already exists and is not empty
    if (fs.existsSync(fileName) && fs.statSync(fileName).size > 0) {
      console.log(
        `Skipping ${company.name} (${company.type}) as it is already processed.`,
      );
      return;
    }

    console.log(`Processing candidates for ${company.name} (${company.type})`);
    const allCandidates = await fetchAllCandidates(company);

    const checkPromises = allCandidates.map(async (candidate) => {
      const linkedinData = candidate.linkedinData;
      if (
        linkedinData &&
        linkedinData.positions &&
        linkedinData.positions.positionHistory
      ) {
        const positionHistory = linkedinData.positions.positionHistory;

        const hasRelevantExperience = await checkCompanyExperience(
          positionHistory,
          company,
        );

        if (hasRelevantExperience) {
          return {
            linkedInUrl: linkedinData.linkedInUrl,
            id: candidate.id,
            data: true,
          };
        }
      }
      return null;
    });

    const companyResults = (await Promise.all(checkPromises)).filter(
      (result): result is { linkedInUrl: string; id: string; data: boolean } =>
        result !== null,
    );

    // Save results immediately after processing
    if (!results[fileName]) {
      results[fileName] = [];
    }
    results[fileName] = results[fileName].concat(companyResults);

    // Ensure directory exists
    const directory = path.dirname(fileName);
    if (!fs.existsSync(directory)) {
      fs.mkdirSync(directory, { recursive: true });
    }

    // Write to file
    fs.writeFileSync(fileName, JSON.stringify(results[fileName], null, 2));

    console.log(`Results for ${fileName}:`);
    console.log(companyResults);
    console.log(`Total results: ${companyResults.length}`);
    console.log("---");
  }

  // Process companies in batches of 3
  for (let i = 0; i < companies.length; i += 3) {
    const batch = companies.slice(i, i + 3);
    await Promise.all(batch.map(processCompany));
  }

  // Combine Meta and Facebook results with updated file names
  const metaFileName = `meta/engineering_product_${
    companies.find((c) => c.name === "Meta" && c.type === "engineering_product")
      ?.startYear
  }-${
    companies.find((c) => c.name === "Meta" && c.type === "engineering_product")
      ?.endYear
  }.json`;

  const facebookFileName = `facebook/engineering_product_${
    companies.find(
      (c) => c.name === "Facebook" && c.type === "engineering_product",
    )?.startYear
  }-${
    companies.find(
      (c) => c.name === "Facebook" && c.type === "engineering_product",
    )?.endYear
  }.json`;

  if (results[metaFileName] && results[facebookFileName]) {
    results[metaFileName] = results[metaFileName].concat(
      results[facebookFileName],
    );
    delete results[facebookFileName];

    // Write combined Meta results to file
    fs.writeFileSync(
      metaFileName,
      JSON.stringify(results[metaFileName], null, 2),
    );
  }

  // Output final results
  for (const [fileName, data] of Object.entries(results)) {
    console.log(`Final results for ${fileName}:`);
    console.log(data);
    console.log(`Total results: ${data.length}`);
    console.log("---");
  }
}

main().catch((error) => console.error("Main function error:", error));
