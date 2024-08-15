import axios from "axios";
import dotenv from "dotenv";
// @ts-ignore
import { v4 as uuid } from "uuid";
import * as userSchema from "../server/db/schemas/users/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, inArray } from "drizzle-orm";
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

const generateSummary = async (profileData: any) => {
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

const googleSearch = async (query: string) => {
  console.log(`Starting Google search with query: ${query}`);
  const apiKey = process.env.GOOGLE_API_KEY!;
  const cseId = process.env.GOOGLE_CSE_ID!;
  const resultsPerPage = 10;
  const maxResults = 100;
  let allLinkedinUrls: string[] = [];

  for (let start = 1; start < maxResults; start += resultsPerPage) {
    const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cseId)}&start=${start}`;

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
    `Google search completed. Found ${allLinkedinUrls.length} LinkedIn URLs.`,
  );
  return allLinkedinUrls.slice(0, maxResults);
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

const processUrls = async (urls: string[]) => {
  console.log(`Processing batch of ${urls.length} URLs...`);

  const promises = urls.map(async (url) => {
    console.log(`Processing URL: ${url}`);
    const existingCandidate = await db.query.candidates.findFirst({
      where: eq(userSchema.candidates.url, url),
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

const main = async () => {
  console.log("Main process started.");
  const queries = [
    // `site:www.linkedin.com/in TikTok staff frontend engineer AND new york`,
    // `site:www.linkedin.com/in Airbnb rails engineer`,
    // `site:www.linkedin.com/in Lyft senior frontend engineer AND next.js AND new york`,
    // `site:www.linkedin.com/in Uber swift engineer`,
    // `site:www.linkedin.com/in Saturn fullstack engineer AND next.js AND new york`,
    // `site:www.linkedin.com/in Vercel frontend engineer AND next.js`,
    // `site:www.linkedin.com/in Linear staff engineer AND new york`,
    // `site:www.linkedin.com/in Cash App backend engineer AND rails`,
    // `site:www.linkedin.com/in Match Group frontend engineer AND next.js AND new york`,
    // `site:www.linkedin.com/in Apple swift engineer AND new york`,
    // `site:www.linkedin.com/in Discord staff engineer AND new york`,
    // `site:www.linkedin.com/in Twitter senior frontend engineer AND new york`,
    // `site:www.linkedin.com/in Calendly fullstack engineer AND next.js`,
    // `site:www.linkedin.com/in AddGlow rails engineer`,
    // `site:www.linkedin.com/in Circle frontend engineer AND next.js`,
    // `site:www.linkedin.com/in Locals.com backend engineer AND rails`,
    // `site:www.linkedin.com/in Hivebrite fullstack engineer AND new york`,
    // `site:www.linkedin.com/in Frond staff frontend engineer AND next.js`,
    // `site:www.linkedin.com/in Skillshare rails engineer`,
    // `site:www.linkedin.com/in DISCO frontend engineer AND next.js AND new york`,
    // `site:www.linkedin.com/in Sellfy senior frontend engineer AND new york`,
    // `site:www.linkedin.com/in Payhip backend engineer AND rails`,
    // `site:www.linkedin.com/in SamCart staff frontend engineer AND new york`,
    // `site:www.linkedin.com/in Shopify senior frontend engineer AND next.js`,
    // `site:www.linkedin.com/in Etsy next.js developer AND new york`,
    // `site:www.linkedin.com/in Beacons rails engineer`,
    // `site:www.linkedin.com/in Outseta fullstack engineer AND next.js`,
    // `site:www.linkedin.com/in Uscreen frontend engineer AND new york`,
    // `site:www.linkedin.com/in Fourthwall senior software engineer`,
    // `site:www.linkedin.com/in Substack backend engineer AND rails`,
    // `site:www.linkedin.com/in Stripe frontend engineer AND next.js AND new york`,
    // `site:www.linkedin.com/in Webflow senior frontend engineer AND next.js`,
    // `site:www.linkedin.com/in Squarespace fullstack engineer AND new york`,
    // `site:www.linkedin.com/in Wix backend engineer AND rails`,
    // `site:www.linkedin.com/in Instagram frontend engineer AND new york`,
    // `site:www.linkedin.com/in Snap Inc. next.js engineer`,
    // `site:www.linkedin.com/in Twitch frontend engineer AND next.js AND new york`,
    // `site:www.linkedin.com/in WhatsApp backend engineer AND swift`,
    // `site:www.linkedin.com/in Dropbox frontend engineer AND next.js`,
    // `site:www.linkedin.com/in Meta staff frontend engineer AND new york`,
    // `site:www.linkedin.com/in Ramp rails engineer AND new york`,
    // `site:www.linkedin.com/in Spline frontend engineer AND next.js`,
    // `site:www.linkedin.com/in Deel backend engineer AND rails`,
    // `site:www.linkedin.com/in Tumblr senior frontend engineer AND next.js AND new york`,
    // `site:www.linkedin.com/in Pinterest frontend engineer AND next.js`,
    // `site:www.linkedin.com/in Zoom swift engineer`,
    // `site:www.linkedin.com/in Quora frontend engineer AND new york`,
    // `site:www.linkedin.com/in Clubhouse backend engineer AND rails`,
    // `site:www.linkedin.com/in Roblox frontend engineer AND next.js`,
    // `site:www.linkedin.com/in Valve Corporation swift engineer`,
    // `site:www.linkedin.com/in Duolingo frontend engineer AND next.js`,
    // `site:www.linkedin.com/in Solana Labs backend engineer AND rails`,
    // `site:www.linkedin.com/in Robinhood frontend engineer AND next.js AND new york`,
    // `site:www.linkedin.com/in DoorDash rails engineer AND new york`,
    // `site:www.linkedin.com/in Instacart backend engineer AND rails`,
    // `site:www.linkedin.com/in Block swift engineer`,
    // `site:www.linkedin.com/in Tinder frontend engineer AND next.js`,
    // `site:www.linkedin.com/in LinkedIn frontend engineer AND new york`,
    // `site:www.linkedin.com/in TikTok Shop backend engineer AND rails`,
    // `site:www.linkedin.com/in Carta frontend engineer AND next.js AND new york`,
    // `site:www.linkedin.com/in Brex rails engineer AND new york`,
    // `site:www.linkedin.com/in Gusto frontend engineer AND next.js`,
    // `site:www.linkedin.com/in Tailwind backend engineer AND rails`,
    // `site:www.linkedin.com/in Slack frontend engineer AND next.js AND new york`,
    // `site:www.linkedin.com/in GitHub swift engineer`,
    `site:www.linkedin.com/in Notion frontend engineer AND next.js`,
    `site:www.linkedin.com/in Asana backend engineer AND rails`,
    `site:www.linkedin.com/in Twilio frontend engineer AND next.js`,
    `site:www.linkedin.com/in Craft Docs swift engineer`,
    `site:www.linkedin.com/in Weixin/WeChat frontend engineer AND new york`,
    `site:www.linkedin.com/in Trello backend engineer AND rails`,
    `site:www.linkedin.com/in Texts frontend engineer AND next.js`,
    `site:www.linkedin.com/in Netlify frontend engineer AND next.js`,
    `site:www.linkedin.com/in Netflix backend engineer AND rails`,
    `site:www.linkedin.com/in Riot Games swift engineer`,
    `site:www.linkedin.com/in Farcaster frontend engineer AND next.js`,
    `site:www.linkedin.com/in Supabase backend engineer AND rails`,
    `site:www.linkedin.com/in lichess.org frontend engineer AND next.js`,
    `site:www.linkedin.com/in Chess.com frontend engineer AND next.js AND new york`,
    `site:www.linkedin.com/in Opal swift engineer`,
    `site:www.linkedin.com/in Sunlitt backend engineer AND rails`,
    `site:www.linkedin.com/in Moonly — Moon Calendar frontend engineer AND next.js`,
    `site:www.linkedin.com/in Atoms frontend engineer AND next.js`,
    `site:www.linkedin.com/in Copilot swift engineer`,
    `site:www.linkedin.com/in W1D1 frontend engineer AND next.js`,
    `site:www.linkedin.com/in Amie frontend engineer AND next.js`,
    `site:www.linkedin.com/in Luma AI swift engineer`,
    `site:www.linkedin.com/in Partiful frontend engineer AND next.js`,
    `site:www.linkedin.com/in Shazam backend engineer AND rails`,
    `site:www.linkedin.com/in Splice frontend engineer AND next.js`,
    `site:www.linkedin.com/in Captions swift engineer`,
    `site:www.linkedin.com/in Lightning AI frontend engineer AND next.js`,
    `site:www.linkedin.com/in ClickUp frontend engineer AND new york`,
    `site:www.linkedin.com/in Paper backend engineer AND rails`,
    `site:www.linkedin.com/in Fastly swift engineer`,
    `site:www.linkedin.com/in YouTube frontend engineer AND next.js`,
    `site:www.linkedin.com/in Candy Digital frontend engineer AND next.js`,
    `site:www.linkedin.com/in Dapper Labs frontend engineer AND new york`,
    `site:www.linkedin.com/in OpenSea frontend engineer AND next.js`,
    `site:www.linkedin.com/in Rarible frontend engineer AND next.js`,
    `site:www.linkedin.com/in Binance backend engineer AND rails`,
    `site:www.linkedin.com/in Magic Eden frontend engineer AND next.js`,
    `site:www.linkedin.com/in Axie Infinity frontend engineer AND next.js`,
    `site:www.linkedin.com/in Looks Rare frontend engineer AND next.js`,
    `site:www.linkedin.com/in Consensys frontend engineer AND new york`,
  ];

  for (const query of queries) {
    const urls = await googleSearch(query);
    console.log(
      `Number of URLs returned that contain www.linkedin.com/in: ${urls.length}`,
    );

    for (let i = 0; i < urls.length; i += 10) {
      const batch = urls.slice(i, i + 10);
      await processUrls(batch);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  console.log("Main process completed.");
};

main();
