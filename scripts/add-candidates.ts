import { candidates } from "@/server/db/schemas/users/schema";
import { and, eq, isNotNull, ne } from "drizzle-orm";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import axios from "axios";
import * as schema from "@/server/db/schemas/users/schema";
//@ts-ignore
import { v4 as uuid } from "uuid";
import dotenv from "dotenv";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

dotenv.config({ path: "../.env" });

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY || "",
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const index = pinecone.Index("whop");

const pool = new Pool({ connectionString: process.env.DB_URL });
export const db = drizzle(pool, {
  schema,
});

async function getEmbedding(text: string) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-large",
    input: text,
    encoding_format: "float",
  });

  return response.data[0].embedding;
}

async function scrapeLinkedInProfile(linkedinUrl: string) {
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
}

async function generateMiniSummary(profileData: any) {
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
}

async function gatherTopSkills(profileData: any) {
  console.log("Gathering top skills from profile data...");
  const skills = profileData.skills || [];
  const positions = profileData.positions.positionHistory
    .map((position: any) => position.description)
    .join(" ");

  const profileSummary = { skills, positions };

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
}

async function askCondition(condition: string) {
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
}

async function generateSummary(profileData: any) {
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
}

async function upsertToVectorDB(
  id: string,
  namespace: string,
  items: string[],
  candidateId: string,
  name: string,
) {
  for (const item of items) {
    if (/^[\x00-\x7F]*$/.test(item)) {
      const embedding = await getEmbedding(item);
      await index.namespace(namespace).upsert([
        {
          id: id,
          values: embedding,
          metadata: {
            candidateId,
            [name]: item,
          },
        },
      ]);
    } else {
      console.log(`Skipping non-ASCII item: ${item}`);
    }
  }
}

async function computeAndStoreAverage(
  id: string,
  namespace: string,
  items: string[],
  candidateId: string,
  name: string,
) {
  if (items.length === 0) return;

  const embeddings = await Promise.all(items.map(getEmbedding));
  const averageEmbedding = embeddings.reduce(
    (acc, embedding) =>
      acc.map((val, i) => val + embedding[i] / embeddings.length),
    new Array(embeddings[0].length).fill(0),
  );

  await index.namespace(namespace).upsert([
    {
      id: id,
      values: averageEmbedding,
      metadata: {
        userId: candidateId,
        [name]: items,
      },
    },
  ]);
}

async function insertCandidate(profileData: any) {
  console.log("Inserting candidate into the database...");
  const miniSummary = await generateMiniSummary(profileData);
  const { tech, features, isEngineer } = await gatherTopSkills(profileData);

  // Extract job titles
  const jobTitles = profileData.positions.positionHistory.map(
    (position: any) => position.title,
  );

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

  // Insert into database
  await db.insert(schema.candidates).values({
    id: candidateId,
    url: profileData.linkedInUrl as string,
    linkedinData: profileData,
    miniSummary,
    summary,
    topTechnologies: tech,
    topFeatures: features,
    jobTitles,
    isEngineer,
    workedInBigTech,
    livesNearBrooklyn,
    createdAt: new Date(),
  });

  console.log(
    `Candidate ${profileData.firstName} ${profileData.lastName} inserted into the database. Candidate ID: ${candidateId}`,
  );

  // Upsert individual items to vector DB

  if (tech.length > 0) {
    await upsertToVectorDB(
      candidateId,
      "technologies",
      tech,
      candidateId,
      "technology",
    );
  }

  if (jobTitles.length > 0) {
    await upsertToVectorDB(
      candidateId,
      "job-titles",
      jobTitles,
      candidateId,
      "jobTitle",
    );
  }

  // Compute and store averages
  if (tech.length > 0) {
    await computeAndStoreAverage(
      candidateId,
      "candidate-skill-average",
      tech,
      candidateId,
      "skills",
    );
  }

  if (features.length > 0) {
    await computeAndStoreAverage(
      candidateId,
      "candidate-feature-average",
      features,
      candidateId,
      "features",
    );
  }

  if (jobTitles.length > 0) {
    await computeAndStoreAverage(
      candidateId,
      "candidate-job-title-average",
      jobTitles,
      candidateId,
      "jobTitles",
    );
  }

  // Update flags in the database
  await db
    .update(schema.candidates)
    .set({
      isSkillAvgInVectorDB: true,
      isFeatureAvgInVectorDB: true,
      isJobTitleAvgInVectorDB: true,
    })
    .where(eq(schema.candidates.id, candidateId));

  return candidateId;
}

async function main() {
  try {
    const input = await db.query.githubUsers.findMany({
      columns: { linkedinUrl: true },
      where: and(
        isNotNull(schema.githubUsers.linkedinUrl),
        ne(schema.githubUsers.linkedinUrl, ""),
      ),
    });

    console.log("Starting findSimilarProfiles");

    const batchSize = 10;
    const delay = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));
    const profileUrls = input.map((user) => user.linkedinUrl!);

    for (let i = 0; i < profileUrls.length; i += batchSize) {
      const batch = profileUrls.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (profileUrl) => {
          let candidate = await db.query.candidates.findFirst({
            where: eq(candidates.url, profileUrl),
            columns: { id: true },
          });

          if (!candidate) {
            console.log(
              `Candidate not found for URL: ${profileUrl}. Scraping and inserting.`,
            );
            const scrapedData = await scrapeLinkedInProfile(profileUrl);
            if (scrapedData && scrapedData.success) {
              await insertCandidate(scrapedData.person);
            } else {
              console.error(
                `Failed to scrape or insert candidate for URL: ${profileUrl}`,
              );
            }
          } else {
            console.log("user already exists. skipping");
          }
        }),
      );

      if (i + batchSize < profileUrls.length) {
        console.log("Waiting 1 second before processing next batch...");
        await delay(1000);
      }
    }
  } catch (error) {
    console.error("Error in findSimilarProfiles:", error);
  }
}

main().then(() => console.log("Process Completed"));
