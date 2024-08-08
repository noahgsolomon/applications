import axios from "axios";
import OpenAI from "openai";
import { candidates as candidatesTable } from "@/server/db/schemas/users/schema";
//@ts-ignore
import { v4 as uuid } from "uuid";
import * as userSchema from "../server/db/schemas/users/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as fs from "fs";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";

dotenv.config({
  path: "../.env",
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const connection = neon(process.env.DB_URL!);

const db = drizzle(connection, {
  schema: {
    ...userSchema,
  },
});

const generateSummary = async (profileData: any) => {
  console.log("Generating summary...");
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          "You are to take in this person's LinkedIn profile data, and generate a list of their hard skills amount of experience and specification",
      },
      {
        role: "user",
        content: JSON.stringify(profileData),
      },
    ],
    response_format: { type: "text" },
    model: "gpt-4o-mini",
    temperature: 0,
    max_tokens: 2048,
  });

  return completion.choices[0].message.content;
};

const scrapeLinkedInProfile = async (linkedinUrl: string) => {
  console.log(`Scraping LinkedIn profile: ${linkedinUrl}...`);
  const options = {
    method: "GET",
    url: `https://api.scrapin.io/enrichment/profile`,
    params: {
      apikey: process.env.SCRAPIN_API_KEY,
      linkedInUrl: linkedinUrl,
    },
  };

  try {
    const response = await axios.request(options);
    console.log(`Successfully scraped LinkedIn profile: ${linkedinUrl}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching LinkedIn profile data: ${error}`);
    return null;
  }
};

const askCondition = async (condition: string) => {
  console.log("Asking condition...");
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          'You are to return a valid parseable JSON object with one attribute "condition" which can either be true or false. All questions users ask will always be able to be answered in a yes or no. An example response would be { "condition": true}',
      },
      {
        role: "user",
        content: condition,
      },
    ],
    response_format: { type: "json_object" },
    model: "gpt-4o-mini",
    temperature: 0,
    max_tokens: 256,
  });

  return JSON.parse(
    completion.choices[0].message.content ?? '{ "condition": false }',
  ).condition;
};

const generateMiniSummary = async (profileData: any) => {
  console.log("Generating mini-summary...");
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          "You are to take in this person's LinkedIn profile data, and generate a 1-2 sentence summary of their experience",
      },
      {
        role: "user",
        content: JSON.stringify(profileData),
      },
    ],
    response_format: { type: "text" },
    model: "gpt-4o-mini",
    temperature: 0,
    max_tokens: 2048,
  });

  return completion.choices[0].message.content;
};

const processLinkedInProfile = async (linkedinUrl: string) => {
  console.log(`Processing LinkedIn profile: ${linkedinUrl}...`);

  // Check if LinkedIn URL already exists in the database
  const existingCandidate = await db
    .select()
    .from(candidatesTable)
    .where(eq(candidatesTable.url, linkedinUrl))
    .limit(1);
  if (existingCandidate.length > 0) {
    console.log(
      `LinkedIn profile already exists in the database: ${linkedinUrl}`,
    );
    return;
  }

  const profileData = await scrapeLinkedInProfile(linkedinUrl);

  if (profileData && profileData.success) {
    const personData = profileData.person;
    const summary = await generateSummary(personData);
    const miniSummary = await generateMiniSummary(personData);
    const workedInBigTech = await askCondition(
      `Has this person worked in big tech?  ${JSON.stringify(
        personData.positions.positionHistory.map(
          (experience: any) => experience,
        ),
        null,
        2,
      )} ${personData.summary} ${personData.headline}`,
    );

    const livesNearBrooklyn = await askCondition(
      `Does this person live within 50 miles of Brookyln New York USA? Their location: ${personData.location ?? "unknown location"} ${personData.positions.positionHistory.length > 0 ? `or ${JSON.stringify(personData.positions.positionHistory[0], null, 2)}` : ""}`,
    );

    console.log("Inserting candidate into database...");
    const userUuid = uuid();
    await db.insert(candidatesTable).values({
      id: userUuid,
      companyId: "b7b1071c-6f80-4de1-8f0b-fb2000e9f25d",
      summary,
      miniSummary,
      workedInBigTech,
      livesNearBrooklyn,
      url: linkedinUrl,
      linkedinData: personData,
      createdAt: new Date(),
    });
    console.log(`Successfully processed LinkedIn profile: ${linkedinUrl}`);
  } else {
    console.error(`Failed to process LinkedIn profile for URL: ${linkedinUrl}`);
  }
};

const main = async () => {
  console.log("Reading and parsing JSON file...");
  const data = fs.readFileSync("./companies/rarible.json", "utf-8");
  const json = JSON.parse(data);

  console.log("Iterating over each employee...");
  for (let i = 0; i < json.employees.length; i += 10) {
    const batch = json.employees
      .slice(i, i + 10)
      .filter((employee: any) => employee.profileUrl);
    await Promise.all(
      batch.map((employee: any) => processLinkedInProfile(employee.profileUrl)),
    );
    console.log(
      `Processed batch ${Math.floor(i / 10) + 1}. Waiting for 10 seconds...`,
    );
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
};

(async () => {
  console.log("Starting script...");
  await main();
  console.log("Script finished.");
})();
