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
  gt,
  gte,
  inArray,
  InferSelectModel,
  like,
  not,
  or,
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

async function querySimilarPeopleByEmbedding(
  vectorColumn: any,
  idColumn: any,
  table: any,
  embedding: number[],
  topK: number,
  threshold: number
) {
  try {
    console.log(`[1] Starting search for similar people`);
    const similarity = sql<number>`1 - (${cosineDistance(
      vectorColumn,
      embedding
    )})`;

    const similarPeople = await db
      .select({
        personIds: idColumn,
        similarity,
      })
      .from(table)
      .where(gt(similarity, threshold))
      .orderBy(cosineDistance(vectorColumn, embedding))
      .limit(topK);

    console.log(
      `[3] Retrieved ${similarPeople.length} similar people after similarity search.`
    );

    const result = similarPeople.map((s) => ({
      score: parseFloat(s.similarity.toFixed(6)),
      personIds: s.personIds,
    }));

    console.log(`[5] Returning ${result.length} similar people.`);
    console.log(
      `Number of matches users: ${similarPeople.reduce(
        (acc, curr) => acc + (curr.personIds?.length ?? 0),
        0
      )}`
    );
    return result;
  } catch (error) {
    console.error("Error querying similar technologies:", error);
    return [];
  }
}

const generateEmbeddingsWithLogging = async (data: string[], type: string) => {
  console.log(`Generating ${type} embeddings for ${data.length} items...`);
  const embeddings = await Promise.all(
    data.map(async (item, index) => {
      try {
        console.log(
          `Generating ${type} embedding for item ${index + 1}/${data.length}`
        );
        const embedding = await getEmbedding(item);
        console.log(
          `Successfully generated ${type} embedding for item ${index + 1}`
        );
        return embedding;
      } catch (error) {
        console.error(
          `Error generating ${type} embedding for item ${index + 1}:`,
          error
        );
        throw error;
      }
    })
  );
  console.log(`Finished generating ${type} embeddings`);
  return embeddings;
};

function calculateExperienceBounds(
  candidates: Array<{
    linkedinData: any;
  }>
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
        }
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
    `Experience statistics: Mean = ${mean.toFixed(
      2
    )}, StdDev = ${stdDev.toFixed(2)}`
  );
  console.log(
    `Experience bounds: Lower = ${lowerBound} years, Upper = ${upperBound} years`
  );

  return { lowerBound, upperBound, mean, stdDev };
}

