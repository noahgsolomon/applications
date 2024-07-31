import axios from "axios";
import OpenAI from "openai";
import dotenv from "dotenv";
import { type db as dbType } from "@/server/db";
import { InferSelectModel, eq } from "drizzle-orm";
import {
  pendingOutbound as pendingOutboundTable,
  outbound as outboundTable,
  candidates as candidatesTable,
} from "@/server/db/schemas/users/schema";

dotenv.config({
  path: "../.env",
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const JOB_DESCRIPTION = `
As a Staff Frontend Engineer, you will lead our frontend team, ensuring high performance, low latency, and exceptional user experiences. You will solve frontend challenges, implement comprehensive testing frameworks, and mentor our engineering team.

Key Responsibilities:

Lead frontend projects including a consumer-side marketplace, chat, and live streaming.
Implement unit, end-to-end, and integration tests.
Enhance performance and observability.
Establish dashboards to track performance and errors.
Dictate direction of frontend frameworks and tools.
Qualifications:

Expert with React and Next.js.
Strong understanding of TypeScript.
Experience with other web frameworks (e.g., Angular, Vue.js).
Proven track record of optimizing frontend performance.
Experience setting up and maintaining testing frameworks.
Familiarity with observability tools (e.g., NewRelic).
Proven experience leading and mentoring a team of 10+ engineers.
Strong communication skills for collaborating with design, product, and growth teams.
Nice to Haves:

Experience with Ruby / Rails.
Experience working with high performing SEO websites.
Experience building consumer-facing products with high usability.
Experience building chat applications.
Experience in optimizing web app resource usage.`;

async function getEmbedding(
  text: string,
  { db }: { db: typeof dbType },
): Promise<number[]> {
  console.log("Getting embedding for text...");
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: text,
  });
  console.log("Received embedding.");
  return response.data[0].embedding;
}

function cosineSimilarity(
  vec1: number[],
  vec2: number[],
  { db }: { db: typeof dbType },
): number {
  console.log("Calculating cosine similarity...");
  const dotProduct = vec1.reduce((acc, val, i) => acc + val * vec2[i], 0);
  const magnitude1 = Math.sqrt(vec1.reduce((acc, val) => acc + val * val, 0));
  const magnitude2 = Math.sqrt(vec2.reduce((acc, val) => acc + val * val, 0));
  const similarity = dotProduct / (magnitude1 * magnitude2);
  console.log("Cosine similarity calculated.");
  return similarity;
}

const googleSearch = async (
  query: string,
  apiKey: string,
  cseId: string,
  numResults: number = 10,
  { db }: { db: typeof dbType },
) => {
  console.log("Starting Google search...");
  let searchResults: any[] = [];
  let start = 1;
  while (searchResults.length < numResults) {
    console.log(`Fetching results from ${start}...`);
    const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(`site:linkedin.com/in ${query}`)}&key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cseId)}&start=${encodeURIComponent(start)}`;
    try {
      const response = await axios.get(url);
      const results = response.data.items;
      if (results) {
        results.forEach((result: any) => {
          if (result.link.includes("linkedin.com/in")) {
            searchResults.push(result);
          }
        });
        if (results.length < 10) {
          console.log("Less than 10 results returned, breaking loop...");
          break;
        }
      } else {
        console.log("No results found, breaking loop...");
        break;
      }
    } catch (error) {
      console.error(`Error fetching search results: ${error}`);
      break;
    }
    start += 10;
  }
  console.log("Google search completed.");
  searchResults.map((s) => console.log(s.link));
  return searchResults;
};

const scrapeLinkedInProfile = async (
  linkedinUrl: string,
  { db }: { db: typeof dbType },
) => {
  console.log(`Scraping LinkedIn profile: ${linkedinUrl}`);
  const options = {
    method: "GET",
    url: `https://api.scrapin.io/enrichment/profile`,
    params: {
      apikey: "sk_live_66a7e55bc1d09007e25c5533_key_dnp74n04co7",
      linkedInUrl: linkedinUrl,
    },
  };

  try {
    const response = await axios.request(options);
    console.log(`Profile data retrieved for ${linkedinUrl}`);
    return response.data;
  } catch (error) {
    console.error(`Error fetching LinkedIn profile data: ${error}`);
    return null;
  }
};

