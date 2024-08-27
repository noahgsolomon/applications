import axios from "axios";
import dotenv from "dotenv";
// @ts-ignore
import { v4 as uuid } from "uuid";
import * as userSchema from "../server/db/schemas/users/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, inArray, or } from "drizzle-orm";
import OpenAI from "openai";

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

export const generateSummary = async (profileData: any) => {
  console.log("Generating summary for profile data...");
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
  console.log("Summary generated.");
  return completion.choices[0].message.content;
};

const scrapeLinkedInProfile = async (linkedinUrl: string) => {
  console.log(`Scraping LinkedIn profile for URL: ${linkedinUrl}`);
  const options = {
    method: "GET",
    url: `https://api.scrapin.io/enrichment/profile`,
    params: {
      apikey: process.env.SCRAPIN_API_KEY!,
      linkedInUrl: linkedinUrl,
    },
  };

  try {
    const response = await axios.request(options);
    console.log("Profile data fetched successfully.");
    return response.data;
  } catch (error) {
    console.error(`Error fetching LinkedIn profile data: ${error}`);
    return null;
  }
};

const checkCompanyMatch = async (profileData: any) => {
  console.log("Checking for matching company in the database...");
  let companiesWorkedAt = profileData.positions.positionHistory.map(
    (experience: any) => experience.linkedInId as string,
  );
  companiesWorkedAt = companiesWorkedAt.length > 0 ? companiesWorkedAt : [""];

  const storedCompanyWorkedAt = await db.query.company.findFirst({
    where: inArray(userSchema.company.linkedinId, companiesWorkedAt),
  });

  if (storedCompanyWorkedAt) {
    console.log("Matching company found.");
  } else {
    console.log("No matching company found.");
  }

  return storedCompanyWorkedAt;
};

const askCondition = async (condition: string) => {
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          'You are to return a valid parseable JSON object with one attribute "condition" which can either be true or false. All questions users ask will always be able to be answered in a yes or no. An example response would be { "condition": true }',
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

  const result = JSON.parse(
    completion.choices[0].message.content ?? '{ "condition": false }',
  ).condition as boolean;

  return result;
};

const generateMiniSummary = async (profileData: any) => {
  console.log("Generating mini summary...");
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

  console.log("Mini summary generated.");
  return completion.choices[0].message.content;
};

const gatherTopSkills = async (profileData: any) => {
  console.log("Gathering top skills from profile data...");
  const skills = profileData.skills || [];
  const positions = profileData.positions.positionHistory
    .map((position: any) => position.description)
    .join(" ");

  const profileSummary = {
    skills,
    positions,
  };

  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          "You are to take in this person's LinkedIn profile data and generate a JSON object with three fields: 'tech', 'features', and 'isEngineer'. The 'tech' field should contain a JSON array of strings representing the hard tech skills they are most familiar with. The 'features' field should contain a JSON array of strings representing the top hard features they have worked on the most. The 'isEngineer' field should be a boolean value indicating whether this person is likely an engineer based on their profile.",
      },
      {
        role: "user",
        content: JSON.stringify(profileSummary),
      },
    ],
    response_format: { type: "json_object" },
    model: "gpt-4o-mini",
    max_tokens: 2048,
  });

  const result = JSON.parse(completion.choices[0].message.content ?? "") as {
    tech: string[];
    features: string[];
    isEngineer: boolean;
  };

  console.log("Top skills gathered.");
  return result;
};