function calculateExperienceScore(
  candidate: {
    linkedinData: any;
  },
  mean: number,
  stdDev: number
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
      }
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
  }>
): Record<string, number> {
  const companyFrequency: Record<string, number> = {};
  let totalUniqueCandidateCompanies = 0;

  candidates.forEach((candidate) => {
    const uniqueCompanies = new Set(
      candidate.linkedinData.positions.positionHistory.map(
        (position: any) => position.companyName
      )
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
  }>
): Record<string, number> {
  const educationFrequency: Record<string, number> = {};
  let totalEducations = 0;

  candidates.forEach((candidate) => {
    const schools = candidate.linkedinData.schools.educationHistory.map(
      (education: any) => education.schoolName
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
    0
  );

  const educationWeights = significantSchools.reduce<Record<string, number>>(
    (acc, [school, frequency]) => {
      acc[school] = frequency / totalSignificantEducations;
      return acc;
    },
    {}
  );

  console.log(
    `Education weights (minimum frequency: ${minFrequencyThreshold}):`,
    educationWeights
  );
  return educationWeights;
}

async function computeAverageEmbedding(
  embeddings: number[][]
): Promise<number[] | null> {
  if (embeddings.length === 0) {
    return null;
  }
  const sum = embeddings.reduce(
    (acc, curr) => acc.map((val, i) => val + curr[i]),
    new Array(embeddings[0].length).fill(0)
  );
  return sum.map((val) => val / embeddings.length);
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
    completion.choices[0].message.content ?? '{ "condition": false }'
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

  // Extract job titles, companies, schools, and fields of study
  const jobTitlesList = profileData.positions.positionHistory.map(
    (position: any) => position.title
  ) as string[];
  const companyNames = profileData.positions.positionHistory.map(
    (position: any) => position.companyName
  ) as string[];
  const educationHistory = profileData.schools?.educationHistory || [];
  const schoolNames = educationHistory.map(
    (education: any) => education.schoolName
  ) as string[];
  const fieldsOfStudy = educationHistory.map(
    (education: any) => education.fieldOfStudy
  ) as string[];

  const summary = await generateSummary(profileData);
  const personId = uuid();

  // Initialize arrays to store vectors for averaging
  const skillVectors: number[][] = [];
  const jobTitleVectors: number[][] = [];
  const companyVectors: number[][] = [];
  const schoolVectors: number[][] = [];
  const fieldOfStudyVectors: number[][] = [];

  // Function to upsert data into a table
  async function upsertData(
    table: any,
    fieldName: string,
    fieldValue: string,
    vectorFieldName: string
  ) {
    const normalizedValue = fieldValue.toLowerCase().trim();
    const existingRecord = await db
      .select()
      .from(table)
      .where(eq(table[fieldName], normalizedValue))
      .limit(1);

    if (existingRecord.length > 0) {
      const currentPersonIds = existingRecord[0].personIds || [];
      const updatedPersonIds = Array.from(
        new Set([...currentPersonIds, personId])
      );

      if (
        updatedPersonIds.length === currentPersonIds.length &&
        updatedPersonIds.every((id, index) => id === currentPersonIds[index])
      ) {
        console.log(
          `[upsert${fieldName}] No changes for ${fieldName} "${normalizedValue}". Skipping update.`
        );
        return existingRecord[0][vectorFieldName];
      }

      await db
        .update(table)
        .set({ personIds: updatedPersonIds })
        .where(eq(table[fieldName], normalizedValue));

      console.log(
        `[upsert${fieldName}] Updated ${fieldName} "${normalizedValue}" with person ID: ${personId}`
      );
      return existingRecord[0][vectorFieldName];
    } else {
      const vector = await getEmbedding(normalizedValue);
      await db
        .insert(table)
        .values({
          personIds: [personId],
          [fieldName]: normalizedValue,
          [vectorFieldName]: vector,
        })
        .onConflictDoNothing();

      console.log(
        `[upsert${fieldName}] Inserted new ${fieldName} "${normalizedValue}" with person ID: ${personId}`
      );
      return vector;
    }
  }

  // Compute location vector if location is provided
  let locationVector: number[] | null = null;
  if (profileData.location) {
    locationVector = await getEmbedding(profileData.location);
    await db.insert(schema.locationsVector).values({
      personIds: [personId],
      location: profileData.location,
      vector: locationVector,
    });
    await upsertData(
      schema.locationsVector,
      "location",
      profileData.location,
      "vector"
    );
  }

  // Upsert skills
  for (const skill of [...tech, ...features]) {
    try {
      const vector = await upsertData(
        schema.skillsNew,
        "skill",
        skill,
        "vector"
      );
      skillVectors.push(vector);
    } catch (error) {
      console.error(
        `Error processing skill "${skill}" for person ID: ${personId}`,
        error
      );
    }
  }

  // Upsert job titles
  for (const title of jobTitlesList) {
    try {
      const vector = await upsertData(
        schema.jobTitlesVectorNew,
        "jobTitle",
        title,
        "vector"
      );
      jobTitleVectors.push(vector);
    } catch (error) {
      console.error(
        `Error processing job title "${title}" for person ID: ${personId}`,
        error
      );
    }
  }

  // Upsert companies
  for (const company of companyNames) {
    try {
      const vector = await upsertData(
        schema.companiesVectorNew,
        "company",
        company,
        "vector"
      );
      companyVectors.push(vector);
    } catch (error) {
      console.error(
        `Error processing company "${company}" for person ID: ${personId}`,
        error
      );
    }
  }

  // Upsert schools
  for (const school of schoolNames) {
    try {
      const vector = await upsertData(
        schema.schools,
        "school",
        school,
        "vector"
      );
      schoolVectors.push(vector);
    } catch (error) {
      console.error(
        `Error processing school "${school}" for person ID: ${personId}`,
        error
      );
    }
  }

  // Upsert fields of study
  for (const field of fieldsOfStudy) {
    try {
      const vector = await upsertData(
        schema.fieldsOfStudy,
        "fieldOfStudy",
        field,
        "vector"
      );
      fieldOfStudyVectors.push(vector);
    } catch (error) {
      console.error(
        `Error processing field of study "${field}" for person ID: ${personId}`,
        error
      );
    }
  }

  // Compute average vectors
  const averageSkillVector = await computeAverageEmbedding(skillVectors);
  const averageJobTitleVector = await computeAverageEmbedding(jobTitleVectors);
  const averageCompanyVector = await computeAverageEmbedding(companyVectors);
  const averageSchoolVector = await computeAverageEmbedding(schoolVectors);
  const averageFieldOfStudyVector = await computeAverageEmbedding(
    fieldOfStudyVectors
  );

  try {
    await db
      .insert(people)
      .values({
        id: personId,
        linkedinUrl: profileData.link as string,
        linkedinData: profileData,
        name: `${profileData.firstName} ${profileData.lastName}`.trim(),
        miniSummary,
        summary,
        topTechnologies: tech,
        topFeatures: features,
        jobTitles: jobTitlesList,
        isEngineer,
        createdAt: new Date(),
        locationVector,
        averageSkillVector,
        averageJobTitleVector,
        averageCompanyVector,
        averageSchoolVector,
        averageFieldOfStudyVector,
      })
      .onConflictDoNothing();

    console.log(
      `Person ${profileData.firstName} ${profileData.lastName} inserted into the database. Person ID: ${personId}`
    );
  } catch (e) {
    console.error(
      `Failed to insert person ${profileData.firstName} ${profileData.lastName} into the database.`,
      e
    );
  }

  return personId;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dotProduct / (magnitudeA * magnitudeB);
}

function calculateCosineSimilarityVariance(embeddings: number[][]): number {
  if (embeddings.length < 2) return 0;
  if (embeddings.length === 2) {
    return 1 - cosineSimilarity(embeddings[0], embeddings[1]);
  }

  const similarities: number[] = [];
  for (let i = 0; i < embeddings.length; i++) {
    for (let j = i + 1; j < embeddings.length; j++) {
      similarities.push(cosineSimilarity(embeddings[i], embeddings[j]));
    }
  }

  const mean =
    similarities.reduce((sum, val) => sum + val, 0) / similarities.length;
  const variance =
    similarities.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
    similarities.length;
  return variance;
}

async function processLinkedinUrls(profileUrls: string[], insertId: string) {
  console.log("Processing LinkedIn URLs...");

  const inputPeople: InferSelectModel<typeof people>[] = [];
  const batchSize = 50;

  function normalizeLinkedInUrl(url: string): string {
    return url
      .toLowerCase()
      .replace(/^(https?:\/\/)?(www\.)?linkedin\.com\/(in\/)?/, "")
      .replace(/\/$/, "");
  }

  // Process URLs in batches
  for (let i = 0; i < profileUrls.length; i += batchSize) {
    const batch = profileUrls.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (profileUrl) => {
        console.log(`Processing URL: ${profileUrl}`);
        let person = await db.query.people.findFirst({
          where: like(
            people.linkedinUrl,
            `%${normalizeLinkedInUrl(profileUrl)
              .toLowerCase()
              .replace("https://", "")
              .replace("www.", "")}%`
          ),
        });

        if (!person) {
          console.log(
            `Person not found for URL: ${profileUrl}. Scraping and inserting.`
          );
          const scrapedData = await scrapeLinkedInProfile(profileUrl);
          if (scrapedData && scrapedData.success) {
            const personId = await insertPersonFromLinkedin(scrapedData.person);
            person = await db.query.people.findFirst({
              where: eq(people.id, personId),
            });
          } else {
            console.error(
              `Failed to scrape or insert person for URL: ${profileUrl}`
            );
          }
        }

        return person;
      })
    );

    inputPeople.push(
      ...batchResults.filter(
        (p): p is InferSelectModel<typeof people> => p !== undefined
      )
    );
  }

  if (inputPeople.length === 0) {
    console.log("No matching input people found");
    return [];
  }

  console.log(`Found ${inputPeople.length} matching input people.`);

  const inputPersonIds = new Set(inputPeople.map((p) => p.id));

  // Compute average embeddings for each person
  const inputPersonAverageEmbeddings = await Promise.all(
    inputPeople.map(async (person) => {
      const skillEmbedding = person.averageSkillVector as number[] | null;
      const jobTitleEmbedding = person.averageJobTitleVector as number[] | null;
      const companyEmbedding = person.averageCompanyVector as number[] | null;
      const schoolEmbedding = person.averageSchoolVector as number[] | null;
      const fieldOfStudyEmbedding = person.averageFieldOfStudyVector as
        | number[]
        | null;
      const locationEmbedding = person.locationVector as number[] | null;

      return {
        personId: person.id,
        skillEmbedding,
        jobTitleEmbedding,
        companyEmbedding,
        schoolEmbedding,
        fieldOfStudyEmbedding,
        locationEmbedding,
      };
    })
  );

  // Calculate variances for each metric
  const metricVariances: { [key: string]: number } = {
    skills: calculateCosineSimilarityVariance(
      inputPersonAverageEmbeddings
        .map((p) => p.skillEmbedding)
        .filter((e): e is number[] => e !== null)
    ),
    jobTitles: calculateCosineSimilarityVariance(
      inputPersonAverageEmbeddings
        .map((p) => p.jobTitleEmbedding)
        .filter((e): e is number[] => e !== null)
    ),
    companies: calculateCosineSimilarityVariance(
      inputPersonAverageEmbeddings
        .map((p) => p.companyEmbedding)
        .filter((e): e is number[] => e !== null)
    ),
    schools: calculateCosineSimilarityVariance(
      inputPersonAverageEmbeddings
        .map((p) => p.schoolEmbedding)
        .filter((e): e is number[] => e !== null)
    ),
    fieldsOfStudy: calculateCosineSimilarityVariance(
      inputPersonAverageEmbeddings
        .map((p) => p.fieldOfStudyEmbedding)
        .filter((e): e is number[] => e !== null)
    ),
    locations: calculateCosineSimilarityVariance(
      inputPersonAverageEmbeddings
        .map((p) => p.locationEmbedding)
        .filter((e): e is number[] => e !== null)
    ),
  };

  console.log("Metric variances:", metricVariances);

  // Compute overall average embeddings
  const avgSkillEmbedding = await computeAverageEmbedding(
    inputPersonAverageEmbeddings
      .map((p) => p.skillEmbedding)
      .filter((e): e is number[] => e !== null)
  );
  const avgJobTitleEmbedding = await computeAverageEmbedding(
    inputPersonAverageEmbeddings
      .map((p) => p.jobTitleEmbedding)
      .filter((e): e is number[] => e !== null)
  );
  const avgCompanyEmbedding = await computeAverageEmbedding(
    inputPersonAverageEmbeddings
      .map((p) => p.companyEmbedding)
      .filter((e): e is number[] => e !== null)
  );
  const avgSchoolEmbedding = await computeAverageEmbedding(
    inputPersonAverageEmbeddings
      .map((p) => p.schoolEmbedding)
      .filter((e): e is number[] => e !== null)
  );
  const avgFieldOfStudyEmbedding = await computeAverageEmbedding(
    inputPersonAverageEmbeddings
      .map((p) => p.fieldOfStudyEmbedding)
      .filter((e): e is number[] => e !== null)
  );
  const avgLocationEmbedding = await computeAverageEmbedding(
    inputPersonAverageEmbeddings
      .map((p) => p.locationEmbedding)
      .filter((e): e is number[] => e !== null)
  );

  // Filter out metrics with high variance
  const varianceThreshold = 0.1;
  const validMetrics = Object.entries(metricVariances)
    .filter(([, variance]) => variance <= varianceThreshold)
    .map(([metric]) => metric);

  console.log("Valid metrics for scoring:", validMetrics);

  // Modify the similarity calculations to only include valid metrics
  let mostSimilarPeople: { score: number; personIds: string[] }[] = [];

  for (const metric of validMetrics) {
    let similarPeople: { score: number; personIds: string[] }[] = [];

    switch (metric) {
      case "skills":
        if (avgSkillEmbedding) {
          similarPeople = await querySimilarPeopleByEmbedding(
            schema.people.averageSkillVector,
            schema.people.id,
            schema.people,
            avgSkillEmbedding,
            500,
            0.5
          );
        }
        break;
      case "jobTitles":
        if (avgJobTitleEmbedding) {
          similarPeople = await querySimilarPeopleByEmbedding(
            schema.people.averageJobTitleVector,
            schema.people.id,
            schema.people,
            avgJobTitleEmbedding,
            500,
            0.5
          );
        }
        break;
      case "companies":
        if (avgCompanyEmbedding) {
          similarPeople = await querySimilarPeopleByEmbedding(
            schema.people.averageCompanyVector,
            schema.people.id,
            schema.people,
            avgCompanyEmbedding,
            500,
            0.5
          );
        }
        break;
      case "schools":
        if (avgSchoolEmbedding) {
          similarPeople = await querySimilarPeopleByEmbedding(
            schema.people.averageSchoolVector,
            schema.people.id,
            schema.people,
            avgSchoolEmbedding,
            500,
            0.5
          );
        }
        break;
      case "fieldsOfStudy":
        if (avgFieldOfStudyEmbedding) {
          similarPeople = await querySimilarPeopleByEmbedding(
            schema.people.averageFieldOfStudyVector,
            schema.people.id,
            schema.people,
            avgFieldOfStudyEmbedding,
            500,
            0.5
          );
        }
        break;
      case "locations":
        if (avgLocationEmbedding) {
          similarPeople = await querySimilarPeopleByEmbedding(
            schema.people.locationVector,
            schema.people.id,
            schema.people,
            avgLocationEmbedding,
            500,
            0.5
          );
        }
        break;
    }

    mostSimilarPeople = mostSimilarPeople.concat(similarPeople);
  }

  const allSimilarPeople: {
    personId: string;
    score: number;
    attributions: string[];
  }[] = [];

  const addToAllSimilarPeople = (
    personId: string,
    score: number,
    attribution: string
  ) => {
    if (validMetrics.includes(attribution)) {
      const existingPerson = allSimilarPeople.find(
        (p) => p.personId === personId
      );
      if (existingPerson) {
        existingPerson.score += score;
        if (!existingPerson.attributions.includes(attribution)) {
          existingPerson.attributions.push(attribution);
        }
      } else {
        allSimilarPeople.push({
          personId,
          score,
          attributions: [attribution],
        });
      }
    }
  };

  // Combine all similarity calculations
  console.log("Starting to combine similarity calculations...");
  [
    { data: mostSimilarPeople, attribution: "skills" },
    { data: mostSimilarPeople, attribution: "jobTitles" },
    { data: mostSimilarPeople, attribution: "companies" },
    { data: mostSimilarPeople, attribution: "schools" },
    { data: mostSimilarPeople, attribution: "fieldsOfStudy" },
    { data: mostSimilarPeople, attribution: "locations" },
  ].forEach(({ data, attribution }, index) => {
    console.log(`Processing ${attribution} data (${index + 1}/6)...`);
    data.forEach((person, personIndex) => {
      if (Array.isArray(person.personIds)) {
        person.personIds.forEach((personId) => {
          addToAllSimilarPeople(personId, person.score, attribution);
        });
      } else if (typeof person.personIds === "string") {
        // If personIds is a single string, treat it as a single personId
        addToAllSimilarPeople(person.personIds, person.score, attribution);
      } else {
        console.warn(
          `Unexpected personIds format for ${attribution} at index ${personIndex}:`,
          person.personIds
        );
      }
    });
    console.log(`Finished processing ${attribution} data.`);
  });
  console.log("Finished combining all similarity calculations.");

  // Sort the allSimilarPeople array by score in descending order and limit to top 2000
  const topSimilarPeople = allSimilarPeople
    .sort((a, b) => b.score - a.score)
    .slice(0, 2000);

  // Fetch only the top 2000 similar people
  console.log("Fetching top 2000 most similar people...");
  const topCandidates = await db.query.people.findMany({
    where: and(
      not(inArray(people.id, Array.from(inputPersonIds))),
      inArray(
        people.id,
        topSimilarPeople.map((p) => p.personId)
      )
    ),
    columns: {
      id: true,
      isWhopUser: true,
      isWhopCreator: true,
      name: true,
      companyIds: true,
      githubBio: true,
      summary: true,
      miniSummary: true,
      createdAt: true,
      email: true,
      followers: true,
      githubCompany: true,
      websiteUrl: true,
      workedInBigTech: true,
      contributionYears: true,
      following: true,
      githubImage: true,
      followerToFollowingRatio: true,
      image: true,
      isEngineer: true,
      jobTitles: true,
      linkedinData: true,
      twitterBio: true,
      twitterData: true,
      githubLanguages: true,
      topFeatures: true,
      topTechnologies: true,
      linkedinUrl: true,
      normalizedLocation: true,
      location: true,
      twitterUsername: true,
      githubData: true,
      githubLogin: true,
      githubId: true,
      organizations: true,
    },
  });
  console.log(`Fetched ${topCandidates.length} people.`);

  // Combine the fetched data with the similarity scores
  const scoredCandidates = topCandidates
    .map((person) => {
      const similarityData = topSimilarPeople.find(
        (p) => p.personId === person.id
      );
      return {
        data: { ...person },
        score: similarityData ? similarityData.score : 0,
        attributions: similarityData ? similarityData.attributions : [],
      };
    })
    .sort((a, b) => b.score - a.score);

  console.log(`Processed ${scoredCandidates.length} top candidates.`);

  return scoredCandidates;
}

export const querySimilarTechnologies = async (
  inputSkill: string,
  topK: number = 250
) => {
  try {
    console.log(
      `[1] Starting search for similar technologies to: "${inputSkill}"`
    );

    // Step 1: Generate embedding for the input skill
    const embedding = await getEmbedding(inputSkill);
    console.log(`[2] Embedding generated for: "${inputSkill}"`);

    // Step 2: Perform similarity search directly in PostgreSQL
    const similarity = sql<number>`1 - (${cosineDistance(
      schema.skillsNew.vector,
      embedding
    )})`;

    const similarSkills = await db
      .select({
        technology: schema.skillsNew.skill,
        similarity,
        personIds: schema.skillsNew.personIds,
      })
      .from(schema.skillsNew)
      .where(gt(similarity, 0.5))
      .orderBy(cosineDistance(schema.skillsNew.vector, embedding))
      .limit(topK);

    console.log(
      `[3] Retrieved ${similarSkills.length} similar technologies after similarity search.`
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
      `Number of matches users: ${similarSkills.reduce(
        (acc, curr) => acc + (curr.personIds?.length ?? 0),
        0
      )}`
    );
    return result;
  } catch (error) {
    console.error("Error querying similar technologies:", error);
    return [];
  }
};

export const querySimilarLocations = async (
  inputLocation: string,
  topK: number = 500
) => {
  try {
    console.log(
      `[1] Starting search for similar locations to: "${inputLocation}"`
    );

    const embedding = await getEmbedding(inputLocation);
    console.log(`[2] Embedding generated for: "${inputLocation}"`);

    const similarity = sql<number>`1 - (${cosineDistance(
      schema.locationsVector.vector,
      embedding
    )})`;

    const similarLocations = await db
      .select({
        location: schema.locationsVector.location,
        similarity,
        personIds: schema.locationsVector.personIds,
      })
      .from(schema.locationsVector)
      .where(gt(similarity, 0.9))
      .orderBy(cosineDistance(schema.locationsVector.vector, embedding))
      .limit(topK);

    console.log(
      `[3] Retrieved ${similarLocations.length} similar technologies after similarity search.`
    );

    const result = similarLocations.map((s) => ({
      location: s.location,
      score: parseFloat(s.similarity.toFixed(6)),
      personIds: s.personIds,
    }));

    console.log(`[5] Returning ${result.length} similar locations.`);
    console.log(
      `Number of matches users: ${similarLocations.reduce(
        (acc, curr) => acc + (curr.personIds?.length ?? 0),
        0
      )}`
    );
    return result;
  } catch (error) {
    console.error("Error querying similar locations:", error);
    return [];
  }
};

export const querySimilarCompanies = async (
  inputCompany: string,
  topK: number = 500
) => {
  try {
    console.log(
      `[1] Starting search for similar locations to: "${inputCompany}"`
    );

    const embedding = await getEmbedding(inputCompany);
    console.log(`[2] Embedding generated for: "${inputCompany}"`);

    const similarity = sql<number>`1 - (${cosineDistance(
      schema.companiesVectorNew.vector,
      embedding
    )})`;

    const similarCompanies = await db
      .select({
        company: schema.companiesVectorNew.company,
        similarity,
        personIds: schema.companiesVectorNew.personIds,
      })
      .from(schema.companiesVectorNew)
      .where(gt(similarity, 0.95))
      .orderBy(cosineDistance(schema.companiesVectorNew.vector, embedding))
      .limit(topK);

    console.log(
      `[3] Retrieved ${similarCompanies.length} similar companies after similarity search.`
    );

    const result = similarCompanies.map((s) => ({
      company: s.company,
      score: parseFloat(s.similarity.toFixed(6)),
      personIds: s.personIds,
    }));

    console.log(`[5] Returning ${result.length} similar companies.`);

    console.log(
      `Number of matches users: ${similarCompanies.reduce(
        (acc, curr) => acc + (curr.personIds?.length ?? 0),
        0
      )}`
    );
    return result;
  } catch (error) {
    console.error("Error querying similar companies:", error);
    return [];
  }
};

export const querySimilarJobTitles = async (
  inputJobTitle: string,
  topK: number = 500
) => {
  try {
    console.log(
      `[1] Starting search for similar job titles to: "${inputJobTitle}"`
    );

    // Step 1: Generate embedding for the input job title
    const embedding = await getEmbedding(inputJobTitle);
    console.log(`[2] Embedding generated for: "${inputJobTitle}"`);

    // Step 2: Perform similarity search directly in PostgreSQL
    const similarity = sql<number>`1 - (${cosineDistance(
      schema.jobTitlesVectorNew.vector,
      embedding
    )})`;

    const similarJobTitles = await db
      .select({
        jobTitle: schema.jobTitlesVectorNew.jobTitle,
        similarity,
        personIds: schema.jobTitlesVectorNew.personIds,
      })
      .from(schema.jobTitlesVectorNew)
      .where(gt(similarity, 0.5))
      .orderBy(cosineDistance(schema.jobTitlesVectorNew.vector, embedding))
      .limit(topK);

    console.log(
      `[3] Retrieved ${similarJobTitles.length} similar job titles after similarity search.`
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
      `Number of matching users: ${similarJobTitles.reduce(
        (acc, curr) => acc + (curr.personIds?.length ?? 0),
        0
      )}`
    );
    return result;
  } catch (error) {
    console.error("Error querying similar job titles:", error);
    return [];
  }
};

export const querySimilarSchools = async (
  inputSchool: string,
  topK: number = 500
) => {
  try {
    console.log(`[1] Starting search for similar schools to: "${inputSchool}"`);

    const embedding = await getEmbedding(inputSchool);
    console.log(`[2] Embedding generated for: "${inputSchool}"`);

    const similarity = sql<number>`1 - (${cosineDistance(
      schema.schools.vector,
      embedding
    )})`;

    const similarSchools = await db
      .select({
        school: schema.schools.school,
        similarity,
        personIds: schema.schools.personIds,
      })
      .from(schema.schools)
      .where(gt(similarity, 0.8))
      .orderBy(cosineDistance(schema.schools.vector, embedding))
      .limit(topK);

    console.log(
      `[3] Retrieved ${similarSchools.length} similar schools after similarity search.`
    );

    const result = similarSchools.map((s) => ({
      school: s.school,
      score: parseFloat(s.similarity.toFixed(6)),
      personIds: s.personIds,
    }));

    console.log(`[4] Returning ${result.length} similar schools.`);
    console.log(
      `Number of matching users: ${similarSchools.reduce(
        (acc, curr) => acc + (curr.personIds?.length ?? 0),
        0
      )}`
    );
    return result;
  } catch (error) {
    console.error("Error querying similar schools:", error);
    return [];
  }
};

export const querySimilarFieldsOfStudy = async (
  inputFieldOfStudy: string,
  topK: number = 500
) => {
  try {
    console.log(
      `[1] Starting search for similar fields of study to: "${inputFieldOfStudy}"`
    );

    const embedding = await getEmbedding(inputFieldOfStudy);
    console.log(`[2] Embedding generated for: "${inputFieldOfStudy}"`);

    const similarity = sql<number>`1 - (${cosineDistance(
      schema.fieldsOfStudy.vector,
      embedding
    )})`;

    const similarFieldsOfStudy = await db
      .select({
        fieldOfStudy: schema.fieldsOfStudy.fieldOfStudy,
        similarity,
        personIds: schema.fieldsOfStudy.personIds,
      })
      .from(schema.fieldsOfStudy)
      .where(gt(similarity, 0.9))
      .orderBy(cosineDistance(schema.fieldsOfStudy.vector, embedding))
      .limit(topK);

    console.log(
      `[3] Retrieved ${similarFieldsOfStudy.length} similar fields of study after similarity search.`
    );

    const result = similarFieldsOfStudy.map((s) => ({
      fieldOfStudy: s.fieldOfStudy,
      score: parseFloat(s.similarity.toFixed(6)),
      personIds: s.personIds,
    }));

    console.log(`[4] Returning ${result.length} similar fields of study.`);
    console.log(
      `Number of matching users: ${similarFieldsOfStudy.reduce(
        (acc, curr) => acc + (curr.personIds?.length ?? 0),
        0
      )}`
    );
    return result;
  } catch (error) {
    console.error("Error querying similar fields of study:", error);
    return [];
  }
};

function calculateMean(scores: number[]): number {
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function calculateStdDev(scores: number[], mean: number): number {
  const variance =
    scores.reduce((sum, score) => sum + Math.pow(score - mean, 2), 0) /
    scores.length;
  return Math.sqrt(variance);
}

interface FilterCriteria {
  query: string;
  companyIds: {
    values: string[];
    weight: number;
  };
  otherCompanyNames: {
    values: string[];
    weight: number;
  };
  job: {
    value: string;
    weight: number;
  };
  skills: {
    values: { skill: string; weight: number }[];
  };
  location: {
    value: string;
    weight: number;
  };
  schools: {
    values: string[];
    weight: number;
  };
  fieldsOfStudy: {
    values: string[];
    weight: number;
  };
  whopUser: {
    value: boolean;
    weight: number;
  };
}

async function processFilterCriteria(filterCriteria: FilterCriteria) {
  console.log("Processing filter criteria...");

  let companyIds =
    filterCriteria.companyIds.values.length > 0
      ? filterCriteria.companyIds.values
      : ["NONE"];

  // Step 1: Retrieve LinkedIn employees for the provided companies
  const linkedinCompanyEmployees = await db.query.people.findMany({
    columns: {
      id: true,
      companyIds: true,
    },
    where: jsonArrayContainsAny(schema.people.companyIds, companyIds),
  });

  // Step 2: Fetch company names based on the provided company IDs
  const companies = await db.query.company.findMany({
    where: inArray(schema.company.id, companyIds),
  });
  const companyNames = companies.map((company) => company.name);

  // Step 3 and Step 6: Parallelize queries for similar technologies and companies
  const [similarTechnologiesResults, similarCompanies] = await Promise.all([
    filterCriteria.skills.values.length > 0
      ? Promise.all(
          filterCriteria.skills.values.map((skillObj) =>
            querySimilarTechnologies(skillObj.skill).then((result) => ({
              skill: skillObj.skill,
              weight: skillObj.weight,
              similarTechnologies: result,
            }))
          )
        )
      : Promise.resolve([]),
    Promise.all(
      companyNames.map((companyName) => querySimilarCompanies(companyName))
    ),
  ]);

  const personSkillScores: { [personId: string]: { [skill: string]: number } } =
    {};

  // Combine LinkedIn employees with similar companies
  const combinedCompanyMatches = [...similarCompanies.flat()];
  linkedinCompanyEmployees.forEach((employee) => {
    employee.companyIds?.forEach((companyId) => {
      const company = companies.find((c) => c.id === companyId);
      if (company) {
        const existingMatch = combinedCompanyMatches.find(
          (match) => match.company === company.name
        );
        if (existingMatch) {
          existingMatch.personIds = [
            ...new Set([...(existingMatch.personIds ?? []), employee.id]),
          ];
        } else {
          combinedCompanyMatches.push({
            company: company.name,
            score: 1.0,
            personIds: [employee.id],
          });
        }
      }
    });
  });

  // Process each skill and collect person scores
  similarTechnologiesResults.forEach(
    ({ skill, weight, similarTechnologies }) => {
      similarTechnologies.forEach((tech) => {
        tech.personIds?.forEach((personId) => {
          const personScore = tech.score || 0;
          if (!personSkillScores[personId]) {
            personSkillScores[personId] = {};
          }
          // Store the raw score for the skill
          personSkillScores[personId][skill] = personScore;
        });
      });
    }
  );

  // Collect all person IDs from similar technologies
  const similarTechnologiesPersonIds = Array.from(
    new Set(
      similarTechnologiesResults.flatMap((result) =>
        result.similarTechnologies.flatMap((tech) => tech.personIds || [])
      )
    )
  );

  // Step 4: Get similar location IDs if location is provided
  let similarLocations: {
    location: string;
    score: number;
    personIds: string[] | null;
  }[] = [];
  if (filterCriteria.location.value) {
    similarLocations = await querySimilarLocations(
      filterCriteria.location.value
    );
  }

  const similarLocationPersonIds = Array.from(
    new Set(similarLocations.flatMap((location) => location.personIds || []))
  );

  // Step 5: Get similar job title IDs if job title is provided
  let similarJobTitles: {
    jobTitle: string;
    score: number;
    personIds: string[] | null;
  }[] = [];
  if (filterCriteria.job.value && filterCriteria.job.value !== "") {
    similarJobTitles = await querySimilarJobTitles(filterCriteria.job.value);
  }

  const similarJobTitlesPersonIds = Array.from(
    new Set(similarJobTitles.flatMap((item) => item.personIds || []))
  );

  // Query similar schools
  let similarSchools: {
    school: string;
    score: number;
    personIds: string[] | null;
  }[] = [];
  if (filterCriteria.schools.values.length > 0) {
    similarSchools = (
      await Promise.all(
        filterCriteria.schools.values.map((school) =>
          querySimilarSchools(school)
        )
      )
    ).flat();
  }

  const similarSchoolPersonIds = Array.from(
    new Set(similarSchools.flatMap((school) => school.personIds || []))
  );

  // Query similar fields of study
  let similarFieldsOfStudy: {
    fieldOfStudy: string;
    score: number;
    personIds: string[] | null;
  }[] = [];
  if (filterCriteria.fieldsOfStudy.values.length > 0) {
    similarFieldsOfStudy = (
      await Promise.all(
        filterCriteria.fieldsOfStudy.values.map((field) =>
          querySimilarFieldsOfStudy(field)
        )
      )
    ).flat();
  }

  const similarFieldOfStudyPersonIds = Array.from(
    new Set(similarFieldsOfStudy.flatMap((field) => field.personIds || []))
  );

  // Step 7: Combine all person IDs into a set to avoid duplicates
  const combinedPersonIds = Array.from(
    new Set([
      ...similarTechnologiesPersonIds,
      ...similarLocationPersonIds,
      ...similarJobTitlesPersonIds,
      ...similarSchoolPersonIds,
      ...similarFieldOfStudyPersonIds,
    ])
  );

  // Step 8: Create an array to store scores without fetching user data
  const mostSimilarPeople: {
    id: string;
    rawScores: { [criterion: string]: number };
    matchedSkills: { skill: string; score: number; weight: number }[];
    matchedJobTitle: { jobTitle: string; score: number } | null;
    matchedLocation: { location: string; score: number } | null;
    matchedCompanies: { company: string; score: number }[];
    matchedSchools: { school: string; score: number }[];
    matchedFieldsOfStudy: { fieldOfStudy: string; score: number }[];
    isWhopUser: boolean;
    score: number;
  }[] = [];

  // Initialize arrays to collect raw scores for normalization
  const criterionRawScores: { [criterion: string]: number[] } = {
    skills: [],
    location: [],
    jobTitle: [],
    companies: [],
    schools: [],
    fieldsOfStudy: [],
    whopUser: [],
  };

  // Fetch necessary user data for whopUser filtering
  const peopleData = await db.query.people.findMany({
    columns: {
      id: true,
      isWhopUser: true,
      isWhopCreator: true,
    },
    where: inArray(schema.people.id, combinedPersonIds),
  });

  // Create a map for easier access
  const peopleDataMap = new Map(
    peopleData.map((person) => [person.id, person])
  );

  // Calculate statistics for each skill
  const skillStats: {
    [skill: string]: { scores: number[]; mean: number; stdDev: number };
  } = {};

  similarTechnologiesResults.forEach(
    ({ skill, weight, similarTechnologies }) => {
      const scores: number[] = similarTechnologies.map(
        (tech) => tech.score || 0
      );
      const mean = calculateMean(scores);
      const stdDev = calculateStdDev(scores, mean);
      skillStats[skill] = { scores, mean, stdDev };
    }
  );

  // Calculate per-person raw scores
  combinedPersonIds.forEach((personId) => {
    const rawScores: { [criterion: string]: number } = {};
    const matchedSkills: { skill: string; score: number; weight: number }[] =
      [];
    let matchedJobTitle: { jobTitle: string; score: number } | null = null;
    let matchedLocation: { location: string; score: number } | null = null;
    const matchedCompanies: { company: string; score: number }[] = [];
    const matchedSchools: { school: string; score: number }[] = [];
    const matchedFieldsOfStudy: { fieldOfStudy: string; score: number }[] = [];
    let isWhopUser = false;

    // Calculate skill scores for this person
    let skillScoreSum = 0;
    const personSkills = personSkillScores[personId] || {};

    Object.keys(personSkills).forEach((skill) => {
      const rawScore = personSkills[skill];
      const { mean, stdDev } = skillStats[skill];

      const normalizedScore = normalizeScore(rawScore, mean, stdDev);

      const skillWeight =
        filterCriteria.skills.values.find((s) => s.skill === skill)?.weight ||
        0;

      const weightedScore = normalizedScore * skillWeight;

      skillScoreSum += weightedScore;

      matchedSkills.push({
        skill,
        score: rawScore,
        weight: skillWeight,
      });
    });

    rawScores.skills = skillScoreSum;

    // Add location scores
    let maxLocationScore = 0;
    similarLocations.forEach((location) => {
      if (location.personIds?.includes(personId)) {
        if (location.score > maxLocationScore) {
          maxLocationScore = location.score;
          matchedLocation = {
            location: location.location,
            score: location.score,
          };
        }
      }
    });
    rawScores.location = maxLocationScore;

    // Add job title scores
    let maxJobTitleScore = 0;
    similarJobTitles.forEach((jobTitle) => {
      if (jobTitle.personIds?.includes(personId)) {
        if (jobTitle.score > maxJobTitleScore) {
          maxJobTitleScore = jobTitle.score;
          matchedJobTitle = {
            jobTitle: jobTitle.jobTitle,
            score: jobTitle.score,
          };
        }
      }
    });
    rawScores.jobTitle = maxJobTitleScore;

    // Add company scores
    let companyScoreSum = 0;
    combinedCompanyMatches.forEach((company) => {
      if (company.personIds?.includes(personId)) {
        companyScoreSum += company.score;
        matchedCompanies.push({
          company: company.company,
          score: company.score,
        });
      }
    });
    rawScores.companies = companyScoreSum;

    // Add school scores
    let maxSchoolScore = 0;
    similarSchools.forEach((school) => {
      if (school.personIds?.includes(personId)) {
        if (school.score > maxSchoolScore) {
          maxSchoolScore = school.score;
        }
        matchedSchools.push({
          school: school.school,
          score: school.score,
        });
      }
    });
    rawScores.schools = maxSchoolScore;

    // Add field of study scores
    let maxFieldOfStudyScore = 0;
    similarFieldsOfStudy.forEach((field) => {
      if (field.personIds?.includes(personId)) {
        if (field.score > maxFieldOfStudyScore) {
          maxFieldOfStudyScore = field.score;
        }
        matchedFieldsOfStudy.push({
          fieldOfStudy: field.fieldOfStudy,
          score: field.score,
        });
      }
    });
    rawScores.fieldsOfStudy = maxFieldOfStudyScore;

    // Whop user
    const personData = peopleDataMap.get(personId);
    if (filterCriteria.whopUser.value && personData) {
      isWhopUser = personData.isWhopUser || personData.isWhopCreator || false;
    }
    rawScores.whopUser = isWhopUser ? 1 : 0;

    // Collect raw scores for normalization
    Object.keys(criterionRawScores).forEach((criterion) => {
      criterionRawScores[criterion].push(rawScores[criterion] || 0);
    });

    mostSimilarPeople.push({
      id: personId,
      rawScores,
      matchedSkills,
      matchedJobTitle,
      matchedLocation,
      matchedCompanies,
      matchedSchools,
      matchedFieldsOfStudy,
      isWhopUser,
      score: 0, // will calculate later
    });
  });

  // Calculate statistics for each criterion
  const criterionStats: {
    [criterion: string]: { mean: number; stdDev: number };
  } = {};

  Object.keys(criterionRawScores).forEach((criterion) => {
    const scores = criterionRawScores[criterion];
    const mean = calculateMean(scores);
    const stdDev = calculateStdDev(scores, mean);
    criterionStats[criterion] = { mean, stdDev };
  });

  // Prepare criteria weights
  const totalSkillWeight = filterCriteria.skills.values.reduce(
    (sum, skillObj) => sum + skillObj.weight,
    0
  );

  const criteriaWeights: { [criterion: string]: number } = {};

  if (totalSkillWeight > 0) {
    criteriaWeights.skills = totalSkillWeight;
  }
  if (filterCriteria.location.value) {
    criteriaWeights.location = filterCriteria.location.weight;
  }
  if (filterCriteria.job.value) {
    criteriaWeights.jobTitle = filterCriteria.job.weight;
  }
  if (
    filterCriteria.companyIds.values.length > 0 ||
    filterCriteria.otherCompanyNames.values.length > 0
  ) {
    criteriaWeights.companies = filterCriteria.companyIds.weight;
  }
  if (filterCriteria.schools.values.length > 0) {
    criteriaWeights.schools = filterCriteria.schools.weight;
  }
  if (filterCriteria.fieldsOfStudy.values.length > 0) {
    criteriaWeights.fieldsOfStudy = filterCriteria.fieldsOfStudy.weight;
  }
  if (filterCriteria.whopUser.value) {
    criteriaWeights.whopUser = filterCriteria.whopUser.weight;
  }

  const totalWeight = Object.values(criteriaWeights).reduce(
    (sum, weight) => sum + weight,
    0
  );

  // Normalize criteria weights
  Object.keys(criteriaWeights).forEach((criterion) => {
    criteriaWeights[criterion] = criteriaWeights[criterion] / totalWeight;
  });

  // Calculate final scores
  mostSimilarPeople.forEach((person) => {
    let finalScore = 0;

    Object.keys(criteriaWeights).forEach((criterion) => {
      const rawScore = person.rawScores[criterion] || 0;
      const { mean, stdDev } = criterionStats[criterion];
      const normalizedScore = normalizeScore(rawScore, mean, stdDev);
      const weight = criteriaWeights[criterion];

      finalScore += weight * normalizedScore;
    });

    person.score = finalScore;
  });

  // Step 13: Map user data back to top candidates
  const topCandidates = mostSimilarPeople.sort((a, b) => b.score - a.score);

  // Limit to top 2000 candidates
  const top2000Candidates = topCandidates.slice(0, 2000);

  const top2000PersonIds = top2000Candidates.map((candidate) => candidate.id);
  const top2000Users = await db.query.people.findMany({
    where: inArray(schema.people.id, top2000PersonIds),
    columns: {
      id: true,
      isWhopUser: true,
      isWhopCreator: true,
      name: true,
      companyIds: true,
      githubBio: true,
      summary: true,
      miniSummary: true,
      createdAt: true,
      email: true,
      followers: true,
      githubCompany: true,
      websiteUrl: true,
      workedInBigTech: true,
      contributionYears: true,
      following: true,
      githubImage: true,
      followerToFollowingRatio: true,
      image: true,
      isEngineer: true,
      jobTitles: true,
      linkedinData: true,
      twitterBio: true,
      twitterData: true,
      githubLanguages: true,
      topFeatures: true,
      topTechnologies: true,
      linkedinUrl: true,
      normalizedLocation: true,
      location: true,
      twitterUsername: true,
      githubData: true,
      githubLogin: true,
      githubId: true,
      organizations: true,
    },
  });

  const topCandidatesWithData = top2000Candidates.map((candidate) => {
    const userData = top2000Users.find((user) => user.id === candidate.id);
    return {
      data: userData,
      score: candidate.score,
      matchedSkills: candidate.matchedSkills,
      matchedJobTitle: candidate.matchedJobTitle,
      matchedLocation: candidate.matchedLocation,
      matchedCompanies: candidate.matchedCompanies,
      matchedSchools: candidate.matchedSchools,
      matchedFieldsOfStudy: candidate.matchedFieldsOfStudy,
    };
  });

  console.log("Filter criteria processing completed.");
  console.log(
    `Scores: ${topCandidatesWithData.map((c) => c.score.toFixed(4)).join(", ")}`
  );
  return topCandidatesWithData;
}

function normalizeScore(score: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return score > 0 ? 1 : 0;
  const zScore = (score - mean) / stdDev;
  return 1 / (1 + Math.exp(-zScore));
}

function mergeResults(...resultsArrays: any[][]): any[] {
  const idSet = new Set();
  const mergedResults: any[] = [];

  for (const resultsArray of resultsArrays) {
    for (const item of resultsArray) {
      if (!idSet.has(item.data.id)) {
        idSet.add(item.data.id);
        mergedResults.push(item);
      }
    }
  }

  mergedResults.sort((a, b) => b.score - a.score);

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

    if (body.linkedinUrls && body.linkedinUrls.length > 0) {
      try {
        console.log("Processing Linkedin URLs...");
        resultsFromLinkedinUrls = await processLinkedinUrls(
          body.linkedinUrls,
          insertId
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
        const filterCriteria = await processFilterCriteria(body.filterCriteria);
        resultsFromFilterCriteria = filterCriteria;
      } catch (error) {
        console.error("Error processing filter criteria:", error);
        // Optionally handle the error or continue
      }
    }

    // Merge the results
    const mergedResults = mergeResults(
      resultsFromLinkedinUrls,
      resultsFromGithubUrls,
      resultsFromFilterCriteria
    );

    if (mergedResults.length === 0) {
      await db
        .update(schema.profileQueue)
        .set({
          response: mergedResults.slice(0, 100),
          error: true,
          allIdsResponse: mergedResults.map((res) => ({
            id: res.id,
            score: res.score,
            matchedSkills: res.matchedSkills,
            matchedJobTitle: res.matchedJobTitle,
            matchedLocation: res.matchedLocation,
            matchedCompanies: res.matchedCompanies,
            matchedSchools: res.matchedSchools,
            matchedFieldsOfStudy: res.matchedFieldsOfStudy,
          })),
        })
        .where(eq(schema.profileQueue.id, insertId));
      return;
    }

    // Update the profileQueue with the merged results
    await db
      .update(schema.profileQueue)
      .set({
        response: mergedResults.slice(0, 100),
        success: true,
        allIdsResponse: mergedResults.map((res) => ({
          id: res.data.id,
          score: res.score,
          matchedSkills: res.matchedSkills,
          matchedJobTitle: res.matchedJobTitle,
          matchedLocation: res.matchedLocation,
          matchedCompanies: res.matchedCompanies,
          matchedSchools: res.matchedSchools,
          matchedFieldsOfStudy: res.matchedFieldsOfStudy,
        })),
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
