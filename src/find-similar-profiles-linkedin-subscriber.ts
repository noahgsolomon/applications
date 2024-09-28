import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "../server/db/schemas/users/schema";
import { z } from "zod";
import {
  candidates,
  pendingSimilarProfiles,
} from "@/server/db/schemas/users/schema";
import { eq, InferSelectModel } from "drizzle-orm";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import axios from "axios";
//@ts-ignore
import { v4 as uuid } from "uuid";
import dotenv from "dotenv";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

dotenv.config({
  path: "../.env",
});

const pool = new Pool({ connectionString: process.env.DB_URL });
export const db = drizzle(pool, {
  schema,
});

const inputSchema = z.object({
  profileUrls: z.array(z.string().url()),
});

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY || "",
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const index = pinecone.Index("whop");

async function getEmbedding(text: string) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-large",
    input: text,
    encoding_format: "float",
  });

  return response.data[0].embedding;
}

const generateEmbeddingsWithLogging = async (data: string[], type: string) => {
  console.log(`Generating ${type} embeddings for ${data.length} items...`);
  const embeddings = await Promise.all(
    data.map(async (item, index) => {
      try {
        console.log(
          `Generating ${type} embedding for item ${index + 1}/${data.length}`,
        );
        const embedding = await getEmbedding(item);
        console.log(
          `Successfully generated ${type} embedding for item ${index + 1}`,
        );
        return embedding;
      } catch (error) {
        console.error(
          `Error generating ${type} embedding for item ${index + 1}:`,
          error,
        );
        throw error;
      }
    }),
  );
  console.log(`Finished generating ${type} embeddings`);
  return embeddings;
};

function calculateExperienceBounds(
  candidates: Array<{
    linkedinData: {
      positions?: {
        positionHistory: Array<{
          startEndDate?: {
            start?: { year: number };
            end?: { year: number };
          };
        }>;
      };
    };
  }>,
): {
  lowerBound: number;
  upperBound: number;
  mean: number;
  stdDev: number;
} {
  const currentYear = new Date().getFullYear();
  const experiences: number[] = [];

  candidates.forEach((candidate) => {
    let earliestStartYear = currentYear;
    let latestEndYear = 0;

    if (candidate.linkedinData?.positions?.positionHistory) {
      candidate.linkedinData.positions.positionHistory.forEach((position) => {
        const startYear = position.startEndDate?.start?.year;
        const endYear = position.startEndDate?.end?.year || currentYear;

        if (startYear) {
          earliestStartYear = Math.min(earliestStartYear, startYear);
        }
        latestEndYear = Math.max(latestEndYear, endYear);
      });
    }

    const totalExperience = latestEndYear - earliestStartYear;
    experiences.push(totalExperience);
  });

  const mean =
    experiences.reduce((sum, exp) => sum + exp, 0) / experiences.length;

  const variance =
    experiences.reduce((sum, exp) => sum + Math.pow(exp - mean, 2), 0) /
    experiences.length;
  const stdDev = Math.sqrt(variance);

  const lowerBound = Math.max(0, Math.round(mean - 2 * stdDev));
  const upperBound = Math.round(mean + 2 * stdDev);

  console.log(
    `Experience statistics: Mean = ${mean.toFixed(2)}, StdDev = ${stdDev.toFixed(2)}`,
  );
  console.log(
    `Experience bounds: Lower = ${lowerBound} years, Upper = ${upperBound} years`,
  );

  return { lowerBound, upperBound, mean, stdDev };
}

function calculateExperienceScore(
  candidate: {
    linkedinData: {
      positions?: {
        positionHistory: Array<{
          startEndDate?: {
            start?: { year: number };
            end?: { year: number };
          };
        }>;
      };
    };
  },
  mean: number,
  stdDev: number,
): {
  experienceScore: number;
  totalExperience: number;
} {
  const currentYear = new Date().getFullYear();
  let earliestStartYear = currentYear;
  let latestEndYear = 0;

  if (candidate.linkedinData?.positions?.positionHistory) {
    candidate.linkedinData.positions.positionHistory.forEach((position) => {
      const startYear = position.startEndDate?.start?.year;
      const endYear = position.startEndDate?.end?.year || currentYear;
      if (startYear) {
        earliestStartYear = Math.min(earliestStartYear, startYear);
      }
      latestEndYear = Math.max(latestEndYear, endYear);
    });
  }

  const totalExperience = latestEndYear - earliestStartYear;

  let experienceScore = 0;
  if (stdDev !== 0) {
    const zScore = (totalExperience - mean) / stdDev;
    experienceScore = Math.exp(-(zScore * zScore) / 2);
  } else {
    experienceScore = 1;
  }

  return { experienceScore, totalExperience };
}

