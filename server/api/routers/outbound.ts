import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  candidates,
  company as companyTable,
  outbound,
  outboundCandidates,
  pendingCompanyOutbound,
  pendingOutbound,
  relevantRoles,
} from "@/server/db/schemas/users/schema";
//@ts-ignore
import { v4 as uuid } from "uuid";
import OpenAI from "openai";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  InferSelectModel,
  or,
} from "drizzle-orm";
import { InferResultType } from "@/utils/infer";
import { jsonArrayContainsAny } from "@/lib/utils";
import { Pinecone } from "@pinecone-database/pinecone";
import * as schema from "@/server/db/schemas/users/schema";

// const client = new SQSClient();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

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

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY || "",
});

const index = pinecone.Index("whop");

async function querySimilarTechnologies(skill: string) {
  try {
    console.log(`Getting embedding for skill: ${skill}`);
    const skillEmbedding = await getEmbedding(skill);
    console.log(`Got embedding for skill: ${skill}`);

    const queryResponse = await index.namespace("technologies").query({
      topK: 200,
      vector: skillEmbedding,
      includeMetadata: true,
      includeValues: false,
    });

    const similarTechnologies = queryResponse.matches
      .filter((match) => (match.score ?? 0) > 0.7)
      .map((match) => ({
        technology: match.metadata?.technology as string,
        score: match.score ?? 0,
      }));
    return similarTechnologies;
  } catch (error) {
    console.error("Error querying similar technologies:", error);
    return [];
  }
}

async function querySimilarFeatures(feature: string) {
  try {
    console.log(`Getting embedding for feature: ${feature}`);
    const featureEmbedding = await getEmbedding(feature);
    console.log(`Got embedding for feature: ${feature}`);

    const queryResponse = await index.namespace("company-features").query({
      topK: 400,
      vector: featureEmbedding,
      includeMetadata: true,
      includeValues: false,
    });

    const similarFeatures = queryResponse.matches
      .filter((match) => (match.score ?? 0) > 0.6)
      .map((match) => ({
        feature: match.metadata?.feature as string,
        score: match.score ?? 0,
        companyId: match.metadata?.companyId as string,
      }));

    return similarFeatures;
  } catch (error) {
    console.error("Error querying similar features:", error);
    return [];
  }
}

async function querySimilarSpecialties(specialty: string) {
  try {
    console.log(`Getting embedding for specialty: ${specialty}`);
    const specialtyEmbedding = await getEmbedding(specialty);
    console.log(`Got embedding for specialty: ${specialty}`);

    const queryResponse = await index.namespace("company-specialties").query({
      topK: 400,
      vector: specialtyEmbedding,
      includeMetadata: true,
      includeValues: false,
    });

    const similarSpecialties = queryResponse.matches
      .filter((match) => (match.score ?? 0) > 0.6)
      .map((match) => ({
        specialty: match.metadata?.specialty as string,
        score: match.score ?? 0,
        companyId: match.metadata?.companyId as string,
      }));

    return similarSpecialties;
  } catch (error) {
    console.error("Error querying similar specialties:", error);
    return [];
  }
}
async function querySimilarJobTitles(job: string) {
  try {
    console.log(`Getting embedding for job: ${job}`);
    const jobEmbedding = await getEmbedding(job);

    const queryResponse = await index.namespace("job-titles").query({
      topK: 500,
      vector: jobEmbedding,
      includeMetadata: true,
      includeValues: false,
    });

    const similarJobTitles = queryResponse.matches
      .filter((match) => (match.score ?? 0) > 0.7)
      .map((match) => match.metadata?.jobTitle) as string[];

    console.log(`SIMILAR JOB TITLES LENGTH: ${similarJobTitles.length}`);
    return similarJobTitles;
  } catch (error) {
    console.error("Error querying similar job titles:", error);
    return [];
  }
}