const insertCandidate = async (profileData: any, companyId?: string) => {
  const existingCandidate = await db.query.candidates.findFirst({
    where: eq(userSchema.candidates.url, profileData.linkedInUrl),
  });
  if (existingCandidate) {
    console.log(
      `Candidate already exists in the database: ${profileData.linkedInUrl}`,
    );
    return;
  }
  console.log("Inserting candidate into the database...");
  const miniSummary = await generateMiniSummary(profileData);
  const { tech, features, isEngineer } = await gatherTopSkills(profileData);

  console.log("Checking additional conditions for candidate...");
  const workedInBigTech = await askCondition(
    `Has this person worked in big tech? ${JSON.stringify(
      profileData.positions.positionHistory.map(
        (experience: any) => experience.companyName,
      ),
      null,
      2,
    )} ${profileData.summary} ${profileData.headline}`,
  );

  const livesNearBrooklyn = await askCondition(
    `Does this person live within 50 miles of Brooklyn, New York, USA? Their location: ${profileData.location ?? "unknown location"} ${
      profileData.positions.positionHistory.length > 0
        ? `or ${JSON.stringify(profileData.positions.positionHistory[0], null, 2)}`
        : ""
    }`,
  );

  const summary = await generateSummary(profileData);

  const candidateId = uuid();
  await db.insert(userSchema.candidates).values({
    id: candidateId,
    url: profileData.linkedInUrl as string,
    linkedinData: profileData,
    companyId: companyId ?? undefined,
    miniSummary,
    summary,
    topTechnologies: tech,
    topFeatures: features,
    isEngineer,
    workedInBigTech,
    livesNearBrooklyn,
    createdAt: new Date(),
  });

  console.log(
    `Candidate ${profileData.firstName} ${profileData.lastName} inserted into the database. Candidate ID: ${candidateId}`,
  );
  return candidateId;
};

export const processUrls = async (urls: string[]) => {
  console.log(`Processing batch of ${urls.length} URLs...`);

  const normalizeUrl = (url: string) => {
    return url.endsWith("/") ? url.slice(0, -1) : url;
  };

  const promises = urls.map(async (url) => {
    console.log(`Processing URL: ${url}`);
    const normalizedUrl = normalizeUrl(url);

    const existingCandidate = await db.query.candidates.findFirst({
      where: or(
        eq(userSchema.candidates.url, normalizedUrl),
        eq(userSchema.candidates.url, `${normalizedUrl}/`),
      ),
    });
    if (existingCandidate) {
      console.log(`Candidate already exists in the database: ${url}`);
      return;
    }

    const profileData = await scrapeLinkedInProfile(url);

    if (profileData && profileData.success) {
      console.log(`Profile data successfully scraped for URL: ${url}`);
      const name =
        profileData.person.firstName + " " + profileData.person.lastName;
      const companyMatch = await checkCompanyMatch(profileData.person);

      if (companyMatch) {
        console.log(
          `Candidate ${name} has worked at a stored company: ${companyMatch.name}.`,
        );
        await insertCandidate(profileData.person, companyMatch.id);
      } else {
        console.log(`Candidate ${name} has no matching company.`);
        await insertCandidate(profileData.person, undefined);
      }
    } else {
      console.log(`Failed to scrape profile data for URL: ${url}`);
    }
  });

  await Promise.all(promises);
  console.log(
    `Batch processing complete. Waiting 2 seconds before proceeding to the next batch...`,
  );
};

import fs from "fs";
import path from "path";

const main = async () => {
  console.log("Main process started.");

  const companyFiles = [
    "youtube.json",
    "uber.json",
    "tiktok.json",
    "stripe.json",
    "facebook.json",
    "dropbox.json",
    "instagram.json",
    "netflix.json",
  ];
  let linkedInUrls: string[] = [];

  for (const file of companyFiles) {
    const filePath = path.join("./companies", file);
    const fileContent = fs.readFileSync(filePath, "utf-8");
    const jsonData = JSON.parse(fileContent);
    const urls = jsonData
      .map((item: any) => item.profileUrl)
      .filter(
        (url: string | null | undefined): url is string =>
          typeof url === "string" && url.trim() !== "",
      );
    linkedInUrls = linkedInUrls.concat(urls);
  }

  for (let i = 0; i < linkedInUrls.length; i += 10) {
    const batch = linkedInUrls.slice(i, i + 10);
    await processUrls(batch);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  console.log("Main process completed.");
};

main();