function analyzeCompanies(
  candidates: Array<{
    linkedinData: {
      positions: {
        positionHistory: Array<{
          companyName: string;
        }>;
      };
    };
  }>,
): Record<string, number> {
  const companyFrequency: Record<string, number> = {};
  let totalUniqueCandidateCompanies = 0;

  candidates.forEach((candidate) => {
    const uniqueCompanies = new Set(
      candidate.linkedinData.positions.positionHistory.map(
        (position) => position.companyName,
      ),
    );
    totalUniqueCandidateCompanies += uniqueCompanies.size;
    uniqueCompanies.forEach((company) => {
      companyFrequency[company] = (companyFrequency[company] || 0) + 1;
    });
  });

  const companyWeights = Object.entries(companyFrequency)
    .sort(([, a], [, b]) => b - a)
    .reduce<Record<string, number>>((acc, [company, frequency]) => {
      acc[company] = frequency / totalUniqueCandidateCompanies;
      return acc;
    }, {});

  console.log("Company weights:", companyWeights);
  return companyWeights;
}

function analyzeEducation(
  candidates: Array<{
    linkedinData: {
      schools: {
        educationHistory: Array<{
          schoolName: string;
        }>;
      };
    };
  }>,
): Record<string, number> {
  const educationFrequency: Record<string, number> = {};
  let totalEducations = 0;

  candidates.forEach((candidate) => {
    const schools = candidate.linkedinData.schools.educationHistory.map(
      (education) => education.schoolName,
    );
    totalEducations += schools.length;
    schools.forEach((school) => {
      educationFrequency[school] = (educationFrequency[school] || 0) + 1;
    });
  });

  const minFrequencyThreshold = Math.ceil(candidates.length * 0.75);

  const significantSchools = Object.entries(educationFrequency)
    .filter(([, frequency]) => frequency >= minFrequencyThreshold)
    .sort(([, a], [, b]) => b - a);

  const totalSignificantEducations = significantSchools.reduce(
    (sum, [, freq]) => sum + freq,
    0,
  );

  const educationWeights = significantSchools.reduce<Record<string, number>>(
    (acc, [school, frequency]) => {
      acc[school] = frequency / totalSignificantEducations;
      return acc;
    },
    {},
  );

  console.log(
    `Education weights (minimum frequency: ${minFrequencyThreshold}):`,
    educationWeights,
  );
  return educationWeights;
}

function analyzeNYCProximity(
  candidates: Array<{ livesNearBrooklyn: boolean | null }>,
): boolean {
  const nycCount = candidates.filter((c) => c.livesNearBrooklyn).length;
  const nycRatio = nycCount / candidates.length;
  const shouldApplyNYCWeight = nycRatio >= 0.5;

  console.log(`NYC proximity ratio: ${nycRatio.toFixed(2)}`);
  console.log(`Applying NYC proximity weighting: ${shouldApplyNYCWeight}`);

  return shouldApplyNYCWeight;
}

async function computeAverageEmbedding(
  embeddings: number[][],
): Promise<number[]> {
  if (embeddings.length === 0) {
    throw new Error("No embeddings provided to compute average");
  }
  return embeddings.reduce(
    (acc, embedding) =>
      acc.map((val, i) => val + embedding[i] / embeddings.length),
    new Array(embeddings[0].length).fill(0),
  );
}