export function calculateExperienceBounds(
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

export function calculateExperienceScore(
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

export function analyzeCompanies(
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

export function analyzeEducation(
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

export function analyzeNYCProximity(
  candidates: Array<{ livesNearBrooklyn: boolean | null }>,
): boolean {
  const nycCount = candidates.filter((c) => c.livesNearBrooklyn).length;
  const nycRatio = nycCount / candidates.length;
  const shouldApplyNYCWeight = nycRatio >= 0.5;

  console.log(`NYC proximity ratio: ${nycRatio.toFixed(2)}`);
  console.log(`Applying NYC proximity weighting: ${shouldApplyNYCWeight}`);

  return shouldApplyNYCWeight;
}

export async function computeAverageEmbedding(
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

export async function queryVectorDb(
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

export const outboundRouter = createTRPCRouter({
  findSimilarProfiles: protectedProcedure
    .input(
      z.object({
        profileUrls: z.array(z.string().url()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      console.log("20 second delay");
      await new Promise((resolve) => setTimeout(resolve, 20000));
      console.log("Starting findSimilarProfiles mutation");
      try {
        console.log("Fetching input candidates");
        // Fetch input candidates
        const inputCandidates = await ctx.db.query.candidates.findMany({
          where: inArray(schema.candidates.url, input.profileUrls),
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
          throw new Error(
            "No matching input candidates found in the database.",
          );
        }

        console.log(
          `Found ${inputCandidates.length} matching input candidates.`,
        );

        console.log("Calculating experience bounds");
        // Calculate experience bounds
        const { mean, stdDev } = calculateExperienceBounds(inputCandidates);
        console.log(
          `Experience mean: ${mean.toFixed(2)} years, StdDev: ${stdDev.toFixed(2)} years`,
        );

        const inputCandidateIds = new Set(inputCandidates.map((c) => c.id));

        console.log("Analyzing input candidates");
        // Analyze input candidates
        const companyWeights = analyzeCompanies(inputCandidates);
        const educationWeights = analyzeEducation(inputCandidates);
        const shouldApplyNYCWeight = analyzeNYCProximity(inputCandidates);

        // Generate embeddings
        console.log("Generating embeddings...");
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
        console.log("Embeddings generated.");

        // Compute average embeddings
        console.log("Computing average embeddings...");
        const avgSkillEmbedding =
          await computeAverageEmbedding(skillEmbeddings);
        const avgFeatureEmbedding =
          await computeAverageEmbedding(featureEmbeddings);
        const avgJobTitleEmbedding =
          await computeAverageEmbedding(jobTitleEmbeddings);
        console.log("Average embeddings computed.");

        // Query vector DB
        console.log("Querying vector DB...");
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
        console.log("Vector DB queries completed.");

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
        console.log("Scores combined.");

        // Fetch all candidates
        console.log("Fetching all candidates");
        const allCandidates = await ctx.db.query.candidates.findMany();
        console.log(`Fetched ${allCandidates.length} candidates`);

        // Process candidates in batches
        console.log("Processing candidates in batches");
        const batchSize = 1000;
        for (let i = 0; i < allCandidates.length; i += batchSize) {
          console.log(`Processing batch ${i / batchSize + 1}`);
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
                const schools =
                  candidate.linkedinData.schools.educationHistory.map(
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
        console.log("Finished processing all batches");

        // Sort and select top candidates
        console.log("Sorting and selecting top candidates");
        const topCandidates = allCandidates
          .filter((candidate) => !inputCandidateIds.has(candidate.id))
          .map((candidate) => {
            const { experienceScore, totalExperience } =
              calculateExperienceScore(candidate, mean, stdDev);
            return {
              ...candidate,
              score: combinedScores[candidate.id] || 0,
              experienceScore,
              totalExperience,
            };
          })
          .sort((a, b) => b.score - a.score)
          .slice(0, 100);
        console.log(`Selected ${topCandidates.length} top candidates`);

        console.log("Returning results");
        return {
          success: true,
          message: "Similar profiles found based on various factors.",
          similarProfiles: topCandidates,
        };
      } catch (error) {
        console.error("Error in findSimilarProfiles:", error);
        throw new Error("An error occurred while finding similar profiles.");
      }
    }),
  findFilteredCandidates: protectedProcedure
    .input(
      z.object({
        query: z.string(),
        job: z.string(),
        relevantRoleId: z.string().optional(),
        nearBrooklyn: z.boolean(),
        searchInternet: z.boolean(),
        skills: z.array(z.string()),
        booleanSearch: z.string().optional(),
        companyIds: z.array(z.string()),
        Or: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      console.log("Starting findFilteredCandidates mutation");
      const similarTechnologiesArrays = await Promise.all(
        input.skills.map((skill) => querySimilarTechnologies(skill)),
      );

      let similarJobTitlesArray: string[] = [];
      if (input.job && input.job !== "") {
        similarJobTitlesArray = await querySimilarJobTitles(input.job);
      }

      try {
        console.log(
          "Similar technologies arrays:",
          similarTechnologiesArrays.flat(),
        );

        if (input.Or) {
          // If input.Or is true, flatten the arrays into a single array
          const allSimilarTechnologies = similarTechnologiesArrays.flat();

          console.log("Expanded skills (OR logic):", allSimilarTechnologies);

          const candidatesFiltered = await ctx.db.query.candidates.findMany({
            limit: 100,
            with: { company: true },
            where: (candidate, { and, eq, inArray }) => {
              let condition = or(
                eq(candidate.livesNearBrooklyn, true),
                eq(candidate.livesNearBrooklyn, false),
              );
              if (input.nearBrooklyn) {
                condition = eq(candidate.livesNearBrooklyn, true);
              }
              let skillCondition = undefined;
              if (input.skills.length > 0) {
                skillCondition = jsonArrayContainsAny(
                  candidate.topTechnologies,
                  allSimilarTechnologies.map((tech) => tech.technology),
                );
              }
              let jobTitleCondition = undefined;
              if (similarJobTitlesArray.length > 0) {
                jobTitleCondition = jsonArrayContainsAny(
                  candidate.jobTitles,
                  similarJobTitlesArray,
                );
              }
              return and(
                condition,
                skillCondition,
                exists(
                  ctx.db
                    .select()
                    .from(companyTable)
                    .where(
                      and(
                        inArray(companyTable.id, input.companyIds),
                        eq(candidate.companyId, companyTable.id),
                      ),
                    ),
                ),
                jobTitleCondition,
              );
            },
          });

          // Make fetch request for each candidate
          await Promise.all(
            candidatesFiltered.map(async (candidate) => {
              try {
                const candidateDB = await ctx.db.query.candidates.findFirst({
                  where: eq(candidates.id, candidate.id),
                });
                if (!candidateDB?.cookdReviewed) {
                  const response = await fetch("https://cookd.dev/api/score", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      resumeScreenerId: process.env.COOKD_RESUME_SCREENER_ID,
                      slugId: process.env.COOKD_SLUG_ID,
                      apiKey: process.env.COOKD_API_KEY,
                      webhookUrl:
                        "https://d2ft34rr19twyp.cloudfront.net/api/webhook",
                      candidateJson: {
                        id: candidate.id,
                        first_name: candidate.linkedinData.firstName,
                        last_name: candidate.linkedinData.lastName,
                        ...candidate.linkedinData,
                      },
                    }),
                  });
                  const responseBody = await response.text();
                  console.log(responseBody);
                }
              } catch (error) {
                console.error(
                  `Error scoring candidate ${candidate.id}:`,
                  error,
                );
              }
            }),
          );

          return {
            valid: candidatesFiltered.length > 0,
            message:
              candidatesFiltered.length > 0
                ? "Relevant candidates found."
                : "No relevant candidates found.",
            candidates: candidatesFiltered,
            query: input.query,
            job: input.job,
            skills: similarTechnologiesArrays.flat(),
            nearBrooklyn: input.nearBrooklyn,
            relevantRoleId: input.relevantRoleId ?? undefined,
          };
        } else {
          // If input.Or is false, chain conditions for each group of similar technologies

          let candidatesFiltered = await ctx.db.query.candidates.findMany({
            limit: 100,
            with: { company: true },
            where: (candidate, { and, eq }) => {
              const extraConditions: any[] = [];

              similarTechnologiesArrays.forEach((similarTechnologies) => {
                if (input.skills.length > 0) {
                  const newCondition = jsonArrayContainsAny(
                    candidate.topTechnologies,
                    similarTechnologies.map((tech) => tech.technology),
                  )!;
                  extraConditions.push(newCondition);
                }
              });

              let condition = and(
                eq(candidate.livesNearBrooklyn, true),
                and(...extraConditions),
              )!;

              if (!input.nearBrooklyn) {
                condition = and(
                  or(
                    eq(candidate.livesNearBrooklyn, true),
                    eq(candidate.livesNearBrooklyn, false),
                  ),
                  ...extraConditions,
                )!;
              }

              let jobTitleCondition = undefined;
              if (similarJobTitlesArray.length > 0) {
                jobTitleCondition = jsonArrayContainsAny(
                  candidate.jobTitles,
                  similarJobTitlesArray,
                );
              }

              return and(
                condition,
                exists(
                  ctx.db
                    .select()
                    .from(companyTable)
                    .where(
                      and(
                        inArray(companyTable.id, input.companyIds),
                        eq(candidate.companyId, companyTable.id),
                      ),
                    ),
                ),
                jobTitleCondition,
              );
            },
          });

          // Make fetch request for each candidate
          await Promise.all(
            candidatesFiltered.map(async (candidate) => {
              try {
                const candidateDB = await ctx.db.query.candidates.findFirst({
                  where: eq(candidates.id, candidate.id),
                });
                if (!candidateDB?.cookdReviewed) {
                  const response = await fetch("https://cookd.dev/api/score", {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      resumeScreenerId: process.env.COOKD_RESUME_SCREENER_ID,
                      slugId: process.env.COOKD_SLUG_ID,
                      apiKey: process.env.COOKD_API_KEY,
                      webhookUrl:
                        "https://d2ft34rr19twyp.cloudfront.net/api/webhook",
                      candidateJson: {
                        id: candidate.id,
                        first_name: candidate.linkedinData.firstName,
                        last_name: candidate.linkedinData.lastName,
                        ...candidate.linkedinData,
                      },
                    }),
                  });
                  const responseBody = await response.text();
                  console.log(responseBody);
                }
              } catch (error) {
                console.error(
                  `Error scoring candidate ${candidate.id}:`,
                  error,
                );
              }
            }),
          );

          return {
            valid: candidatesFiltered.length > 0,
            message:
              candidatesFiltered.length > 0
                ? "Relevant candidates found."
                : "No relevant candidates found.",
            candidates: candidatesFiltered,
            query: input.query,
            job: input.job,
            skills: similarTechnologiesArrays.flat(),
            nearBrooklyn: input.nearBrooklyn,
            relevantRoleId: input.relevantRoleId ?? undefined,
          };
        }
      } catch (error) {
        console.error("Error during findFilteredCandidates mutation:", error);
        throw new Error("An error occurred during the mutation.");
      }
    }),
  findRelevantCompanies: protectedProcedure
    .input(z.object({ query: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Step 1: Standardize the input query to technologies, specialties, and features
      const completion = await openai.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `
You will be provided with a technology term. Your task is to standardize it into three categories: technologies, specialties, and features.
- Technologies are specific programming languages, frameworks, or tools (e.g., "JavaScript", "Ruby on Rails", "Next.js").
- Specialties describe the type of company or domain (e.g., "Version control", "Web browser", "Open source project hosting").
- Features are technical features being queried, such as "live messaging", "notifications", or "tab management".

If the input is already standardized, return it as is.

Respond only with a JSON object that has three fields: "standardizedTechs", "standardizedSpecialties", and "standardizedFeatures". Each should be an array of standardized terms.
        `,
          },
          {
            role: "user",
            content: input.query,
          },
        ],
        response_format: { type: "json_object" },
        model: "gpt-4o",
        temperature: 0,
        max_tokens: 1024,
      });

      const standardizedResponse = JSON.parse(
        completion.choices[0].message.content ?? "{}",
      );
      console.log(
        "Standardized response:",
        JSON.stringify(standardizedResponse, null, 2),
      );
      const standardizedTechs: string[] =
        standardizedResponse.standardizedTechs?.map((tech: string) =>
          tech.toLowerCase(),
        ) ?? [];
      const standardizedSpecialties: string[] =
        [
          ...standardizedResponse.standardizedFeatures?.map((feature: string) =>
            feature.toLowerCase(),
          ),
          ...standardizedResponse.standardizedSpecialties?.map(
            (specialty: string) => specialty.toLowerCase(),
          ),
        ] ?? [];
      const standardizedFeatures: string[] =
        [
          ...standardizedResponse.standardizedFeatures?.map((feature: string) =>
            feature.toLowerCase(),
          ),
          ...standardizedResponse.standardizedSpecialties?.map(
            (specialty: string) => specialty.toLowerCase(),
          ),
        ] ?? [];

      console.log(
        "Standardized technologies:",
        JSON.stringify(standardizedTechs, null, 2),
      );

      // Step 2: Query Pinecone to get the most similar technologies, specialties, and features for each standardized term
      const allTechnologiesToSearch: {
        score: number;
        technology: string;
      }[][] = await Promise.all(
        standardizedTechs.map(
          async (tech) => await querySimilarTechnologies(tech),
        ),
      );

      console.log(
        allTechnologiesToSearch.map((s) => s.map((t) => t.technology)),
      );

      const allFeaturesToSearch: {
        score: number;
        feature: string;
      }[][] = await Promise.all(
        standardizedFeatures.map(
          async (feature) => await querySimilarFeatures(feature),
        ),
      );

      const allSpecialtiesToSearch: {
        score: number;
        specialty: string;
      }[][] = await Promise.all(
        standardizedSpecialties.map(
          async (specialty) => await querySimilarSpecialties(specialty),
        ),
      );

      // Step 3: Fetch all companies from the database without related candidates
      const companiesList = await ctx.db.query.company.findMany();

      const matchingCompanies: InferResultType<"company">[] = [];

      const companyScores: Record<string, number> = {};

      console.log(
        `allTechnologiesToSearch: ${allTechnologiesToSearch.map((s) =>
          s.map((t) => t.technology),
        )}`,
      );
      console.log(
        `allFeaturesToSearch: ${JSON.stringify(allFeaturesToSearch, null, 2)}`,
      );
      console.log(
        `allSpecialtiesToSearch: ${JSON.stringify(allSpecialtiesToSearch, null, 2)}`,
      );

      // Step 4: Iterate over the companies list and fetch related candidates as needed
      for (const company of companiesList) {
        const companyDb = await ctx.db.query.company.findFirst({
          where: eq(companyTable.id, company.id),
        });

        if (!companyDb) continue;

        let score = 0;
        let matchesAllTechs = true;

        // Ensure each technology has a match in the company
        for (const similarTechnologies of allTechnologiesToSearch) {
          const hasMatchingTechnology = similarTechnologies.some(
            ({ technology, score: techScore }) =>
              companyDb.topTechnologies?.includes(technology),
          );

          if (!hasMatchingTechnology) {
            matchesAllTechs = false;
            break;
          } else {
            similarTechnologies
              .filter(({ technology }) =>
                companyDb.topTechnologies?.includes(technology),
              )
              .map((res) => (score += res.score)) ?? 0;
          }
        }

        // Ensure all specified features have a match if features are not empty
        let matchesAllFeatures = true;
        if (standardizedFeatures.length > 0) {
          let hasHadMatchingFeature = false;
          for (const similarFeatures of allFeaturesToSearch) {
            const hasMatchingFeature = similarFeatures.some(({ feature }) =>
              companyDb.topFeatures?.includes(feature),
            );

            if (hasMatchingFeature) {
              hasHadMatchingFeature = true;
              similarFeatures
                .filter(({ feature }) =>
                  companyDb.topFeatures?.includes(feature),
                )
                .map((res) => (score += res.score)) ?? 0;
            }
          }
          if (!hasHadMatchingFeature) {
            matchesAllFeatures = false;
          }
        }

        // Ensure all specified specialties have a match if specialties are not empty
        let matchesAllSpecialties = true;
        if (standardizedSpecialties.length > 0) {
          let hasHadMatchingSpecialty = false;
          for (const similarSpecialties of allSpecialtiesToSearch) {
            const hasMatchingSpecialty = similarSpecialties.some(
              ({ specialty }) => companyDb.specialties?.includes(specialty),
            );

            if (hasMatchingSpecialty) {
              hasHadMatchingSpecialty = true;
              similarSpecialties
                .filter(({ specialty }) =>
                  companyDb.specialties?.includes(specialty),
                )
                .map((res) => (score += res.score)) ?? 0;
            }
          }
          if (!hasHadMatchingSpecialty) {
            matchesAllSpecialties = false;
          }
        }

        // Add company only if it matches all criteria
        if (matchesAllTechs && (matchesAllFeatures || matchesAllSpecialties)) {
          matchingCompanies.push(companyDb);
          companyScores[companyDb.id] = score;
        }
      }

      // Sort matching companies by score
      matchingCompanies.sort(
        (a, b) => companyScores[b.id] - companyScores[a.id],
      );

      console.log(
        "Matching companies:",
        matchingCompanies.map((c) => c.name + ` ${companyScores[c.id]}`),
      );

      return {
        valid: matchingCompanies.length > 0,
        companies: matchingCompanies.map((company) => ({
          id: company.id,
          name: company.name,
          linkedinUrl: company.linkedinUrl,
          logo: company.logo,
        })),
        filters: [
          ...standardizedTechs,
          ...Array.from(
            new Set([...standardizedFeatures, ...standardizedSpecialties]),
          ),
        ],
      };
    }),
  deletePendingCompanyOutbound: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(pendingCompanyOutbound)
        .where(eq(pendingCompanyOutbound.id, input.id));
    }),

  companyFilter: protectedProcedure
    .input(z.object({ query: z.string(), searchInternet: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      console.log("Starting companyFilter mutation");
      console.log("Input received:", input);

      try {
        const companies = await ctx.db.query.company.findMany({
          where: (company, { exists, eq }) =>
            exists(
              ctx.db
                .select()
                .from(candidates)
                .where(eq(candidates.companyId, company.id)),
            ),
        });

        const companyNames = companies.map((company) => company.name);

        const firstCompletion = await openai.chat.completions.create({
          messages: [
            {
              role: "system",
              content: `
        Given the search query, find the company names from the following list: ${companyNames.join(", ")}. 
        If no company in this list is in their query or if their query has no mention of a company, return valid as false (note this doesnt mean the input is invalid, I just consider this valid false as a signal to do something else so fill our the rest of the fields). 
        Also, extract the job title and an array of skills mentioned in the query. for the skills, you should normalize them because they might come in as slang (e.g. rails should be Ruby on Rails). Any technology mentioned can be considered a skill. The Or field determines if the skills are all of just one of them. So if the query includes Next.js react or rails Or should be true. Otherwise make Or false.
        Return the result as a JSON object with the following structure: 
        { 
          "companyNames": string[], 
          "job": string, 
          "skills": string[], 
          "valid": boolean, 
          "message": string 
          "Or": boolean
        }.
      `,
            },
            {
              role: "user",
              content: input.query,
            },
          ],
          response_format: { type: "json_object" },
          model: "gpt-4o",
          temperature: 0,
          max_tokens: 512,
        });

        const secondCompletion = await openai.chat.completions.create({
          messages: [
            {
              role: "system",
              content: `
        Given the relevant role from the user's input and the following list of possible roles: 
        Senior Design Engineer, Senior Frontend Engineer, Senior Fullstack Engineer, Senior iOS Engineer, Staff Frontend Engineer, Staff Infrastructure Engineer, Staff iOS Engineer, Staff Rails Engineer, Creator Partnerships Lead, Customer Support Specialist, Head of New Verticals, Senior Growth Data Analyst, Senior Lifecycle Marketing Manager, Senior Product Marketing Manager, Consumer, Senior Product Marketing Manager, Creator, Social Media Lead, Accounting Manager, Executive Assistant, Office Manager, Senior Brand Designer, Senior Product Designer, Creators, Senior Product Designer, User Growth & Engagement.
        Determine which role from this list best matches the user's relevantRole input.
        Return the result as a JSON object with the following structure: 
        { 
          "relevantRole": string 
        }.
      `,
            },
            {
              role: "user",
              content: input.query,
            },
          ],
          response_format: { type: "json_object" },
          model: "gpt-4o",
          temperature: 0,
          max_tokens: 512,
        });

        const firstResponse = JSON.parse(
          firstCompletion.choices[0].message.content ??
            '{ "valid": false, "message": "No response", "companyNames": [], "job": "", "skills": [], "Or": false }',
        );

        const secondResponse = JSON.parse(
          secondCompletion.choices[0].message.content ??
            '{ "relevantRole": "" }',
        );

        const response = {
          ...firstResponse,
          ...secondResponse,
        };

        const relevantRole = await ctx.db.query.relevantRoles.findFirst({
          where: eq(relevantRoles.jobTitle, response.relevantRole),
        });

        let responseCompanyNames = response.companyNames;

        if (!response.valid) {
          console.log(
            "No valid company found in the query. Defaulting to all company names.",
          );
          responseCompanyNames = companyNames;
        }

        const companiesDB = await ctx.db.query.company.findMany({
          where: inArray(companyTable.name, responseCompanyNames),
        });

        if (!companiesDB || companiesDB.length === 0) {
          console.error(
            "No companies found or an error occurred during the DB query.",
          );
          return {
            valid: false,
            message: "Internal server error. Please try again.",
            companies: [],
            relevantRole: undefined,
            job: "",
            skills: [],
            Or: false,
          };
        }

        console.log("Returning final response.");
        return {
          valid: true,
          message: "Company found.",
          relevantRole: relevantRole ?? undefined,
          companies: companiesDB,
          job: response.job,
          skills: response.skills,
          query: input.query,
          Or: response.Or,
        };
      } catch (error) {
        console.error("Error during mutation:", error);
        throw new Error("An error occurred during the mutation.");
      }
    }),
  allActiveCompanies: protectedProcedure.query(async ({ ctx }) => {
    const companies = await ctx.db.query.company.findMany({
      where: (company, { exists, eq }) =>
        exists(
          ctx.db
            .select()
            .from(candidates)
            .where(eq(candidates.companyId, company.id)),
        ),
    });

    return companies.map((company) => ({
      id: company.id,
      name: company.name,
      linkedinUrl: company.linkedinUrl,
      logo: company.logo,
    }));
  }),
  deletePendingOutbound: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(pendingOutbound)
        .where(eq(pendingOutbound.id, input.id));
    }),
  searches: protectedProcedure
    .input(z.object({ recommended: z.boolean() }).optional())
    .query(async ({ ctx, input }) => {
      const result: (InferSelectModel<typeof outbound> & {
        candidates: (InferSelectModel<typeof candidates> & {
          workedInPosition: boolean;
          workedAtRelevant: boolean;
          similarity: number;
          weight: number;
          matched: boolean;
          relevantSkills: string[];
          notRelevantSkills: string[];
        })[];
        matches: (InferSelectModel<typeof candidates> & {
          workedInPosition: boolean;
          workedAtRelevant: boolean;
          similarity: number;
          weight: number;
          matched: boolean;
          relevantSkills: string[];
          notRelevantSkills: string[];
        })[];
      })[] = [];

      let outboundEntries: InferSelectModel<typeof outbound>[];

      if (input?.recommended) {
        outboundEntries = await ctx.db.query.outbound.findMany({
          orderBy: [desc(outbound.createdAt)],
          where: eq(outbound.recommended, true),
        });
      } else {
        outboundEntries = await ctx.db.query.outbound.findMany({
          orderBy: [desc(outbound.createdAt)],
        });
      }
      // Fetch all outbound entries

      for (const o of outboundEntries) {
        // Fetch related candidates through the junction table
        const outboundCandidatesEntries =
          await ctx.db.query.outboundCandidates.findMany({
            with: {
              candidate: true,
            },
            where: eq(outboundCandidates.outboundId, o.id),
          });

        // Combine candidate details with outboundCandidates details
        const candidates = outboundCandidatesEntries.map((entry) => ({
          ...entry.candidate,
          workedInPosition: entry.workedInPosition,
          workedAtRelevant: entry.workedAtRelevant,
          similarity: entry.similarity,
          weight: entry.weight,
          matched: entry.matched ?? false, // Default to false if null
          relevantSkills: entry.relevantSkills ?? [],
          notRelevantSkills: entry.notRelevantSkills ?? [],
        }));

        const matchedCandidates = candidates.filter(
          (candidate) => candidate.matched,
        );

        result.push({
          ...o,
          // no need for candidates and it literally exceeds lamdbas allowable return size LOL
          candidates: [],
          matches: matchedCandidates,
        });
      }

      return result;
    }),
  pollPendingOutbound: protectedProcedure
    .input(z.object({ existingPendingOutboundId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const pendingOutboundRecord = await ctx.db
        .select()
        .from(pendingOutbound)
        .where(eq(pendingOutbound.id, input.existingPendingOutboundId))
        .then((results) => results[0]);

      if (!pendingOutboundRecord) {
        throw new Error("Pending outbound not found.");
      }

      return pendingOutboundRecord;
    }),
  pollPendingCompanyOutbound: protectedProcedure.mutation(
    async ({ ctx, input }) => {
      let pendingCompanyOutboundDB =
        await ctx.db.query.pendingCompanyOutbound.findMany({
          with: {
            relevantRole: true,
          },
        });

      if (!pendingCompanyOutboundDB) {
        throw new Error("Pending company outbound not found.");
      }

      // Map over the pendingCompanyOutboundDB array to add the companies
      const result = await Promise.all(
        pendingCompanyOutboundDB.map(async (pendingCompanyOutbound) => {
          const companies = await ctx.db.query.company.findMany({
            where: inArray(companyTable.id, pendingCompanyOutbound.companyIds),
          });

          // Attach the companies to the current pendingCompanyOutbound object
          return {
            ...pendingCompanyOutbound,
            companies,
          };
        }),
      );

      return result;
    },
  ),
  existingPendingOutbound: protectedProcedure.query(async ({ ctx }) => {
    const existingPendingOutbound = await ctx.db.select().from(pendingOutbound);
    return {
      existing: existingPendingOutbound.length > 0,
      id:
        existingPendingOutbound.length > 0 ? existingPendingOutbound[0].id : -1,
    };
  }),
  addOutboundRequest: protectedProcedure
    .input(
      z.object({
        query: z.string(),
        job: z.string(),
        nearBrooklyn: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const completion = await openai.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `
You generate search queries for Whop, a consumer tech platform. Given a job description or instructions, return a JSON object with three attributes: "isValid" (true or false), "booleanSearch" (a concise boolean string for search), and ;company" (the company name or "Big Tech" if unclear). The job should be the job title or skills mentioned in query or "Software Engineer" if unclear.

- If the query clearly indicates a job title or company, set "isValid" to true. Otherwise, set it to false.

Ensure the boolean search string includes:
- The company name first
- The job title
- Key skills from the query

Return the answer as a JSON object with "isValid", "booleanSearch", "job", and "company". Don't add backslashes in the query
      `,
          },
          {
            role: "user",
            content: input.query,
          },
        ],
        response_format: { type: "json_object" },
        model: "gpt-4o",
        temperature: 0,
        max_tokens: 256,
      });

      console.log("Condition response received.");
      const response = JSON.parse(
        completion.choices[0].message.content ?? '{ "isValid": false }',
      );

      const isValid = response.isValid;

      if (!isValid) {
        return { isValid };
      }

      const uuidId = uuid();
      await ctx.db.insert(pendingOutbound).values({
        id: uuidId,
        job: response.job,
        company: response.company,
        query: input.query,
        progress: 0,
        status: "Starting scrape",
        userId: ctx.user_id,
        outboundId: uuid(),
        nearBrooklyn: input.nearBrooklyn,
        booleanSearch:
          response.booleanSearch + (input.nearBrooklyn ? " AND New York" : ""),
        logs: "",
      });

      // await client.send(
      //   new SendMessageCommand({
      //     QueueUrl: Resource.WhopQueue.url,
      //     MessageBody: JSON.stringify({
      //       pendingOutboundId: uuidId,
      //       type: "OUTBOUND",
      //     }),
      //   }),
      // );

      return { isValid };
    }),

  addCompanyRequest: protectedProcedure
    .input(
      z.object({
        query: z.string(),
        job: z.string(),
        relevantRoleId: z.string().optional(),
        nearBrooklyn: z.boolean(),
        searchInternet: z.boolean(),
        skills: z.array(z.string()),
        booleanSearch: z.string().optional(),
        companyIds: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const uuidId = uuid();
      await ctx.db.insert(pendingCompanyOutbound).values({
        id: uuidId,
        job: input.job,
        companyIds: input.companyIds,
        query: input.query,
        progress: 0,
        status: "Starting scrape",
        userId: ctx.user_id,
        outboundId: uuid(),
        skills: input.skills,
        nearBrooklyn: input.nearBrooklyn,
        searchInternet: input.searchInternet,
        booleanSearch:
          input.booleanSearch + (input.nearBrooklyn ? " AND New York" : ""),
        logs: "",
        relevantRoleId: input.relevantRoleId ?? undefined,
      });

      // await client.send(
      //   new SendMessageCommand({
      //     QueueUrl: Resource.WhopQueue.url,
      //     MessageBody: JSON.stringify({
      //       pendingCompanyOutboundId: uuidId,
      //       type: "COMPANY",
      //     }),
      //   }),
      // );
    }),
  sendCookdScoringRequest: protectedProcedure
    .input(z.object({ ids: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      const candidatesFiltered = await ctx.db.query.candidates.findMany({
        where: inArray(candidates.id, input.ids),
      });
      await Promise.all(
        candidatesFiltered.map(async (candidate) => {
          try {
            const candidateDB = await ctx.db.query.candidates.findFirst({
              where: eq(candidates.id, candidate.id),
            });
            if (!candidateDB?.cookdReviewed) {
              const response = await fetch("https://cookd.dev/api/score", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  resumeScreenerId: process.env.COOKD_RESUME_SCREENER_ID,
                  slugId: process.env.COOKD_SLUG_ID,
                  apiKey: process.env.COOKD_API_KEY,
                  webhookUrl:
                    "https://d2ft34rr19twyp.cloudfront.net/api/webhook",
                  candidateJson: {
                    id: candidate.id,
                    first_name: candidate.linkedinData.firstName,
                    last_name: candidate.linkedinData.lastName,
                    ...candidate.linkedinData,
                  },
                }),
              });
              const responseBody = await response.text();
              console.log(responseBody);
            }
          } catch (error) {
            console.error(`Error scoring candidate ${candidate.id}:`, error);
          }
        }),
      );
    }),
  pollCookdScoringRequest: protectedProcedure
    .input(z.object({ ids: z.array(z.string()) }))
    .query(async ({ ctx, input }) => {
      const scoredCandidates = await ctx.db.query.candidates.findMany({
        where: (candidate, { and, inArray, eq }) =>
          and(
            inArray(candidate.id, input.ids),
            eq(candidate.cookdReviewed, true),
          ),
      });
      return scoredCandidates;
    }),
});
