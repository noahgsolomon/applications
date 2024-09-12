import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";
import * as schema from "../server/db/schemas/users/schema.js";
import dotenv from "dotenv";
import { inArray, eq, and, or, gt, asc } from "drizzle-orm";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, "../.env") });

const connection = neon(process.env.DB_URL);
const db = drizzle(connection, { schema });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const index = pinecone.Index("whop");

export function calculateExperienceBounds(candidates) {
  const currentYear = new Date().getFullYear();
  const experiences = [];

  candidates.forEach((candidate) => {
    let earliestStartYear = currentYear;
    let latestEndYear = 0;

    if (
      candidate.linkedinData &&
      candidate.linkedinData.positions &&
      candidate.linkedinData.positions.positionHistory
    ) {
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

export function calculateExperienceScore(candidate, mean, stdDev) {
  const currentYear = new Date().getFullYear();
  let earliestStartYear = currentYear;
  let latestEndYear = 0;

  if (
    candidate.linkedinData &&
    candidate.linkedinData.positions &&
    candidate.linkedinData.positions.positionHistory
  ) {
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

  // Calculate score based on how close the experience is to the mean
  let experienceScore = 0;
  if (stdDev !== 0) {
    // Calculate z-score (number of standard deviations from the mean)
    const zScore = (totalExperience - mean) / stdDev;

    // Convert z-score to a score between 0 and 1
    // Using a Gaussian function to create a bell curve centered at the mean
    experienceScore = Math.exp(-(zScore * zScore) / 2);
  } else {
    // If stdDev is 0, all candidates have the same experience
    experienceScore = 1;
  }

  return { experienceScore, totalExperience };
}

export async function getEmbedding(text) {
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: text,
      encoding_format: "float",
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error("Error getting embedding:", error);
    throw error;
  }
}

export async function fetchCandidatesWithCursor(cursor) {
  try {
    const candidates = await db.query.candidates.findMany({
      columns: {
        id: true,
        url: true,
        topTechnologies: true,
        topFeatures: true,
        jobTitles: true,
        linkedinData: true,
        createdAt: true,
        livesNearBrooklyn: true,
      },
      where: and(
        or(
          gt(schema.candidates.createdAt, cursor.createdAt),
          and(
            eq(schema.candidates.createdAt, cursor.createdAt),
            gt(schema.candidates.id, cursor.id),
          ),
        ),
      ),
      limit: 500,
      orderBy: [asc(schema.candidates.createdAt), asc(schema.candidates.id)],
    });
    return candidates;
  } catch (error) {
    console.error("Error fetching candidates:", error);
    throw error;
  }
}

export async function fetchAllCandidates() {
  let allCandidates = [];
  let lastCursor = {
    id: "0",
    createdAt: new Date("1970-01-01T00:00:00Z"),
  };
  while (true) {
    const candidates = await fetchCandidatesWithCursor(lastCursor);
    if (candidates.length === 0) {
      break;
    }
    allCandidates = allCandidates.concat(candidates);
    lastCursor = {
      id: candidates[candidates.length - 1].id,
      createdAt: candidates[candidates.length - 1].createdAt,
    };
    console.log(`Fetched ${allCandidates.length} candidates so far...`);
  }
  return allCandidates;
}

export async function computeAverageEmbedding(embeddings) {
  if (embeddings.length === 0) {
    throw new Error("No embeddings provided to compute average");
  }
  return embeddings.reduce(
    (acc, embedding) =>
      acc.map((val, i) => val + embedding[i] / embeddings.length),
    new Array(embeddings[0].length).fill(0),
  );
}

export async function queryVectorDb(namespace, queryVector, topK, retries = 3) {
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

export function analyzeCompanies(candidates) {
  const companyFrequency = {};
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
    .reduce((acc, [company, frequency]) => {
      acc[company] = frequency / totalUniqueCandidateCompanies;
      return acc;
    }, {});

  console.log("Company weights:", companyWeights);
  return companyWeights;
}

export function analyzeEducation(candidates) {
  const educationFrequency = {};
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

  // Calculate the minimum frequency threshold: at least half of the candidates
  const minFrequencyThreshold = Math.ceil(candidates.length * 0.75);

  const significantSchools = Object.entries(educationFrequency)
    .filter(([, frequency]) => frequency >= minFrequencyThreshold)
    .sort(([, a], [, b]) => b - a);

  const totalSignificantEducations = significantSchools.reduce(
    (sum, [, freq]) => sum + freq,
    0,
  );

  const educationWeights = significantSchools.reduce(
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

export function analyzeNYCProximity(candidates) {
  const nycCount = candidates.filter((c) => c.livesNearBrooklyn).length;
  const nycRatio = nycCount / candidates.length;
  const shouldApplyNYCWeight = nycRatio >= 0.5;

  console.log(`NYC proximity ratio: ${nycRatio.toFixed(2)}`);
  console.log(`Applying NYC proximity weighting: ${shouldApplyNYCWeight}`);

  return shouldApplyNYCWeight;
}

async function main(linkedinUrls) {
  try {
    const inputCandidates = await db.query.candidates.findMany({
      where: inArray(schema.candidates.url, linkedinUrls),
      columns: {
        id: true,
        url: true,
        topTechnologies: true,
        topFeatures: true,
        jobTitles: true,
        linkedinData: true,
        livesNearBrooklyn: true,
      },
    });

    if (inputCandidates.length === 0) {
      console.log("No matching input candidates found in the database.");
      return;
    }

    console.log(`Found ${inputCandidates.length} matching input candidates.`);

    const { lowerBound, upperBound, mean, stdDev } =
      calculateExperienceBounds(inputCandidates);
    console.log(
      `Experience mean: ${mean.toFixed(2)} years, StdDev: ${stdDev.toFixed(2)} years`,
    );

    const inputCandidateIds = new Set(inputCandidates.map((c) => c.id));

    const companyWeights = analyzeCompanies(inputCandidates);
    const educationWeights = analyzeEducation(inputCandidates);
    const shouldApplyNYCWeight = analyzeNYCProximity(inputCandidates);

    const skillEmbeddings = await Promise.all(
      inputCandidates.flatMap((c) => c.topTechnologies || []).map(getEmbedding),
    );
    const featureEmbeddings = await Promise.all(
      inputCandidates.flatMap((c) => c.topFeatures || []).map(getEmbedding),
    );
    const jobTitleEmbeddings = await Promise.all(
      inputCandidates.flatMap((c) => c.jobTitles || []).map(getEmbedding),
    );

    console.log(`Generated embeddings for skills, features, and job titles.`);

    const avgSkillEmbedding = await computeAverageEmbedding(skillEmbeddings);
    const avgFeatureEmbedding =
      await computeAverageEmbedding(featureEmbeddings);
    const avgJobTitleEmbedding =
      await computeAverageEmbedding(jobTitleEmbeddings);

    console.log("Computed average embeddings.");

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

    const combinedScores = {};

    [skillMatches, featureMatches, jobTitleMatches].forEach((matches) => {
      matches.forEach((match) => {
        if (!inputCandidateIds.has(match.id)) {
          combinedScores[match.id] =
            (combinedScores[match.id] || 0) + match.score;
        }
      });
    });

    const allCandidates = await fetchAllCandidates();
    console.log(
      `Fetched all ${allCandidates.length} candidates from the database.`,
    );

    const batchSize = 1000;

    for (let i = 0; i < allCandidates.length; i += batchSize) {
      const batch = allCandidates.slice(i, i + batchSize);

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

          // Company and education scoring remains the same
          if (
            candidate.linkedinData &&
            candidate.linkedinData.positions &&
            candidate.linkedinData.positions.positionHistory
          ) {
            const companies =
              candidate.linkedinData.positions.positionHistory.map(
                (position) => position.companyName,
              );
            const companyScore = companies.reduce((score, company) => {
              return score + (companyWeights[company] || 0);
            }, 0);
            combinedScores[candidate.id] =
              (combinedScores[candidate.id] || 0) + companyScore;
          }

          if (
            candidate.linkedinData &&
            candidate.linkedinData.schools &&
            candidate.linkedinData.schools.educationHistory
          ) {
            const schools = candidate.linkedinData.schools.educationHistory.map(
              (education) => education.schoolName,
            );
            const educationScore = schools.reduce((score, school) => {
              return score + (educationWeights[school] || 0);
            }, 0);
            combinedScores[candidate.id] =
              (combinedScores[candidate.id] || 0) + educationScore;
          }

          // Apply NYC proximity weighting if applicable
          if (shouldApplyNYCWeight && candidate.livesNearBrooklyn) {
            combinedScores[candidate.id] =
              (combinedScores[candidate.id] || 0) * 1.2; // 20% boost for NYC proximity
          }
        }
      });

      console.log(
        `Processed batch ${i / batchSize + 1} of ${Math.ceil(allCandidates.length / batchSize)}`,
      );
    }

    const topCandidates = allCandidates
      .filter((candidate) => !inputCandidateIds.has(candidate.id))
      .map((candidate) => {
        const { experienceScore, totalExperience } = calculateExperienceScore(
          candidate,
          lowerBound,
          upperBound,
        );
        return {
          ...candidate,
          score: combinedScores[candidate.id] || 0,
          totalExperience,
          experienceScore,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 100);

    console.log(
      "Top 100 candidates based on combined similarity scores, company experience, education, NYC proximity, and years of experience (excluding input candidates):",
    );
    for (const candidate of topCandidates) {
      console.log(
        `Candidate: ${candidate.url}, Combined Score: ${candidate.score.toFixed(2)}, Near NYC: ${candidate.livesNearBrooklyn}, Total Experience: ${candidate.totalExperience} years, Experience Score: ${candidate.experienceScore.toFixed(2)}`,
      );
    }
  } catch (error) {
    console.error("Error in main function:", error);
  }
}

const linkedinUrls = [
  "https://www.linkedin.com/in/harshhpareek",
  "https://www.linkedin.com/in/seshakumarpg",
  "https://www.linkedin.com/in/jagill",
  "https://www.linkedin.com/in/sean-ross-b5217054",
  "https://www.linkedin.com/in/sudeep-srivastava-2129484",
  "https://www.linkedin.com/in/ryandmack",
  "https://www.linkedin.com/in/komal-kapoor-517b1b9",
  "https://www.linkedin.com/in/shawna-jemison-4918774",
  "https://www.linkedin.com/in/aaron-chen-92486724",
  "https://www.linkedin.com/in/sashasheng",
  "https://www.linkedin.com/in/vasiliykuznetsov",
  "https://www.linkedin.com/in/lars-backstrom-862a764",
  "https://www.linkedin.com/in/sudheendravijayakumar",
];

main(linkedinUrls)
  .then(() => console.log("Analysis completed successfully."))
  .catch((error) => console.error("Error during analysis:", error));