async function queryVectorDb(
  namespace: string,
  queryVector: number[],
  topK: number,
  retries = 3,
): Promise<Array<{ id: string; score: number }>> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(
        `Attempting to query Pinecone (attempt ${attempt}/${retries})...`,
      );
      const queryResponse = await index.namespace(namespace).query({
        topK,
        vector: queryVector,
        includeMetadata: true,
        includeValues: false,
      });

      console.log("Success");

      if (!queryResponse || !queryResponse.matches) {
        console.error("Invalid response from Pinecone:", queryResponse);
        if (attempt < retries) {
          console.log(`Retrying in 5 seconds...`);
          await new Promise((resolve) => setTimeout(resolve, 5000));
          continue;
        }
        return [];
      }

      return queryResponse.matches.map((match) => ({
        id: match.id,
        score: match.score || 0,
      }));
    } catch (error) {
      console.error(
        `Error querying vector DB (namespace: ${namespace}, attempt: ${attempt}):`,
        error,
      );
      if (attempt < retries) {
        console.log(`Retrying in 5 seconds...`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
      } else {
        console.error(
          `All ${retries} attempts failed. Returning empty result.`,
        );
        return [];
      }
    }
  }
  return [];
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
  await db
    .insert(schema.candidates)
    .values({
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
    })
    .onConflictDoNothing();

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

