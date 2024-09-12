import { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";
import { db } from "@/server/db";
import { candidates } from "@/server/db/schemas/users/schema";
import { inArray } from "drizzle-orm";
import { Pinecone } from "@pinecone-database/pinecone";
import OpenAI from "openai";
import { NextResponse } from "next/server";

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

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = inputSchema.parse(body);

    console.log("Starting findSimilarProfiles");

    // Fetch input candidates
    const inputCandidates = await db.query.candidates.findMany({
      where: inArray(candidates.url, input.profileUrls),
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
      console.log("No matching input candidates found");
      return NextResponse.json(
        { message: "No matching input candidates found in the database." },
        { status: 404 },
      );
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

    const combinedScores: Record<string, number> = {};

    // Combine scores from vector DB matches
    [skillMatches, featureMatches, jobTitleMatches].forEach((matches) => {
      matches.forEach((match) => {
        if (!inputCandidateIds.has(match.id)) {
          combinedScores[match.id] =
            (combinedScores[match.id] || 0) + match.score;
        }
      });
    });

    // Fetch all candidates
    const allCandidates = await db.query.candidates.findMany();

    // Process candidates in batches
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
    }

    // Sort and select top candidates
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

    return NextResponse.json({
      success: true,
      message: "Similar profiles found based on various factors.",
      similarProfiles: topCandidates,
    });
  } catch (error) {
    console.error("Error in findSimilarProfiles:", error);
    return NextResponse.json(
      { message: "An error occurred while finding similar profiles." },
      { status: 500 },
    );
  }
}
