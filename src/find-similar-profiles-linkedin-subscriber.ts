import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "../server/db/schemas/users/schema";
import { z } from "zod";
import {
  candidates,
  jobTitles,
  people,
  profileQueue,
  skills,
} from "@/server/db/schemas/users/schema";
import {
  and,
  cosineDistance,
  desc,
  eq,
  exists,
  gte,
  inArray,
  InferSelectModel,
  not,
  sql,
} from "drizzle-orm";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import axios from "axios";
//@ts-ignore
import { v4 as uuid } from "uuid";
import dotenv from "dotenv";
import ws from "ws";
import { jsonArrayContainsAny } from "@/lib/utils";

neonConfig.webSocketConstructor = ws;

dotenv.config({
  path: "../.env",
});

const pool = new Pool({ connectionString: process.env.DB_URL });
export const db = drizzle(pool, {
  schema,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

async function getEmbedding(text: string) {
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
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
    linkedinData: any;
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
      candidate.linkedinData.positions.positionHistory.forEach(
        (position: any) => {
          const startYear = position.startEndDate?.start?.year;
          const endYear = position.startEndDate?.end?.year || currentYear;

          if (startYear) {
            earliestStartYear = Math.min(earliestStartYear, startYear);
          }
          latestEndYear = Math.max(latestEndYear, endYear);
        },
      );
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
    linkedinData: any;
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
    candidate.linkedinData.positions.positionHistory.forEach(
      (position: any) => {
        const startYear = position.startEndDate?.start?.year;
        const endYear = position.startEndDate?.end?.year || currentYear;
        if (startYear) {
          earliestStartYear = Math.min(earliestStartYear, startYear);
        }
        latestEndYear = Math.max(latestEndYear, endYear);
      },
    );
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
    linkedinData: any;
  }>,
): Record<string, number> {
  const companyFrequency: Record<string, number> = {};
  let totalUniqueCandidateCompanies = 0;

  candidates.forEach((candidate) => {
    const uniqueCompanies = new Set(
      candidate.linkedinData.positions.positionHistory.map(
        (position: any) => position.companyName,
      ),
    ) as Set<string>;
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
    linkedinData: any;
  }>,
): Record<string, number> {
  const educationFrequency: Record<string, number> = {};
  let totalEducations = 0;

  candidates.forEach((candidate) => {
    const schools = candidate.linkedinData.schools.educationHistory.map(
      (education: any) => education.schoolName,
    );
    totalEducations += schools.length;
    schools.forEach((school: any) => {
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

async function insertPersonFromLinkedin(profileData: any) {
  console.log("Inserting person into the database...");

  // Generate summaries and gather skills
  const miniSummary = await generateMiniSummary(profileData);
  const { tech, features, isEngineer } = await gatherTopSkills(profileData);

  // Extract job titles
  const jobTitlesList = profileData.positions.positionHistory.map(
    (position: any) => position.title,
  ) as string[];

  // Check additional conditions
  console.log("Checking additional conditions for person...");
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

  // Generate detailed summary
  const summary = await generateSummary(profileData);
  const personId = uuid();

  // Compute location vector if location is provided
  let locationVector: number[] | null = null;
  if (profileData.location) {
    locationVector = await getEmbedding(profileData.location);
  }

  // Insert into `people` table
  try {
    await db
      .insert(people)
      .values({
        id: personId,
        linkedinUrl: profileData.linkedInUrl as string,
        linkedinData: profileData,
        name: `${profileData.firstName} ${profileData.lastName}`.trim(),
        miniSummary,
        summary,
        topTechnologies: tech,
        topFeatures: features,
        jobTitles: jobTitlesList,
        isEngineer,
        workedInBigTech,
        livesNearBrooklyn,
        createdAt: new Date(),
        locationVector,
      })
      .onConflictDoNothing();

    console.log(
      `Person ${profileData.firstName} ${profileData.lastName} inserted into the database. Person ID: ${personId}`,
    );
  } catch (e) {
    console.log(
      `Failed to insert person ${profileData.firstName} ${profileData.lastName} into the database.`,
    );
  }

  // Insert skills with embeddings
  if (tech.length > 0 || features.length > 0) {
    await Promise.all(
      [...tech, ...features].map(async (skill) => {
        try {
          const skillVector = await getEmbedding(skill);
          await db.insert(skills).values({
            personId: personId,
            skill: skill,
            vector: skillVector,
          });
          console.log(
            `[insertSkill] Inserted skill "${skill}" for person ID: ${personId}`,
          );
        } catch (error) {
          console.error(
            `[insertSkill] Failed to insert skill "${skill}" for person ID: ${personId}`,
            error,
          );
        }
      }),
    );
  }

  // Insert job titles with embeddings
  if (jobTitlesList.length > 0) {
    await Promise.all(
      jobTitlesList.map(async (title) => {
        try {
          const titleVector = await getEmbedding(title);
          await db.insert(jobTitles).values({
            personId: personId,
            title: title,
            vector: titleVector,
          });
          console.log(
            `[insertJobTitle] Inserted job title "${title}" for person ID: ${personId}`,
          );
        } catch (error) {
          console.error(
            `[insertJobTitle] Failed to insert job title "${title}" for person ID: ${personId}`,
            error,
          );
        }
      }),
    );
  }

  return personId;
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  const dotProduct = vecA.reduce((sum, a, idx) => sum + a * vecB[idx], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return magnitudeA && magnitudeB ? dotProduct / (magnitudeA * magnitudeB) : 0;
}

async function processLinkedinUrls(profileUrls: string[], insertId: string) {
  console.log("Processing LinkedIn URLs...");

  // Insert a new entry into `profileQueue`
  await db
    .insert(profileQueue)
    .values({
      id: insertId, // Assuming `insertId` is used as the primary key
      type: "LINKEDIN",
      urls: profileUrls,
      progress: 0,
      message: "Beginning search.",
    })
    .onConflictDoNothing(); // Prevent duplicate entries if necessary

  const inputPeople: InferSelectModel<typeof people>[] = [];
  const batchSize = 50;

  // Process URLs in batches
  for (let i = 0; i < profileUrls.length; i += batchSize) {
    const batch = profileUrls.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (profileUrl) => {
        let person = await db.query.people.findFirst({
          where: eq(people.linkedinUrl, profileUrl),
        });

        if (!person) {
          console.log(
            `Person not found for URL: ${profileUrl}. Scraping and inserting.`,
          );
          const scrapedData = await scrapeLinkedInProfile(profileUrl);
          if (scrapedData && scrapedData.success) {
            const personId = await insertPersonFromLinkedin(scrapedData.person);
            person = await db.query.people.findFirst({
              where: eq(people.id, personId),
            });
          } else {
            console.error(
              `Failed to scrape or insert person for URL: ${profileUrl}`,
            );
          }
        }

        return person;
      }),
    );

    inputPeople.push(
      ...batchResults.filter(
        (p): p is InferSelectModel<typeof people> => p !== undefined,
      ),
    );
  }

  if (inputPeople.length === 0) {
    console.log("No matching input people found");
    return [];
  }

  console.log(`Found ${inputPeople.length} matching input people.`);

  // Calculate experience bounds
  const { mean, stdDev } = calculateExperienceBounds(inputPeople);

  const inputPersonIds = new Set(inputPeople.map((p) => p.id));

  // Analyze input people
  const companyWeights = analyzeCompanies(inputPeople);
  const educationWeights = analyzeEducation(inputPeople);
  const shouldApplyNYCWeight = analyzeNYCProximity(inputPeople);

  // Generate embeddings for skills, features, and job titles
  const allSkills = inputPeople.flatMap((p) => p.topTechnologies || []);
  const allFeatures = inputPeople.flatMap((p) => p.topFeatures || []);
  const allJobTitles = inputPeople.flatMap((p) => p.jobTitles || []);

  const skillEmbeddings = await generateEmbeddingsWithLogging(
    allSkills,
    "skill",
  );
  const featureEmbeddings = await generateEmbeddingsWithLogging(
    allFeatures,
    "feature",
  );
  const jobTitleEmbeddings = await generateEmbeddingsWithLogging(
    allJobTitles,
    "job title",
  );

  // Compute average embeddings
  const avgSkillEmbedding = await computeAverageEmbedding(skillEmbeddings);
  const avgFeatureEmbedding = await computeAverageEmbedding(featureEmbeddings);
  const avgJobTitleEmbedding =
    await computeAverageEmbedding(jobTitleEmbeddings);

  // Fetch all people excluding input people
  console.log("Fetching all people...");
  const allPeople = await db.query.people.findMany({
    where: not(inArray(people.id, Array.from(inputPersonIds))),
  });
  console.log(`Fetched ${allPeople.length} people.`);

  // Initialize combined scores
  const combinedScores: Record<string, number> = {};

  // Compute similarity scores using average vectors stored in `people` table
  console.log("Computing similarity scores...");
  await Promise.all(
    allPeople.map(async (person) => {
      let score = 0;

      // Experience Score
      const { experienceScore } = calculateExperienceScore(
        person,
        mean,
        stdDev,
      );
      const experienceWeight = 0.2;
      score += experienceScore * experienceWeight;

      // Company Score
      if ((person.linkedinData as any)?.positions?.positionHistory) {
        const companies = (
          person.linkedinData as any
        ).positions.positionHistory.map(
          (position: any) => position.companyName,
        );
        const companyScore = companies.reduce(
          (s: number, company: string) => s + (companyWeights[company] || 0),
          0,
        );
        score += companyScore;
      }

      // Education Score
      if ((person.linkedinData as any)?.schools?.educationHistory) {
        const schools = (
          person.linkedinData as any
        ).schools.educationHistory.map(
          (education: any) => education.schoolName,
        );
        const educationScore = schools.reduce(
          (s: number, school: string) => s + (educationWeights[school] || 0),
          0,
        );
        score += educationScore;
      }

      // NYC Proximity Weighting
      if (shouldApplyNYCWeight && person.livesNearBrooklyn) {
        score *= 1.2; // 20% boost for NYC proximity
      }

      // Skills Similarity
      if (person.averageSkillVector) {
        const similarity = cosineSimilarity(
          avgSkillEmbedding,
          person.averageSkillVector,
        );
        score += similarity;
      }

      // Job Titles Similarity
      if (person.averageJobTitleVector) {
        const similarity = cosineSimilarity(
          avgJobTitleEmbedding,
          person.averageJobTitleVector,
        );
        score += similarity;
      }

      // Location Similarity
      if (
        person.locationVector &&
        avgSkillEmbedding.length === person.locationVector.length
      ) {
        const locationSimilarity = cosineSimilarity(
          avgSkillEmbedding,
          person.locationVector,
        );
        score += locationSimilarity;
      }

      combinedScores[person.id] = (combinedScores[person.id] || 0) + score;
    }),
  );

  // Sort and select top candidates
  console.log("Sorting and selecting top candidates...");
  const topCandidates = allPeople
    .map((person) => ({
      ...person,
      score: combinedScores[person.id] || 0,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 100);
  console.log(`Selected ${topCandidates.length} top candidates.`);

  return topCandidates;
}

export const querySimilarTechnologies = async (
  inputSkill: string,
  topK: number = 250,
) => {
  try {
    console.log(
      `[1] Starting search for similar technologies to: "${inputSkill}"`,
    );

    // Step 1: Generate embedding for the input skill
    const embedding = await getEmbedding(inputSkill);
    console.log(`[2] Embedding generated for: "${inputSkill}"`);

    // Step 2: Perform similarity search directly in PostgreSQL
    const similarity = sql<number>`1 - (${cosineDistance(schema.skillsNew.vector, embedding)})`;

    const similarSkills = await db
      .select({
        technology: schema.skillsNew.skill,
        similarity,
        personIds: schema.skillsNew.personIds,
      })
      .from(schema.skillsNew)
      .orderBy(cosineDistance(schema.skillsNew.vector, embedding))
      .limit(topK);

    console.log(
      `[3] Retrieved ${similarSkills.length} similar technologies after similarity search.`,
    );

    // Optional: Filter based on a threshold if necessary
    /*
    const threshold = 0.7;
    const filteredSimilarities = similarSkills.filter(s => s.similarity >= threshold);
    console.log(`[4] Found ${filteredSimilarities.length} similar technologies after filtering.`);
    */

    // Return the similar technologies with similarity scores
    const result = similarSkills.map((s) => ({
      technology: s.technology,
      score: parseFloat(s.similarity.toFixed(6)),
      personIds: s.personIds,
    }));

    console.log(`[5] Returning ${result.length} similar technologies.`);
    console.log(
      `Number of matches users: ${similarSkills.reduce((acc, curr) => acc + (curr.personIds?.length ?? 0), 0)}`,
    );
    return result;
  } catch (error) {
    console.error("Error querying similar technologies:", error);
    return [];
  }
};

export const querySimilarJobTitles = async (
  inputJobTitle: string,
  topK: number = 500,
) => {
  try {
    console.log(
      `[1] Starting search for similar job titles to: "${inputJobTitle}"`,
    );

    // Step 1: Generate embedding for the input job title
    const embedding = await getEmbedding(inputJobTitle);
    console.log(`[2] Embedding generated for: "${inputJobTitle}"`);

    // Step 2: Perform similarity search directly in PostgreSQL
    const similarity = sql<number>`1 - (${cosineDistance(schema.jobTitlesVectorNew.vector, embedding)})`;

    const similarJobTitles = await db
      .select({
        jobTitle: schema.jobTitlesVectorNew.jobTitle,
        similarity,
        personIds: schema.jobTitlesVectorNew.personIds,
      })
      .from(schema.jobTitlesVectorNew)
      .orderBy(cosineDistance(schema.jobTitlesVectorNew.vector, embedding))
      .limit(topK);

    console.log(
      `[3] Retrieved ${similarJobTitles.length} similar job titles after similarity search.`,
    );

    // Optional: Filter based on a threshold if necessary
    /*
    const threshold = 0.7;
    const filteredSimilarities = similarJobTitles.filter(s => s.similarity >= threshold);
    console.log(`[4] Found ${filteredSimilarities.length} similar job titles after filtering.`);
    */

    // Return the similar job titles with similarity scores

    const result = similarJobTitles
      .filter((s) => s.personIds !== null && s.personIds.length > 0)
      .map((s) => ({
        jobTitle: s.jobTitle,
        score: parseFloat(s.similarity.toFixed(6)),
        personIds: s.personIds!,
      }));

    console.log(`[5] Returning ${result.length} similar job titles.`);
    console.log(
      `Number of matching users: ${similarJobTitles.reduce((acc, curr) => acc + (curr.personIds?.length ?? 0), 0)}`,
    );
    return result;
  } catch (error) {
    console.error("Error querying similar job titles:", error);
    return [];
  }
};

async function processFilterCriteria(
  filterCriteria: {
    query: string;
    job: string;
    relevantRoleId?: string;
    nearBrooklyn: boolean;
    searchInternet: boolean;
    skills: string[];
    // features: string[];
    booleanSearch?: string;
    companyIds: string[];
    location?: string;
    activeGithub?: boolean;
    whopUser?: boolean;
    school?: string;
    fieldOfStudy?: string;
  },
  insertId: string,
) {
  console.log("Processing filter criteria...");

  let locationEmbedding = null;
  if (filterCriteria.location) {
    locationEmbedding = await getEmbedding(filterCriteria.location);
  }

  const mostSimilarPeople: {
    score: number;
    data: InferSelectModel<typeof people>;
  }[] = [];

  // Extract similar technologies and job titles
  const similarTechnologiesArrays = await Promise.all(
    filterCriteria.skills.map((skill) => querySimilarTechnologies(skill)),
  );

  // Flatten the array and extract unique personIds
  const similarTechnologiesPersonIds = Array.from(
    new Set(
      similarTechnologiesArrays.flatMap((arr) =>
        arr.flatMap((item) => item.personIds || []),
      ),
    ),
  );

  // Fetch users from the database
  const usersFromSimilarTechnologiesArray = await db.query.people.findMany({
    where: inArray(people.id, similarTechnologiesPersonIds),
  });

  // Add users from similar technologies array to mostSimilarPeople
  usersFromSimilarTechnologiesArray.forEach((user) => {
    const userScore = Math.max(
      ...similarTechnologiesArrays.map((techArray) => {
        const matchingTech = techArray.find((tech) =>
          tech.personIds?.includes(user.id),
        );
        return matchingTech?.score || 0;
      }),
    );
    const existingEntry = mostSimilarPeople.find(
      (entry) => entry.data.id === user.id,
    );
    if (existingEntry) {
      existingEntry.score += userScore;
    } else {
      mostSimilarPeople.push({
        score: userScore,
        data: user,
      });
    }
  });

  let similarJobTitlesArray: {
    jobTitle: string;
    score: number;
    personIds: string[];
  }[] = [];
  if (filterCriteria.job && filterCriteria.job !== "") {
    const similarJobTitles = await querySimilarJobTitles(filterCriteria.job);
    similarJobTitlesArray = similarJobTitles;

    // Extract unique personIds from similar job titles
    const similarJobTitlesPersonIds = Array.from(
      new Set(similarJobTitles.flatMap((item) => item.personIds || [])),
    );

    // Fetch users from the database for similar job titles
    const usersFromSimilarJobTitlesArray = await db.query.people.findMany({
      where: inArray(people.id, similarJobTitlesPersonIds),
    });

    // Add users from similar job titles array to mostSimilarPeople
    usersFromSimilarJobTitlesArray.forEach((user) => {
      const userScore = Math.max(
        ...similarJobTitles.map((jobTitle) => {
          const matchingJobTitle = jobTitle.personIds?.includes(user.id);
          return matchingJobTitle ? jobTitle.score : 0;
        }),
      );
      const existingEntry = mostSimilarPeople.find(
        (entry) => entry.data.id === user.id,
      );
      if (existingEntry) {
        existingEntry.score += userScore;
      } else {
        mostSimilarPeople.push({
          score: userScore,
          data: user,
        });
      }
    });
  }
  // Sort candidates by score in descending order
  const sortedCandidates = mostSimilarPeople.sort((a, b) => b.score - a.score);

  // Truncate to 100 candidates and extract only the data
  const topCandidates = sortedCandidates
    .slice(0, 100)
    .map((candidate) => candidate.data);

  console.log("Filter criteria processing completed.");
  return {
    candidates: topCandidates,
    allMatchingSkills: similarTechnologiesArrays
      .flat()
      .map((t) => t.technology),
    allMatchingJobTitles: similarJobTitlesArray.map((j) => j.jobTitle),
  };
}

function mergeResults(...resultsArrays: any[][]): any[] {
  const idSet = new Set();
  const mergedResults: any[] = [];

  for (const resultsArray of resultsArrays) {
    for (const item of resultsArray) {
      if (!idSet.has(item.id)) {
        idSet.add(item.id);
        mergedResults.push(item);
      }
    }
  }

  return mergedResults;
}

export async function handler(event: any) {
  console.log("Queue handler invoked.");
  const body = JSON.parse(event.Records[0].body);
  console.log("Queue item:", JSON.stringify(body, null, 2));

  // Insert into profileQueue
  const insert = await db
    .insert(schema.profileQueue)
    .values({
      type: "LINKEDIN",
      urls: body.profileUrls || [],
      progress: 0,
      message: "Beginning search.",
    })
    .returning();

  const insertId = insert[0].id;

  try {
    let resultsFromLinkedinUrls: any[] = [];
    let resultsFromGithubUrls: any[] = [];
    let resultsFromFilterCriteria: any[] = [];

    let allMatchingSkills: string[] = [];
    let allMatchingJobTitles: string[] = [];

    if (body.linkedinUrls && body.linkedinUrls.length > 0) {
      try {
        console.log("Processing Linkedin URLs...");
        resultsFromLinkedinUrls = await processLinkedinUrls(
          body.linkedinUrls,
          insertId,
        );
      } catch (error) {
        console.error("Error processing profile URLs:", error);
      }
    }

    if (body.githubUrls && body.githubUrls.length > 0) {
      console.log("Processing GitHub URLs...");
      // try {
      //   console.log("Processing profile URLs...");
      //   resultsFromGithubUrls = await processProfileUrls(
      //     body.githubUrls,
      //     insertId,
      //   );
      // } catch (error) {
      //   console.error("Error processing profile URLs:", error);
      // }
    }

    if (body.filterCriteria) {
      try {
        console.log("Processing filter criteria...");
        const filterCriteria = await processFilterCriteria(
          body.filterCriteria,
          insertId,
        );
        resultsFromFilterCriteria = filterCriteria.candidates;
        allMatchingSkills = filterCriteria.allMatchingSkills;
        allMatchingJobTitles = filterCriteria.allMatchingJobTitles;
      } catch (error) {
        console.error("Error processing filter criteria:", error);
        // Optionally handle the error or continue
      }
    }

    // Merge the results
    const mergedResults = mergeResults(
      resultsFromLinkedinUrls,
      resultsFromGithubUrls,
      resultsFromFilterCriteria,
    );

    if (mergedResults.length === 0) {
      await db
        .update(schema.profileQueue)
        .set({ response: mergedResults, error: true })
        .where(eq(schema.profileQueue.id, insertId));
      return;
    }

    // Update the profileQueue with the merged results
    await db
      .update(schema.profileQueue)
      .set({
        response: mergedResults,
        success: true,
        skills: allMatchingSkills,
        jobTitles: allMatchingJobTitles,
      })
      .where(eq(schema.profileQueue.id, insertId));
  } catch (error) {
    console.error("Error processing queue item:", error);
    // Update the profileQueue with error
    await db
      .update(schema.profileQueue)
      .set({ error: true })
      .where(eq(schema.profileQueue.id, insertId));
  }
}