export async function handler(event: any) {
  console.log(event);
  const body = JSON.parse(event.Records[0].body);

  try {
    const insert = await db
      .insert(schema.pendingSimilarProfiles)
      .values({
        type: "LINKEDIN",
        urls: body.profileUrls,
        progress: 0,
        message: "Beginning search.",
      })
      .returning();

    const insertId = insert[0].id;

    console.log("Row inserted successfully");

    const input = inputSchema.parse(body);

    console.log("Starting findSimilarProfiles");

    const inputCandidates: InferSelectModel<typeof schema.candidates>[] = [];
    const batchSize = 50;

    for (let i = 0; i < input.profileUrls.length; i += batchSize) {
      const batch = input.profileUrls.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (profileUrl) => {
          let candidate = await db.query.candidates.findFirst({
            where: eq(candidates.url, profileUrl),
          });

          if (!candidate) {
            console.log(
              `Candidate not found for URL: ${profileUrl}. Scraping and inserting.`,
            );
            const scrapedData = await scrapeLinkedInProfile(profileUrl);
            if (scrapedData && scrapedData.success) {
              const candidateId = await insertCandidate(scrapedData.person);
              candidate = await db.query.candidates.findFirst({
                where: eq(candidates.id, candidateId),
              });
            } else {
              console.error(
                `Failed to scrape or insert candidate for URL: ${profileUrl}`,
              );
            }
          }

          return candidate;
        }),
      );

      inputCandidates.push(
        ...batchResults.filter(
          (c): c is InferSelectModel<typeof schema.candidates> =>
            c !== undefined,
        ),
      );
    }

    if (inputCandidates.length === 0) {
      console.log("No matching input candidates found");
      await db
        .update(pendingSimilarProfiles)
        .set({ error: true })
        .where(eq(pendingSimilarProfiles.id, insertId));
    }

    console.log(`Found ${inputCandidates.length} matching input candidates.`);

    // Calculate experience bounds
    const { mean, stdDev } = calculateExperienceBounds(inputCandidates);

    const inputCandidateIds = new Set(inputCandidates.map((c) => c.id));

    // Analyze input candidates
    const companyWeights = analyzeCompanies(inputCandidates);
    const educationWeights = analyzeEducation(inputCandidates);
    const shouldApplyNYCWeight = analyzeNYCProximity(inputCandidates);

    // Generate embeddings

    const skillEmbeddings = await generateEmbeddingsWithLogging(
      inputCandidates.flatMap((c) => c.topTechnologies || []),
      "skill",
    );
    const featureEmbeddings = await generateEmbeddingsWithLogging(
      inputCandidates.flatMap((c) => c.topFeatures || []),
      "feature",
    );
    const jobTitleEmbeddings = await generateEmbeddingsWithLogging(
      inputCandidates.flatMap((c) => c.jobTitles || []),
      "job title",
    );

    // Compute average embeddings
    const avgSkillEmbedding = await computeAverageEmbedding(skillEmbeddings);
    const avgFeatureEmbedding =
      await computeAverageEmbedding(featureEmbeddings);
    const avgJobTitleEmbedding =
      await computeAverageEmbedding(jobTitleEmbeddings);

    // Query vector DB
    const skillMatches = await queryVectorDb(
      "candidate-skill-average",
      avgSkillEmbedding,
      10_000,
    );
    const featureMatches = await queryVectorDb(
      "candidate-feature-average",
      avgFeatureEmbedding,
      10_000,
    );
    const jobTitleMatches = await queryVectorDb(
      "candidate-job-title-average",
      avgJobTitleEmbedding,
      10_000,
    );

    if (
      skillMatches.length === 0 &&
      featureMatches.length === 0 &&
      jobTitleMatches.length === 0
    ) {
      console.error("All vector DB queries failed");
      await db
        .update(pendingSimilarProfiles)
        .set({ error: true })
        .where(eq(pendingSimilarProfiles.id, insertId));
    }

    const combinedScores: Record<string, number> = {};

    // Combine scores from vector DB matches
    console.log("Combining scores from vector DB matches...");
    [skillMatches, featureMatches, jobTitleMatches].forEach((matches) => {
      matches.forEach((match) => {
        if (!inputCandidateIds.has(match.id)) {
          combinedScores[match.id] =
            (combinedScores[match.id] || 0) + match.score;
        }
      });
    });
    console.log("Vector DB scores combined.");

    // Fetch all candidates
    console.log("Fetching all candidates...");
    const allCandidates = await db.query.candidates.findMany();
    console.log(`Fetched ${allCandidates.length} candidates.`);

    // Process candidates in batches
    const processBatchSize = 100000;
    console.log(`Processing candidates in batches of ${processBatchSize}...`);
    for (let i = 0; i < allCandidates.length; i += processBatchSize) {
      const batch = allCandidates.slice(i, i + processBatchSize);
      console.log(`Processing batch ${i / processBatchSize + 1}...`);

      batch.forEach((candidate) => {
        if (!inputCandidateIds.has(candidate.id)) {
          const { experienceScore } = calculateExperienceScore(
            candidate,
            mean,
            stdDev,
          );
          const experienceWeight = 0.2;
          combinedScores[candidate.id] =
            (combinedScores[candidate.id] || 0) +
            experienceScore * experienceWeight;

          // Add company and education scores
          if (candidate.linkedinData?.positions?.positionHistory) {
            const companies =
              candidate.linkedinData.positions.positionHistory.map(
                (position: any) => position.companyName,
              );
            const companyScore = companies.reduce(
              (score: number, company: any) =>
                score + (companyWeights[company] || 0),
              0,
            );
            combinedScores[candidate.id] += companyScore;
          }

          if (candidate.linkedinData?.schools?.educationHistory) {
            const schools = candidate.linkedinData.schools.educationHistory.map(
              (education: any) => education.schoolName,
            );
            const educationScore = schools.reduce(
              (score: number, school: any) =>
                score + (educationWeights[school] || 0),
              0,
            );
            combinedScores[candidate.id] += educationScore;
          }
          // Apply NYC proximity weighting
          if (shouldApplyNYCWeight && candidate.livesNearBrooklyn) {
            combinedScores[candidate.id] *= 1.2; // 20% boost for NYC proximity
          }
        }
      });
      console.log(`Batch ${i / processBatchSize + 1} processed.`);
    }

    // Sort and select top candidates
    console.log("Sorting and selecting top candidates...");
    const topCandidates = allCandidates
      .filter((candidate) => !inputCandidateIds.has(candidate.id))
      .map((candidate) => {
        const { experienceScore, totalExperience } = calculateExperienceScore(
          candidate,
          mean,
          stdDev,
        );
        return {
          ...candidate,
          score: combinedScores[candidate.id] || 0,
          experienceScore,
          totalExperience,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 100);
    console.log(`Selected ${topCandidates.length} top candidates.`);

    await db
      .update(pendingSimilarProfiles)
      .set({ response: topCandidates, success: true })
      .where(eq(pendingSimilarProfiles.id, insertId));
  } catch (error) {
    console.error("Error inserting row:", error);
  }
}