const generateSummary = async (
  profileData: any,
  { db }: { db: typeof dbType },
) => {
  console.log("Generating summary for profile...");
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

const askCondition = async (
  condition: string,
  { db }: { db: typeof dbType },
) => {
  console.log(`Asking condition: ${condition}`);
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

  console.log("Condition response received.");
  return JSON.parse(
    completion.choices[0].message.content ?? '{ "condition": false }',
  ).condition;
};

const processLinkedInProfile = async (
  linkedinUrl: string,
  index: number,
  searchQuery: string,
  position: string,
  outboundId: string,
  { db }: { db: typeof dbType },
) => {
  console.log(`Processing LinkedIn profile #${index}: ${linkedinUrl}`);
  const profileData = await scrapeLinkedInProfile(linkedinUrl, { db });

  if (profileData && profileData.success) {
    const personData = profileData.person;
    const summary = await generateSummary(personData, { db });
    const workedInBigTech = await askCondition(
      `Has this person worked in big tech? ${JSON.stringify(
        personData.positions.positionHistory.map(
          (experience: any) => experience.companyName,
        ),
        null,
        2,
      )}`,
      { db },
    );

    const company = searchQuery.split(" ")[0];
    const workedAtRelevant = await askCondition(
      `Has this person worked at ${company}? ${JSON.stringify(
        personData.positions.positionHistory.map(
          (experience: any) => experience.companyName,
        ),
        null,
        2,
      )}`,
      { db },
    );

    const livesNearBrooklyn = await askCondition(
      `Does this person live within 50 miles of Brookyln? ${personData.location ?? "unknown location"}`,
      { db },
    );

    const workedInPosition = await askCondition(
      `Has this person have experience as ${position}? ${JSON.stringify(
        personData.positions.positionHistory.map(
          (experience: any) => experience,
        ),
        null,
        2,
      )}`,
      { db },
    );

    const userSummary = {
      summary,
      workedInBigTech,
      workedAtRelevant,
      livesNearBrooklyn,
      workedInPosition,
      url: linkedinUrl,
      linkedinData: personData,
    };

    // Insert candidate into candidates table
    await db.insert(candidatesTable).values({
      summary,
      workedInBigTech,
      workedAtRelevant,
      livesNearBrooklyn,
      workedInPosition,
      url: linkedinUrl,
      similarity: 0, // Will be calculated later
      weight: 0, // Will be calculated later
      linkedinData: personData,
    });

    // Update progress in the pendingOutbound table
    await db
      .update(pendingOutboundTable)
      .set({
        progress: Math.min((index / 10) * 100, 100), // Example calculation for progress
        status: `Processing profile #${index + 1}`,
      })
      .where(eq(pendingOutboundTable.outboundId, outboundId));

    console.log(`LinkedIn profile #${index} processed.`);
    return userSummary;
  }

  console.log(`LinkedIn profile #${index} failed to process.`);
  return null;
};

export const outbound = async (
  pendingOutbound: InferSelectModel<typeof pendingOutboundTable>,
  { db }: { db: typeof dbType },
) => {
  const {
    query: searchQuery,
    job: position,
    nearBrooklyn,
    outboundId,
  } = pendingOutbound;
  console.log("Starting main function...");
  const apiKey = process.env.GOOGLE_API_KEY!;
  const cseId = process.env.CSE_ID!;
  const query = `"${searchQuery}" AND "${position}" AND "New York"`;

  console.log("Performing Google search...");
  const googleResults = await googleSearch(query, apiKey, cseId, 10, { db });
  const linkedinUrls = googleResults.map((result) => result.link);
  console.log("Google search completed.");

  console.log("Processing LinkedIn profiles...");
  let profiles: any[] = [];
  for (let i = 0; i < linkedinUrls.length; i += 10) {
    const batch = linkedinUrls
      .slice(i, i + 10)
      .map((url, index) =>
        processLinkedInProfile(
          url,
          i + index,
          searchQuery,
          position,
          outboundId,
          { db },
        ),
      );

    const batchProfiles = await Promise.all(batch);
    profiles = profiles.concat(batchProfiles);

    console.log("Waiting for 5 seconds...");
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  console.log("LinkedIn profiles processed.");

  console.log("Getting job description embedding...");
  const jobDescriptionEmbedding = await getEmbedding(JOB_DESCRIPTION, { db });

  console.log("Evaluating and sorting profiles...");
  const finalists = [];
  const matched_engineers = [];

  for (const profile of profiles) {
    if (profile) {
      const profileEmbedding = await getEmbedding(profile.summary ?? "", {
        db,
      });
      const similarity = cosineSimilarity(
        jobDescriptionEmbedding,
        profileEmbedding,
        { db },
      );

      const weight =
        0.35 * similarity +
        0.15 * Number(profile.workedInPosition) +
        0.35 * Number(profile.workedAtRelevant) +
        0.15 * Number(profile.workedInBigTech) +
        0.35 * Number(profile.livesNearBrooklyn);

      // Update candidate with similarity and weight
      await db
        .update(candidatesTable)
        .set({ similarity, weight })
        .where(eq(candidatesTable.url, profile.url));

      if (profile.workedAtRelevant && profile.workedInPosition) {
        matched_engineers.push({ ...profile, similarity, weight });
      }

      finalists.push({ ...profile, similarity, weight });
    }
  }

  finalists.sort((a, b) => b.weight - a.weight);
  matched_engineers.sort((a, b) => b.weight - a.weight);
  console.log("Finalists evaluated and sorted.");

  // Update status and progress in the pendingOutbound table
  await db
    .update(pendingOutboundTable)
    .set({ progress: 100, status: "Scrape completed" })
    .where(eq(pendingOutboundTable.outboundId, outboundId));

  // Insert row in the outbound table
  await db.insert(outboundTable).values({
    user_id: pendingOutbound.userId,
    query: searchQuery,
    job: position,
    near_brooklyn: nearBrooklyn,
    matched: matched_engineers.map((engineer) => engineer.id),
  });

  console.log("Finalists written to outbound table.");

  // Update status to COMPLETED
  await db
    .update(pendingOutboundTable)
    .set({ status: "COMPLETED" })
    .where(eq(pendingOutboundTable.outboundId, outboundId));
};
