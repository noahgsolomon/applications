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

export const googleSearch = async (query: string) => {
  console.log(`Starting Google search with query: ${query}`);
  const apiKey = process.env.GOOGLE_API_KEY!;
  const cseId = process.env.GOOGLE_CSE_ID!;
  const resultsPerPage = 10;
  const maxResults = 200;
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
  return allLinkedinUrls;
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

// const main = async () => {
//   console.log("Main process started.");
//   const queries = [
//     // `site:www.linkedin.com/in TikTok staff frontend engineer AND new york`,
//     // `site:www.linkedin.com/in Airbnb rails engineer`,
//     // `site:www.linkedin.com/in Lyft senior frontend engineer AND next.js AND new york`,
//     // `site:www.linkedin.com/in Uber swift engineer`,
//     // `site:www.linkedin.com/in Saturn fullstack engineer AND next.js AND new york`,
//     // `site:www.linkedin.com/in Vercel frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Linear staff engineer AND new york`,
//     // `site:www.linkedin.com/in Cash App backend engineer AND rails`,
//     // `site:www.linkedin.com/in Match Group frontend engineer AND next.js AND new york`,
//     // `site:www.linkedin.com/in Apple swift engineer AND new york`,
//     // `site:www.linkedin.com/in Discord staff engineer AND new york`,
//     // `site:www.linkedin.com/in Twitter senior frontend engineer AND new york`,
//     // `site:www.linkedin.com/in Calendly fullstack engineer AND next.js`,
//     // `site:www.linkedin.com/in AddGlow rails engineer`,
//     // `site:www.linkedin.com/in Circle frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Locals.com backend engineer AND rails`,
//     // `site:www.linkedin.com/in Hivebrite fullstack engineer AND new york`,
//     // `site:www.linkedin.com/in Frond staff frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Skillshare rails engineer`,
//     // `site:www.linkedin.com/in DISCO frontend engineer AND next.js AND new york`,
//     // `site:www.linkedin.com/in Sellfy senior frontend engineer AND new york`,
//     // `site:www.linkedin.com/in Payhip backend engineer AND rails`,
//     // `site:www.linkedin.com/in SamCart staff frontend engineer AND new york`,
//     // `site:www.linkedin.com/in Shopify senior frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Etsy next.js developer AND new york`,
//     // `site:www.linkedin.com/in Beacons rails engineer`,
//     // `site:www.linkedin.com/in Outseta fullstack engineer AND next.js`,
//     // `site:www.linkedin.com/in Uscreen frontend engineer AND new york`,
//     // `site:www.linkedin.com/in Fourthwall senior software engineer`,
//     // `site:www.linkedin.com/in Substack backend engineer AND rails`,
//     // `site:www.linkedin.com/in Stripe frontend engineer AND next.js AND new york`,
//     // `site:www.linkedin.com/in Webflow senior frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Squarespace fullstack engineer AND new york`,
//     // `site:www.linkedin.com/in Wix backend engineer AND rails`,
//     // `site:www.linkedin.com/in Instagram frontend engineer AND new york`,
//     // `site:www.linkedin.com/in Snap Inc. next.js engineer`,
//     // `site:www.linkedin.com/in Twitch frontend engineer AND next.js AND new york`,
//     // `site:www.linkedin.com/in WhatsApp backend engineer AND swift`,
//     // `site:www.linkedin.com/in Dropbox frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Meta staff frontend engineer AND new york`,
//     // `site:www.linkedin.com/in Ramp rails engineer AND new york`,
//     // `site:www.linkedin.com/in Spline frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Deel backend engineer AND rails`,
//     // `site:www.linkedin.com/in Tumblr senior frontend engineer AND next.js AND new york`,
//     // `site:www.linkedin.com/in Pinterest frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Zoom swift engineer`,
//     // `site:www.linkedin.com/in Quora frontend engineer AND new york`,
//     // `site:www.linkedin.com/in Clubhouse backend engineer AND rails`,
//     // `site:www.linkedin.com/in Roblox frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Valve Corporation swift engineer`,
//     // `site:www.linkedin.com/in Duolingo frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Solana Labs backend engineer AND rails`,
//     // `site:www.linkedin.com/in Robinhood frontend engineer AND next.js AND new york`,
//     // `site:www.linkedin.com/in DoorDash rails engineer AND new york`,
//     // `site:www.linkedin.com/in Instacart backend engineer AND rails`,
//     // `site:www.linkedin.com/in Block swift engineer`,
//     // `site:www.linkedin.com/in Tinder frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in LinkedIn frontend engineer AND new york`,
//     // `site:www.linkedin.com/in TikTok Shop backend engineer AND rails`,
//     // `site:www.linkedin.com/in Carta frontend engineer AND next.js AND new york`,
//     // `site:www.linkedin.com/in Brex rails engineer AND new york`,
//     // `site:www.linkedin.com/in Gusto frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Tailwind backend engineer AND rails`,
//     // `site:www.linkedin.com/in Slack frontend engineer AND next.js AND new york`,
//     // `site:www.linkedin.com/in GitHub swift engineer`,
//     // `site:www.linkedin.com/in Notion frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Asana backend engineer AND rails`,
//     // `site:www.linkedin.com/in Twilio frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Craft Docs swift engineer`,
//     // `site:www.linkedin.com/in Weixin/WeChat frontend engineer AND new york`,
//     // `site:www.linkedin.com/in Trello backend engineer AND rails`,
//     // `site:www.linkedin.com/in Texts frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Netlify frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Netflix backend engineer AND rails`,
//     // `site:www.linkedin.com/in Riot Games swift engineer`,
//     // `site:www.linkedin.com/in Farcaster frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Supabase backend engineer AND rails`,
//     // `site:www.linkedin.com/in lichess.org frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Chess.com frontend engineer AND next.js AND new york`,
//     // `site:www.linkedin.com/in Opal swift engineer`,
//     // `site:www.linkedin.com/in Sunlitt backend engineer AND rails`,
//     // `site:www.linkedin.com/in Moonly — Moon Calendar frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Atoms frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Copilot swift engineer`,
//     // `site:www.linkedin.com/in W1D1 frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Amie frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Luma AI swift engineer`,
//     // `site:www.linkedin.com/in Partiful frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Shazam backend engineer AND rails`,
//     // `site:www.linkedin.com/in Splice frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Captions swift engineer`,
//     // `site:www.linkedin.com/in Lightning AI frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in ClickUp frontend engineer AND new york`,
//     // `site:www.linkedin.com/in Paper backend engineer AND rails`,
//     // `site:www.linkedin.com/in Fastly swift engineer`,
//     // `site:www.linkedin.com/in YouTube frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Candy Digital frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Dapper Labs frontend engineer AND new york`,
//     // `site:www.linkedin.com/in OpenSea frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Rarible frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Binance backend engineer AND rails`,
//     // `site:www.linkedin.com/in Magic Eden frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Axie Infinity frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Looks Rare frontend engineer AND next.js`,
//     // `site:www.linkedin.com/in Consensys frontend engineer AND new york`,
//     //
//     // // Figma
//     // "site:www.linkedin.com/in Figma frontend engineer AND next.js",
//     // "site:www.linkedin.com/in Figma designer AND swift",
//     // "site:www.linkedin.com/in Figma backend engineer AND ruby on rails",
//     //
//     // // Airtable
//     // "site:www.linkedin.com/in Airtable backend engineer AND ruby on rails",
//     // "site:www.linkedin.com/in Airtable frontend engineer AND next.js",
//     // "site:www.linkedin.com/in Airtable designer AND new york",
//     //
//     // // Miro
//     // "site:www.linkedin.com/in Miro frontend engineer AND new york",
//     // "site:www.linkedin.com/in Miro product manager",
//     // "site:www.linkedin.com/in Miro backend engineer AND rails",
//     //
//     // // monday.com
//     // "site:www.linkedin.com/in monday.com backend engineer AND swift",
//     // "site:www.linkedin.com/in monday.com designer",
//     // "site:www.linkedin.com/in monday.com frontend engineer AND next.js",
//     //
//     // // GitLab
//     // "site:www.linkedin.com/in GitLab backend engineer AND ruby on rails",
//     // "site:www.linkedin.com/in GitLab frontend engineer AND swift",
//     // "site:www.linkedin.com/in GitLab designer AND new york",
//     //
//     // // Typeform
//     // "site:www.linkedin.com/in Typeform designer AND swift",
//     // "site:www.linkedin.com/in Typeform backend engineer AND rails",
//     // "site:www.linkedin.com/in Typeform frontend engineer",
//     //
//     // // Zapier
//     // "site:www.linkedin.com/in Zapier backend engineer AND ruby on rails",
//     // "site:www.linkedin.com/in Zapier frontend engineer AND next.js",
//     // "site:www.linkedin.com/in Zapier designer",
//     //
//     // // InVision
//     // "site:www.linkedin.com/in InVision frontend engineer AND swift",
//     // "site:www.linkedin.com/in InVision designer AND new york",
//     // "site:www.linkedin.com/in InVision product manager",
//     //
//     // // Datadog
//     // "site:www.linkedin.com/in Datadog backend engineer AND ruby on rails",
//     // "site:www.linkedin.com/in Datadog frontend engineer AND next.js",
//     // "site:www.linkedin.com/in Datadog software engineer",
//     //
//     // // Zendesk
//     // "site:www.linkedin.com/in Zendesk frontend engineer AND swift",
//     // "site:www.linkedin.com/in Zendesk designer",
//     // "site:www.linkedin.com/in Zendesk backend engineer AND rails",
//     //
//     // // Salesforce
//     // "site:www.linkedin.com/in Salesforce backend engineer AND ruby on rails",
//     // "site:www.linkedin.com/in Salesforce frontend engineer",
//     // "site:www.linkedin.com/in Salesforce product manager AND new york",
//     //
//     // // HubSpot
//     // "site:www.linkedin.com/in HubSpot frontend engineer AND next.js",
//     // "site:www.linkedin.com/in HubSpot designer",
//     // "site:www.linkedin.com/in HubSpot backend engineer AND swift",
//     //
//     // // New Relic
//     // "site:www.linkedin.com/in New Relic software engineer AND ruby on rails",
//     // "site:www.linkedin.com/in New Relic frontend engineer AND swift",
//     // "site:www.linkedin.com/in New Relic designer AND new york",
//     //
//     // // Pipedrive
//     // "site:www.linkedin.com/in Pipedrive backend engineer",
//     // "site:www.linkedin.com/in Pipedrive frontend engineer AND next.js",
//     // "site:www.linkedin.com/in Pipedrive product manager",
//     //
//     // // Amplitude
//     // "site:www.linkedin.com/in Amplitude frontend engineer",
//     // "site:www.linkedin.com/in Amplitude backend engineer AND ruby on rails",
//     // "site:www.linkedin.com/in Amplitude designer AND swift",
//     //
//     // // Mixpanel
//     // "site:www.linkedin.com/in Mixpanel software engineer AND ruby on rails",
//     // "site:www.linkedin.com/in Mixpanel frontend engineer AND next.js",
//     // "site:www.linkedin.com/in Mixpanel product manager AND new york",
//     //
//     // // Intuit
//     // "site:www.linkedin.com/in Intuit designer AND swift",
//     // "site:www.linkedin.com/in Intuit backend engineer AND ruby on rails",
//     // "site:www.linkedin.com/in Intuit frontend engineer",
//     //
//     // // Heap | by Contentsquare
//     // "site:www.linkedin.com/in Heap designer AND new york",
//     // "site:www.linkedin.com/in Heap frontend engineer AND next.js",
//     // "site:www.linkedin.com/in Heap backend engineer AND swift",
//     //
//     // // AngelList
//     // "site:www.linkedin.com/in AngelList software engineer AND ruby on rails",
//     // "site:www.linkedin.com/in AngelList frontend engineer",
//     // "site:www.linkedin.com/in AngelList designer",
//     //
//     // // Square
//     // "site:www.linkedin.com/in Square backend engineer AND rails",
//     // "site:www.linkedin.com/in Square frontend engineer AND swift",
//     // "site:www.linkedin.com/in Square designer AND new york",
//     //
//     // // Plaid
//     // "site:www.linkedin.com/in Plaid software engineer AND ruby on rails",
//     // "site:www.linkedin.com/in Plaid frontend engineer",
//     // "site:www.linkedin.com/in Plaid backend engineer AND next.js",
//     //
//     // // Crunchbase
//     // "site:www.linkedin.com/in Crunchbase designer AND new york",
//     // "site:www.linkedin.com/in Crunchbase frontend engineer AND swift",
//     // "site:www.linkedin.com/in Crunchbase backend engineer",
//     //
//     // // Intercom
//     // "site:www.linkedin.com/in Intercom frontend engineer AND next.js",
//     // "site:www.linkedin.com/in Intercom backend engineer AND ruby on rails",
//     // "site:www.linkedin.com/in Intercom product manager",
//     //
//     // // Replit
//     // "site:www.linkedin.com/in Replit frontend engineer AND swift",
//     // "site:www.linkedin.com/in Replit backend engineer AND ruby on rails",
//     // "site:www.linkedin.com/in Replit designer",
//     //
//     // // Dribbble
//     // "site:www.linkedin.com/in Dribbble designer",
//     // "site:www.linkedin.com/in Dribbble frontend engineer AND next.js",
//     // "site:www.linkedin.com/in Dribbble product manager",
//     //
//     // // Behance
//     // "site:www.linkedin.com/in Behance designer AND new york",
//     // "site:www.linkedin.com/in Behance frontend engineer",
//     // "site:www.linkedin.com/in Behance backend engineer AND swift",
//     //
//     // // Product Hunt
//     // "site:www.linkedin.com/in Product Hunt product manager AND new york",
//     // "site:www.linkedin.com/in Product Hunt frontend engineer AND next.js",
//     // "site:www.linkedin.com/in Product Hunt designer AND swift",
//     //
//     // // TikTok
//     // "site:www.linkedin.com/in TikTok designer",
//     // "site:www.linkedin.com/in TikTok backend engineer AND swift",
//     // "site:www.linkedin.com/in TikTok software engineer AND ruby on rails",
//     //
//     // // Airbnb
//     // "site:www.linkedin.com/in Airbnb frontend engineer AND next.js",
//     // "site:www.linkedin.com/in Airbnb designer AND new york",
//     // "site:www.linkedin.com/in Airbnb backend engineer AND swift",
//     //
//     // // Lyft
//     // "site:www.linkedin.com/in Lyft backend engineer AND ruby on rails",
//     // "site:www.linkedin.com/in Lyft frontend engineer AND swift",
//     // "site:www.linkedin.com/in Lyft designer",
//     //
//     // // Uber
//     // "site:www.linkedin.com/in Uber frontend engineer AND next.js",
//     // "site:www.linkedin.com/in Uber backend engineer AND ruby on rails",
//     // "site:www.linkedin.com/in Uber designer AND new york",
//     //
//     // // Saturn
//     // "site:www.linkedin.com/in Saturn swift engineer",
//     // "site:www.linkedin.com/in Saturn frontend engineer AND next.js",
//     // "site:www.linkedin.com/in Saturn backend engineer",
//     //
//     // // Vercel
//     // "site:www.linkedin.com/in Vercel software engineer AND swift",
//     // "site:www.linkedin.com/in Vercel designer AND new york",
//     // "site:www.linkedin.com/in Vercel backend engineer AND ruby on rails",
//     //
//     // // Linear
//     // "site:www.linkedin.com/in Linear frontend engineer AND next.js",
//     // "site:www.linkedin.com/in Linear designer",
//     // "site:www.linkedin.com/in Linear backend engineer AND swift",
//     //
//     // // Cash App
//     // "site:www.linkedin.com/in Cash App frontend engineer AND swift",
//     // "site:www.linkedin.com/in Cash App software engineer AND ruby on rails",
//     // "site:www.linkedin.com/in Cash App designer",
//
//     // // Match Group
//     // "site:www.linkedin.com/in Match Group backend engineer AND ruby on rails",
//     // "site:www.linkedin.com/in Match Group frontend engineer AND swift",
//     // "site:www.linkedin.com/in Match Group software engineer",
//     //
//     // // Apple
//     // "site:www.linkedin.com/in Apple designer AND new york",
//     // "site:www.linkedin.com/in Apple backend engineer AND ruby on rails",
//     // "site:www.linkedin.com/in Apple frontend engineer AND swift",
//     //
//     // // Discord
//     // "site:www.linkedin.com/in Discord frontend engineer AND next.js",
//     // "site:www.linkedin.com/in Discord designer AND new york",
//     // "site:www.linkedin.com/in Discord backend engineer AND ruby on rails",
//     //
//     // // Twitter
//     // "site:www.linkedin.com/in Twitter backend engineer AND swift",
//     // "site:www.linkedin.com/in Twitter designer",
//     // "site:www.linkedin.com/in Twitter frontend engineer AND next.js",
//     //
//     // // Calendly
//     // "site:www.linkedin.com/in Calendly designer AND swift",
//     // "site:www.linkedin.com/in Calendly backend engineer AND ruby on rails",
//     // "site:www.linkedin.com/in Calendly frontend engineer",
//     //
//     // // AddGlow
//     // "site:www.linkedin.com/in AddGlow software engineer AND ruby on rails",
//     // "site:www.linkedin.com/in AddGlow frontend engineer AND next.js",
//     // "site:www.linkedin.com/in AddGlow designer",
//     //
//     // // Circle
//     // "site:www.linkedin.com/in Circle backend engineer AND ruby on rails",
//     // "site:www.linkedin.com/in Circle frontend engineer AND swift",
//     // "site:www.linkedin.com/in Circle designer AND new york",
//     //
//     // // Locals.com
//     // "site:www.linkedin.com/in Locals.com frontend engineer AND next.js",
//     // "site:www.linkedin.com/in Locals.com designer",
//     // "site:www.linkedin.com/in Locals.com backend engineer AND swift",
//     //
//     // // Hivebrite
//     // "site:www.linkedin.com/in Hivebrite backend engineer AND ruby on rails",
//     // "site:www.linkedin.com/in Hivebrite frontend engineer AND swift",
//     // "site:www.linkedin.com/in Hivebrite designer AND new york",
//     //
//     // // Frond
//     // "site:www.linkedin.com/in Frond backend engineer AND ruby on rails",
//     // "site:www.linkedin.com/in Frond designer",
//     // "site:www.linkedin.com/in Frond frontend engineer AND swift",
//
//     // // Skillshare
//     // "site:www.linkedin.com/in Skillshare designer AND new york",
//     // "site:www.linkedin.com/in Skillshare backend engineer AND ruby on rails",
//     // "site:www.linkedin.com/in Skillshare frontend engineer",
//     //
//     // // DISCO
//     // "site:www.linkedin.com/in DISCO software engineer AND swift",
//     // "site:www.linkedin.com/in DISCO designer AND new york",
//     // "site:www.linkedin.com/in DISCO backend engineer AND ruby on rails",
//     //
//     // // Sellfy
//     // "site:www.linkedin.com/in Sellfy backend engineer AND ruby on rails",
//     // "site:www.linkedin.com/in Sellfy frontend engineer AND swift",
//     // "site:www.linkedin.com/in Sellfy designer AND new york",
//     //
//     // // Payhip
//     // "site:www.linkedin.com/in Payhip frontend engineer AND next.js",
//     // "site:www.linkedin.com/in Payhip designer",
//     // "site:www.linkedin.com/in Payhip backend engineer AND swift",
//     //
//     // // SamCart
//     // "site:www.linkedin.com/in SamCart backend engineer AND ruby on rails",
//     // "site:www.linkedin.com/in SamCart frontend engineer AND swift",
//     // "site:www.linkedin.com/in SamCart designer",
//     //
//     // // Shopify
//     // "site:www.linkedin.com/in Shopify frontend engineer AND swift",
//     // "site:www.linkedin.com/in Shopify backend engineer AND ruby on rails",
//     // "site:www.linkedin.com/in Shopify designer",
//     //
//     // Etsy
//     "site:www.linkedin.com/in Etsy frontend engineer AND next.js",
//     "site:www.linkedin.com/in Etsy designer AND new york",
//     "site:www.linkedin.com/in Etsy backend engineer AND swift",
//
//     // Beacons
//     "site:www.linkedin.com/in Beacons backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Beacons frontend engineer AND swift",
//     "site:www.linkedin.com/in Beacons designer AND new york",
//
//     // Outseta
//     "site:www.linkedin.com/in Outseta frontend engineer AND next.js",
//     "site:www.linkedin.com/in Outseta backend engineer",
//     "site:www.linkedin.com/in Outseta designer",
//
//     // Uscreen
//     "site:www.linkedin.com/in Uscreen backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Uscreen designer",
//     "site:www.linkedin.com/in Uscreen frontend engineer AND swift",
//
//     // Fourthwall
//     "site:www.linkedin.com/in Fourthwall frontend engineer AND next.js",
//     "site:www.linkedin.com/in Fourthwall backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Fourthwall designer",
//
//     // Substack
//     "site:www.linkedin.com/in Substack designer AND new york",
//     "site:www.linkedin.com/in Substack frontend engineer AND swift",
//     "site:www.linkedin.com/in Substack backend engineer AND ruby on rails",
//
//     // Stripe
//     "site:www.linkedin.com/in Stripe frontend engineer AND swift",
//     "site:www.linkedin.com/in Stripe backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Stripe designer",
//
//     // Webflow
//     "site:www.linkedin.com/in Webflow designer AND new york",
//     "site:www.linkedin.com/in Webflow frontend engineer AND swift",
//     "site:www.linkedin.com/in Webflow backend engineer AND ruby on rails",
//
//     // Squarespace
//     "site:www.linkedin.com/in Squarespace designer",
//     "site:www.linkedin.com/in Squarespace frontend engineer AND next.js",
//     "site:www.linkedin.com/in Squarespace backend engineer AND ruby on rails",
//
//     // Wix
//     "site:www.linkedin.com/in Wix backend engineer AND swift",
//     "site:www.linkedin.com/in Wix frontend engineer AND next.js",
//     "site:www.linkedin.com/in Wix designer",
//
//     // Instagram
//     "site:www.linkedin.com/in Instagram designer AND new york",
//     "site:www.linkedin.com/in Instagram backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Instagram frontend engineer AND swift",
//
//     // Snap Inc.
//     "site:www.linkedin.com/in Snap Inc. frontend engineer AND next.js",
//     "site:www.linkedin.com/in Snap Inc. backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Snap Inc. designer",
//
//     // Twitch
//     "site:www.linkedin.com/in Twitch designer AND swift",
//     "site:www.linkedin.com/in Twitch backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Twitch frontend engineer AND next.js",
//
//     // WhatsApp
//     "site:www.linkedin.com/in WhatsApp frontend engineer AND next.js",
//     "site:www.linkedin.com/in WhatsApp designer",
//     "site:www.linkedin.com/in WhatsApp backend engineer AND swift",
//
//     // Dropbox
//     "site:www.linkedin.com/in Dropbox backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Dropbox frontend engineer AND swift",
//     "site:www.linkedin.com/in Dropbox designer",
//
//     // Meta
//     "site:www.linkedin.com/in Meta designer AND new york",
//     "site:www.linkedin.com/in Meta frontend engineer AND swift",
//     "site:www.linkedin.com/in Meta backend engineer AND ruby on rails",
//
//     // Ramp
//     "site:www.linkedin.com/in Ramp frontend engineer AND next.js",
//     "site:www.linkedin.com/in Ramp designer",
//     "site:www.linkedin.com/in Ramp backend engineer AND ruby on rails",
//
//     // Spline
//     "site:www.linkedin.com/in Spline backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Spline designer",
//     "site:www.linkedin.com/in Spline frontend engineer AND swift",
//
//     // Deel
//     "site:www.linkedin.com/in Deel frontend engineer AND swift",
//     "site:www.linkedin.com/in Deel backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Deel designer",
//
//     // Tumblr
//     "site:www.linkedin.com/in Tumblr designer AND new york",
//     "site:www.linkedin.com/in Tumblr backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Tumblr frontend engineer AND swift",
//
//     // Pinterest
//     "site:www.linkedin.com/in Pinterest frontend engineer AND next.js",
//     "site:www.linkedin.com/in Pinterest backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Pinterest designer",
//
//     // Zoom
//     "site:www.linkedin.com/in Zoom designer AND swift",
//     "site:www.linkedin.com/in Zoom frontend engineer AND next.js",
//     "site:www.linkedin.com/in Zoom backend engineer AND ruby on rails",
//
//     // Quora
//     "site:www.linkedin.com/in Quora frontend engineer AND next.js",
//     "site:www.linkedin.com/in Quora backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Quora designer",
//
//     // Clubhouse
//     "site:www.linkedin.com/in Clubhouse designer AND new york",
//     "site:www.linkedin.com/in Clubhouse frontend engineer AND swift",
//     "site:www.linkedin.com/in Clubhouse backend engineer AND ruby on rails",
//
//     // Roblox
//     "site:www.linkedin.com/in Roblox backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Roblox frontend engineer AND swift",
//     "site:www.linkedin.com/in Roblox designer",
//
//     // Valve Corporation
//     "site:www.linkedin.com/in Valve Corporation frontend engineer AND next.js",
//     "site:www.linkedin.com/in Valve Corporation backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Valve Corporation designer",
//
//     // Duolingo
//     "site:www.linkedin.com/in Duolingo designer AND new york",
//     "site:www.linkedin.com/in Duolingo frontend engineer AND swift",
//     "site:www.linkedin.com/in Duolingo backend engineer AND ruby on rails",
//
//     // Solana Labs
//     "site:www.linkedin.com/in Solana Labs backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Solana Labs frontend engineer AND swift",
//     "site:www.linkedin.com/in Solana Labs designer",
//
//     // Robinhood
//     "site:www.linkedin.com/in Robinhood frontend engineer AND swift",
//     "site:www.linkedin.com/in Robinhood designer AND new york",
//     "site:www.linkedin.com/in Robinhood backend engineer AND ruby on rails",
//
//     // DoorDash
//     "site:www.linkedin.com/in DoorDash backend engineer AND swift",
//     "site:www.linkedin.com/in DoorDash frontend engineer AND next.js",
//     "site:www.linkedin.com/in DoorDash designer",
//
//     // Instacart
//     "site:www.linkedin.com/in Instacart frontend engineer AND swift",
//     "site:www.linkedin.com/in Instacart backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Instacart designer AND new york",
//
//     // Block
//     "site:www.linkedin.com/in Block frontend engineer AND next.js",
//     "site:www.linkedin.com/in Block designer",
//     "site:www.linkedin.com/in Block backend engineer AND ruby on rails",
//
//     // Tinder
//     "site:www.linkedin.com/in Tinder designer AND new york",
//     "site:www.linkedin.com/in Tinder frontend engineer AND swift",
//     "site:www.linkedin.com/in Tinder backend engineer AND ruby on rails",
//
//     // LinkedIn
//     "site:www.linkedin.com/in LinkedIn frontend engineer AND swift",
//     "site:www.linkedin.com/in LinkedIn designer AND new york",
//     "site:www.linkedin.com/in LinkedIn backend engineer AND ruby on rails",
//
//     // TikTok Shop
//     "site:www.linkedin.com/in TikTok Shop backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in TikTok Shop frontend engineer AND swift",
//     "site:www.linkedin.com/in TikTok Shop designer",
//
//     // Carta
//     "site:www.linkedin.com/in Carta backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Carta frontend engineer AND swift",
//     "site:www.linkedin.com/in Carta designer AND new york",
//
//     // Brex
//     "site:www.linkedin.com/in Brex frontend engineer AND next.js",
//     "site:www.linkedin.com/in Brex designer",
//     "site:www.linkedin.com/in Brex backend engineer AND ruby on rails",
//
//     // Gusto
//     "site:www.linkedin.com/in Gusto designer AND swift",
//     "site:www.linkedin.com/in Gusto frontend engineer AND next.js",
//     "site:www.linkedin.com/in Gusto backend engineer AND ruby on rails",
//
//     // Tailwind
//     "site:www.linkedin.com/in Tailwind frontend engineer AND swift",
//     "site:www.linkedin.com/in Tailwind backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Tailwind designer AND new york",
//
//     // Slack
//     "site:www.linkedin.com/in Slack backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Slack designer AND swift",
//     "site:www.linkedin.com/in Slack frontend engineer AND next.js",
//
//     // GitHub
//     "site:www.linkedin.com/in GitHub frontend engineer AND swift",
//     "site:www.linkedin.com/in GitHub designer",
//     "site:www.linkedin.com/in GitHub backend engineer AND ruby on rails",
//
//     // Notion
//     "site:www.linkedin.com/in Notion backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Notion frontend engineer AND swift",
//     "site:www.linkedin.com/in Notion designer AND new york",
//
//     // Asana
//     "site:www.linkedin.com/in Asana frontend engineer AND next.js",
//     "site:www.linkedin.com/in Asana backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Asana designer",
//
//     // Twilio
//     "site:www.linkedin.com/in Twilio designer AND new york",
//     "site:www.linkedin.com/in Twilio frontend engineer AND swift",
//     "site:www.linkedin.com/in Twilio backend engineer AND ruby on rails",
//
//     // Craft Docs
//     "site:www.linkedin.com/in Craft Docs backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Craft Docs frontend engineer AND swift",
//     "site:www.linkedin.com/in Craft Docs designer",
//
//     // Weixin/WeChat
//     "site:www.linkedin.com/in Weixin/WeChat frontend engineer AND swift",
//     "site:www.linkedin.com/in Weixin/WeChat backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Weixin/WeChat designer AND new york",
//
//     // Trello
//     "site:www.linkedin.com/in Trello designer AND swift",
//     "site:www.linkedin.com/in Trello frontend engineer AND next.js",
//     "site:www.linkedin.com/in Trello backend engineer AND ruby on rails",
//
//     // Texts
//     "site:www.linkedin.com/in Texts backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Texts designer",
//     "site:www.linkedin.com/in Texts frontend engineer AND swift",
//
//     // Netlify
//     "site:www.linkedin.com/in Netlify designer AND new york",
//     "site:www.linkedin.com/in Netlify frontend engineer AND swift",
//     "site:www.linkedin.com/in Netlify backend engineer AND ruby on rails",
//
//     // Netflix
//     "site:www.linkedin.com/in Netflix frontend engineer AND next.js",
//     "site:www.linkedin.com/in Netflix backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Netflix designer AND swift",
//
//     // Riot Games
//     "site:www.linkedin.com/in Riot Games frontend engineer AND swift",
//     "site:www.linkedin.com/in Riot Games designer",
//     "site:www.linkedin.com/in Riot Games backend engineer AND ruby on rails",
//
//     // Farcaster
//     "site:www.linkedin.com/in Farcaster designer AND new york",
//     "site:www.linkedin.com/in Farcaster frontend engineer AND swift",
//     "site:www.linkedin.com/in Farcaster backend engineer AND ruby on rails",
//
//     // Supabase
//     "site:www.linkedin.com/in Supabase designer",
//     "site:www.linkedin.com/in Supabase frontend engineer AND swift",
//     "site:www.linkedin.com/in Supabase backend engineer AND ruby on rails",
//
//     // lichess.org
//     "site:www.linkedin.com/in lichess.org backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in lichess.org frontend engineer AND swift",
//     "site:www.linkedin.com/in lichess.org designer",
//
//     // Chess.com
//     "site:www.linkedin.com/in Chess.com backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Chess.com frontend engineer AND swift",
//     "site:www.linkedin.com/in Chess.com designer AND new york",
//
//     // Opal
//     "site:www.linkedin.com/in Opal frontend engineer AND next.js",
//     "site:www.linkedin.com/in Opal designer",
//     "site:www.linkedin.com/in Opal backend engineer AND ruby on rails",
//
//     // Sunlitt
//     "site:www.linkedin.com/in Sunlitt backend engineer AND swift",
//     "site:www.linkedin.com/in Sunlitt designer",
//     "site:www.linkedin.com/in Sunlitt frontend engineer AND next.js",
//
//     // Moonly — Moon Calendar
//     "site:www.linkedin.com/in Moonly — Moon Calendar designer AND new york",
//     "site:www.linkedin.com/in Moonly — Moon Calendar frontend engineer AND swift",
//     "site:www.linkedin.com/in Moonly — Moon Calendar backend engineer AND ruby on rails",
//
//     // Atoms
//     "site:www.linkedin.com/in Atoms frontend engineer AND swift",
//     "site:www.linkedin.com/in Atoms designer AND new york",
//     "site:www.linkedin.com/in Atoms backend engineer AND ruby on rails",
//
//     // Copilot
//     "site:www.linkedin.com/in Copilot backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Copilot frontend engineer AND swift",
//     "site:www.linkedin.com/in Copilot designer",
//
//     // W1D1
//     "site:www.linkedin.com/in W1D1 frontend engineer AND swift",
//     "site:www.linkedin.com/in W1D1 designer AND new york",
//     "site:www.linkedin.com/in W1D1 backend engineer AND ruby on rails",
//
//     // Amie
//     "site:www.linkedin.com/in Amie frontend engineer AND next.js",
//     "site:www.linkedin.com/in Amie designer",
//     "site:www.linkedin.com/in Amie backend engineer AND ruby on rails",
//
//     // Luma AI
//     "site:www.linkedin.com/in Luma AI designer AND new york",
//     "site:www.linkedin.com/in Luma AI frontend engineer AND swift",
//     "site:www.linkedin.com/in Luma AI backend engineer AND ruby on rails",
//
//     // Partiful
//     "site:www.linkedin.com/in Partiful backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Partiful frontend engineer AND swift",
//     "site:www.linkedin.com/in Partiful designer",
//
//     // Shazam
//     "site:www.linkedin.com/in Shazam designer",
//     "site:www.linkedin.com/in Shazam frontend engineer AND swift",
//     "site:www.linkedin.com/in Shazam backend engineer AND ruby on rails",
//
//     // Splice
//     "site:www.linkedin.com/in Splice frontend engineer AND swift",
//     "site:www.linkedin.com/in Splice designer",
//     "site:www.linkedin.com/in Splice backend engineer AND ruby on rails",
//
//     // Captions
//     "site:www.linkedin.com/in Captions designer AND new york",
//     "site:www.linkedin.com/in Captions frontend engineer AND swift",
//     "site:www.linkedin.com/in Captions backend engineer AND ruby on rails",
//
//     // Lightning AI
//     "site:www.linkedin.com/in Lightning AI backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Lightning AI designer",
//     "site:www.linkedin.com/in Lightning AI frontend engineer AND swift",
//
//     // ClickUp
//     "site:www.linkedin.com/in ClickUp frontend engineer AND swift",
//     "site:www.linkedin.com/in ClickUp designer AND new york",
//     "site:www.linkedin.com/in ClickUp backend engineer AND ruby on rails",
//
//     // Paper
//     "site:www.linkedin.com/in Paper frontend engineer AND next.js",
//     "site:www.linkedin.com/in Paper designer",
//     "site:www.linkedin.com/in Paper backend engineer AND ruby on rails",
//
//     // Fastly
//     "site:www.linkedin.com/in Fastly frontend engineer AND swift",
//     "site:www.linkedin.com/in Fastly designer",
//     "site:www.linkedin.com/in Fastly backend engineer AND ruby on rails",
//
//     // YouTube
//     "site:www.linkedin.com/in YouTube backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in YouTube designer AND new york",
//     "site:www.linkedin.com/in YouTube frontend engineer AND swift",
//
//     // Candy Digital
//     "site:www.linkedin.com/in Candy Digital designer AND swift",
//     "site:www.linkedin.com/in Candy Digital frontend engineer AND next.js",
//     "site:www.linkedin.com/in Candy Digital backend engineer AND ruby on rails",
//
//     // Dapper Labs
//     "site:www.linkedin.com/in Dapper Labs frontend engineer AND swift",
//     "site:www.linkedin.com/in Dapper Labs designer AND new york",
//     "site:www.linkedin.com/in Dapper Labs backend engineer AND ruby on rails",
//
//     // OpenSea
//     "site:www.linkedin.com/in OpenSea designer",
//     "site:www.linkedin.com/in OpenSea frontend engineer AND swift",
//     "site:www.linkedin.com/in OpenSea backend engineer AND ruby on rails",
//
//     // Rarible
//     "site:www.linkedin.com/in Rarible frontend engineer AND swift",
//     "site:www.linkedin.com/in Rarible designer",
//     "site:www.linkedin.com/in Rarible backend engineer AND ruby on rails",
//
//     // Binance
//     "site:www.linkedin.com/in Binance designer AND new york",
//     "site:www.linkedin.com/in Binance frontend engineer AND swift",
//     "site:www.linkedin.com/in Binance backend engineer AND ruby on rails",
//
//     // Magic Eden
//     "site:www.linkedin.com/in Magic Eden backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Magic Eden designer",
//     "site:www.linkedin.com/in Magic Eden frontend engineer AND swift",
//
//     // Axie Infinity
//     "site:www.linkedin.com/in Axie Infinity frontend engineer AND swift",
//     "site:www.linkedin.com/in Axie Infinity designer",
//     "site:www.linkedin.com/in Axie Infinity backend engineer AND ruby on rails",
//
//     // Looks Rare
//     "site:www.linkedin.com/in Looks Rare backend engineer AND ruby on rails",
//     "site:www.linkedin.com/in Looks Rare designer",
//     "site:www.linkedin.com/in Looks Rare frontend engineer AND swift",
//
//     // Consensys
//     "site:www.linkedin.com/in Consensys designer",
//     "site:www.linkedin.com/in Consensys frontend engineer AND swift",
//     "site:www.linkedin.com/in Consensys backend engineer AND ruby on rails",
//   ];
//
//   for (const query of queries.slice(0, 200)) {
//     const urls = await googleSearch(query);
//     console.log(
//       `Number of URLs returned that contain www.linkedin.com/in: ${urls.length}`,
//     );
//
//     for (let i = 0; i < urls.length; i += 10) {
//       const batch = urls.slice(i, i + 10);
//       await processUrls(batch);
//       await new Promise((resolve) => setTimeout(resolve, 2000));
//     }
//   }
//
//   console.log("Main process completed.");
// };
