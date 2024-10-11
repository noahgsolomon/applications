import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";
import {
  candidates,
  company as companyTable,
} from "@/server/db/schemas/users/schema";
import * as schema from "@/server/db/schemas/users/schema";
//@ts-ignore
import { v4 as uuid } from "uuid";
import OpenAI from "openai";
import {
  and,
  desc,
  eq,
  exists,
  inArray,
  InferSelectModel,
  isNotNull,
  or,
} from "drizzle-orm";
import { InferResultType } from "@/utils/infer";
import { jsonArrayContainsAny } from "@/lib/utils";
import { Pinecone } from "@pinecone-database/pinecone";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Resource } from "sst";

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

export const outboundRouter = createTRPCRouter({
  getAbsoluteFilteredTopCandidates: publicProcedure
    .input(z.any())
    .mutation(async ({ ctx, input }) => {
      console.log("input", input);
      let conditions = [];
      if (input.showTwitter) {
        conditions.push(isNotNull(schema.people.twitterUsername));
      }
      if (input.showWhop) {
        conditions.push(
          or(
            eq(schema.people.isWhopUser, true),
            eq(schema.people.isWhopCreator, true)
          )
        );
      }
      if (input.showGithub) {
        conditions.push(isNotNull(schema.people.githubLogin));
      }
      if (input.showLinkedin) {
        conditions.push(isNotNull(schema.people.linkedinUrl));
      }
      const topCandidates = await ctx.db.query.people.findMany({
        where: and(
          ...conditions,
          inArray(
            schema.people.id,
            input.allIdsResponse.map((id: any) => id.id)
          )
        ),
      });

      const topCandidatesWithScores = topCandidates
        .map((candidate) => {
          const idResponse = input.allIdsResponse.find(
            (id: any) => id.id === candidate.id
          );
          return {
            data: candidate,
            score: idResponse?.score || 0,
            matchedSkills: idResponse?.matchedSkills || [],
            matchedJobTitle: idResponse?.matchedJobTitle || undefined,
            matchedLocation: idResponse?.matchedLocation || undefined,
            matchedCompanies: idResponse?.matchedCompanies || [],
            matchedSchools: idResponse?.matchedSchools || [],
            matchedFieldsOfStudy: idResponse?.matchedFieldsOfStudy || [],
            from: idResponse?.from || undefined,
            attributions: idResponse?.attributions || undefined,
            activeGithub: idResponse?.activeGithub || undefined,
            activeGithubScore: idResponse?.activeGithubScore || undefined,
          };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, 100);

      return topCandidatesWithScores;
    }),
  insertIntoQueue: publicProcedure
    .input(
      z.object({
        payload: z.any(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // const { payload } = input;

      const similarProfileQueries = await ctx.db.query.profileQueue.findMany();

      if (similarProfileQueries.length > 0) {
        return;
      }
      const sqsClient = new SQSClient({ region: "us-east-1" });

      const queueUrl = Resource.FindSimilarProfilesLinkedinQueue.url;

      if (!queueUrl) {
        throw new Error("Queue URL not configured");
      }

      try {
        const command = new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(input.payload),
        });

        const response = await sqsClient.send(command);

        return {
          success: true,
          messageId: response.MessageId,
        };
      } catch (error) {
        console.error("Error sending message to SQS:", error);
        throw new Error("Error sending message to SQS");
      }
    }),
  getPendingSimilarProfiles: publicProcedure.query(async ({ ctx }) => {
    const pendingSimilarProfiles = await ctx.db
      .select()
      .from(schema.profileQueue);

    return pendingSimilarProfiles;
  }),
  deletePendingSimilarProfiles: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input: { id } }) => {
      await ctx.db
        .delete(schema.profileQueue)
        .where(eq(schema.profileQueue.id, id));
    }),
  findFilteredCandidates: publicProcedure
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
        location: z.string().optional(),
        activeGithub: z.boolean().optional(),
        whopUser: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      console.log("Starting findFilteredCandidates mutation");
      const similarTechnologiesArrays = await Promise.all(
        input.skills.map((skill) => querySimilarTechnologies(skill))
      );

      let similarJobTitlesArray: string[] = [];
      if (input.job && input.job !== "") {
        similarJobTitlesArray = await querySimilarJobTitles(input.job);
      }

      try {
        console.log(
          "Similar technologies arrays:",
          similarTechnologiesArrays.flat()
        );

        const allSimilarTechnologies = similarTechnologiesArrays.flat();

        console.log("Expanded skills:", allSimilarTechnologies);

        const candidatesFiltered = await ctx.db.query.candidates.findMany({
          with: { company: true },
          where: (candidate, { and, eq, inArray }) => {
            let condition = or(
              eq(candidate.livesNearBrooklyn, true),
              eq(candidate.livesNearBrooklyn, false)
            );
            if (input.nearBrooklyn) {
              condition = eq(candidate.livesNearBrooklyn, true);
            }
            let skillCondition = undefined;
            if (input.skills.length > 0) {
              skillCondition = jsonArrayContainsAny(
                candidate.topTechnologies,
                allSimilarTechnologies.map((tech) => tech.technology)
              );
            }
            let jobTitleCondition = undefined;
            if (similarJobTitlesArray.length > 0) {
              jobTitleCondition = jsonArrayContainsAny(
                candidate.jobTitles,
                similarJobTitlesArray
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
                      eq(candidate.companyId, companyTable.id)
                    )
                  )
              ),
              jobTitleCondition
            );
          },
        });

        // Sort candidates based on the number of matching skills
        const sortedCandidates = candidatesFiltered
          .map((candidate) => {
            const matchingSkillsCount = allSimilarTechnologies.filter((tech) =>
              candidate.topTechnologies?.includes(tech.technology)
            ).length;
            return { ...candidate, matchingSkillsCount };
          })
          .sort((a, b) => b.matchingSkillsCount - a.matchingSkillsCount);

        // Truncate to 100 candidates
        const topCandidates = sortedCandidates.slice(0, 100);

        // Make fetch request for each candidate
        await Promise.all(
          topCandidates.map(async (candidate) => {
            try {
              const candidateDB = await ctx.db.query.candidates.findFirst({
                where: eq(candidates.id, candidate.id),
              });
              if (!candidateDB?.cookdReviewed) {
                // const response = await fetch("https://cookd.dev/api/score", {
                //   method: "POST",
                //   headers: {
                //     "Content-Type": "application/json",
                //   },
                //   body: JSON.stringify({
                //     resumeScreenerId: process.env.COOKD_RESUME_SCREENER_ID,
                //     slugId: process.env.COOKD_SLUG_ID,
                //     apiKey: process.env.COOKD_API_KEY,
                //     webhookUrl:
                //       "https://d2ft34rr19twyp.cloudfront.net/api/webhook",
                //     candidateJson: {
                //       id: candidate.id,
                //       first_name: candidate.linkedinData.firstName,
                //       last_name: candidate.linkedinData.lastName,
                //       ...candidate.linkedinData,
                //     },
                //   }),
                // });
                // const responseBody = await response.text();
                // console.log(responseBody);
              }
            } catch (error) {
              console.error(`Error scoring candidate ${candidate.id}:`, error);
            }
          })
        );

        return {
          valid: topCandidates.length > 0,
          message:
            topCandidates.length > 0
              ? "Relevant candidates found."
              : "No relevant candidates found.",
          candidates: topCandidates,
          query: input.query,
          job: input.job,
          skills: similarTechnologiesArrays.flat(),
          nearBrooklyn: input.nearBrooklyn,
          relevantRoleId: input.relevantRoleId ?? undefined,
        };
      } catch (error) {
        console.error("Error during findFilteredCandidates mutation:", error);
        throw new Error("An error occurred during the mutation.");
      }
    }),
  findRelevantCompanies: publicProcedure
    .input(z.object({ query: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const companies = await ctx.db.query.company.findMany({
        where: (company, { exists, eq }) =>
          exists(
            ctx.db
              .select()
              .from(candidates)
              .where(eq(candidates.companyId, company.id))
          ),
      });

      const companyNames = companies.map((company) => company.name);

      // Step 1: Standardize the input query to technologies, specialties, and features
      const completion = await openai.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `
You will be provided with multiple technology terms and or specialties/features. OR, you will be provided a list of company names. If any company is mentioned, find the company names from the following list: ${companyNames.join(
              ", "
            )}. 
        If no company in this list is in their query or if their query has no mention of a company, then your task is to standardize it into three categories: technologies, specialties, and features.
- Technologies are specific programming languages, frameworks, or tools (e.g., "JavaScript", "Ruby on Rails", "Next.js").
- Specialties describe the type of company or domain (e.g., "Version control", "Web browser", "Open source project hosting").
- Features are technical features being queried, such as "live messaging", "notifications", or "tab management".

If the input is already standardized, return it as is.

Respond only with a JSON object that has four fields: "standardizedTechs", "standardizedSpecialties", and "standardizedFeatures", "companyNames". Each should be an array of standardized terms.
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
        completion.choices[0].message.content ?? "{}"
      );

      console.log(
        "Standardized response:",
        JSON.stringify(standardizedResponse, null, 2)
      );

      const standardizedTechs: string[] =
        standardizedResponse.standardizedTechs?.map((tech: string) =>
          tech.toLowerCase()
        ) ?? [];
      const standardizedSpecialties: string[] = [
        ...standardizedResponse.standardizedFeatures?.map((feature: string) =>
          feature.toLowerCase()
        ),
        ...standardizedResponse.standardizedSpecialties?.map(
          (specialty: string) => specialty.toLowerCase()
        ),
      ];
      const standardizedFeatures: string[] = [
        ...standardizedResponse.standardizedFeatures?.map((feature: string) =>
          feature.toLowerCase()
        ),
        ...standardizedResponse.standardizedSpecialties?.map(
          (specialty: string) => specialty.toLowerCase()
        ),
      ];

      const companiesDB = await ctx.db.query.company.findMany({
        where: inArray(companyTable.name, standardizedResponse.companyNames),
      });

      if (
        companiesDB.length > 0 &&
        standardizedTechs.length === 0 &&
        standardizedSpecialties.length === 0 &&
        standardizedFeatures.length === 0
      ) {
        return {
          valid: true,
          companies: companiesDB.map((company) => ({
            id: company.id,
            name: company.name,
            linkedinUrl: company.linkedinUrl,
            logo: company.logo,
          })),
          filters: [],
        };
      }

      console.log(
        "Standardized technologies:",
        JSON.stringify(standardizedTechs, null, 2)
      );

      // Step 2: Query Pinecone to get the most similar technologies, specialties, and features for each standardized term
      const allTechnologiesToSearch: {
        score: number;
        technology: string;
      }[][] = await Promise.all(
        standardizedTechs.map(
          async (tech) => await querySimilarTechnologies(tech)
        )
      );

      console.log(
        allTechnologiesToSearch.map((s) => s.map((t) => t.technology))
      );

      const allFeaturesToSearch: {
        score: number;
        feature: string;
      }[][] = await Promise.all(
        standardizedFeatures.map(
          async (feature) => await querySimilarFeatures(feature)
        )
      );

      const allSpecialtiesToSearch: {
        score: number;
        specialty: string;
      }[][] = await Promise.all(
        standardizedSpecialties.map(
          async (specialty) => await querySimilarSpecialties(specialty)
        )
      );

      // Step 3: Fetch all companies from the database without related candidates
      const companiesList = await ctx.db.query.company.findMany();

      const matchingCompanies: InferResultType<"company">[] = [];

      const companyScores: Record<string, number> = {};

      console.log(
        `allTechnologiesToSearch: ${allTechnologiesToSearch.map((s) =>
          s.map((t) => t.technology)
        )}`
      );
      console.log(
        `allFeaturesToSearch: ${JSON.stringify(allFeaturesToSearch, null, 2)}`
      );
      console.log(
        `allSpecialtiesToSearch: ${JSON.stringify(
          allSpecialtiesToSearch,
          null,
          2
        )}`
      );

      // Step 4: Iterate over the companies list and fetch related candidates as needed
      for (const company of companiesList) {
        let score = 0;
        let matchesAllTechs = true;

        // Ensure each technology has a match in the company
        for (const similarTechnologies of allTechnologiesToSearch) {
          const hasMatchingTechnology = similarTechnologies.some(
            ({ technology, score: techScore }) =>
              company.topTechnologies?.includes(technology)
          );

          if (!hasMatchingTechnology) {
            matchesAllTechs = false;
            break;
          } else {
            similarTechnologies
              .filter(({ technology }) =>
                company.topTechnologies?.includes(technology)
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
              company.topFeatures?.includes(feature)
            );

            if (hasMatchingFeature) {
              hasHadMatchingFeature = true;
              similarFeatures
                .filter(({ feature }) => company.topFeatures?.includes(feature))
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
              ({ specialty }) => company.specialties?.includes(specialty)
            );

            if (hasMatchingSpecialty) {
              hasHadMatchingSpecialty = true;
              similarSpecialties
                .filter(({ specialty }) =>
                  company.specialties?.includes(specialty)
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
          matchingCompanies.push(company);
          companyScores[company.id] = score;
        }
      }

      // Sort matching companies by score
      matchingCompanies.sort(
        (a, b) => companyScores[b.id] - companyScores[a.id]
      );

      console.log(
        "Matching companies:",
        matchingCompanies.map((c) => c.name + ` ${companyScores[c.id]}`)
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
            new Set([...standardizedFeatures, ...standardizedSpecialties])
          ),
        ],
      };
    }),

  companyFilter: publicProcedure
    .input(z.object({ query: z.string() }))
    .mutation(async ({ ctx, input }) => {
      console.log("Starting companyFilter mutation");
      console.log("Input received:", input);

      try {
        // Fetch all company names from the database
        const companies = await ctx.db.query.company.findMany({
          columns: {
            name: true,
          },
        });

        const companyNames = companies.map((company) => company.name);

        const firstCompletion = await openai.chat.completions.create({
          messages: [
            {
              role: "system",
              content: `
Given the search query, find the company names from the following list: ${companyNames.join(
                ", "
              )}.

Also, extract the job title, an array of skills, location, and the minimum GitHub stars count mentioned in the query.

- For the **skills**, normalize them because they might be slang (e.g., "rails" should be "Ruby on Rails"). Any technology mentioned can be considered a skill.
- For the **location**, extract any location mentioned in the query.
- For the **minGithubStars**, extract any minimum GitHub stars count mentioned.

Given a location, return the uppercase state name if it's a US location, or the uppercase country name if it's outside the US. If it's a city, return the state (for US) or country it's in. If unsure or the location is invalid, return "".
Examples:
- New York City -> NEW YORK
- New York -> NEW YORK
- London -> UNITED KINGDOM
- California -> CALIFORNIA
- Tokyo -> JAPAN
- Paris, France -> FRANCE
- Sydney -> AUSTRALIA
- 90210 -> CALIFORNIA


Return the result as a JSON object with the following structure:
{
  "companyNames": string[],
  "otherCompanyNames": string[],
  "job": string,
  "skills": string[],
  "location": string,
  "minGithubStars": number,
  "schools": string[],
  "fieldsOfStudy": string[]
}.

If no company they mentioned is in the list, return an empty array for "companyNames". For the companies mentioned not in the list, put those in "otherCompanyNames".
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

        // Parse the responses
        const response = JSON.parse(
          firstCompletion.choices[0].message.content ??
            `{
            "valid": false,
            "message": "No response",
            "companyNames": [],
            "otherCompanyNames": [],
            "job": "",
            "skills": [],
            "location": "",
            "minGithubStars": 0,
            "schools": [],
            "fieldsOfStudy": [],
            "Or": false
          }`
        );

        let responseCompanyNames =
          response.companyNames.length > 0
            ? response.companyNames
            : companyNames;

        // Fetch companies from the database based on the extracted company names
        const companiesDB = await ctx.db.query.company.findMany({
          where: inArray(companyTable.name, responseCompanyNames),
        });

        if (!companiesDB || companiesDB.length === 0) {
          console.error(
            "No companies found or an error occurred during the DB query."
          );
          return {
            valid: true,
            message: "",
            companies: [],
            otherCompanyNames: response.otherCompanyNames,
            job: response.job,
            skills: response.skills,
            location: response.location,
            minGithubStars: response.minGithubStars,
            schools: response.schools,
            fieldsOfStudy: response.fieldsOfStudy,
            query: input.query,
          };
        }

        console.log("Returning final response.");
        return {
          valid: true,
          message: "Company found.",
          companies: companiesDB,
          otherCompanyNames: response.otherCompanyNames,
          job: response.job,
          skills: response.skills,
          location: response.location,
          minGithubStars: response.minGithubStars,
          schools: response.schools,
          fieldsOfStudy: response.fieldsOfStudy,
          query: input.query,
        };
      } catch (error) {
        console.error("Error during mutation:", error);
        throw new Error("An error occurred during the mutation.");
      }
    }),
  allActiveCompanies: publicProcedure.query(async ({ ctx }) => {
    const companies = await ctx.db.query.company.findMany({
      where: (company, { exists, eq }) =>
        exists(
          ctx.db
            .select()
            .from(candidates)
            .where(eq(candidates.companyId, company.id))
        ),
    });

    return companies.map((company) => ({
      id: company.id,
      name: company.name,
      linkedinUrl: company.linkedinUrl,
      logo: company.logo,
    }));
  }),
  sendCookdScoringRequest: publicProcedure
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
              // const response = await fetch("https://cookd.dev/api/score", {
              //   method: "POST",
              //   headers: {
              //     "Content-Type": "application/json",
              //   },
              //   body: JSON.stringify({
              //     resumeScreenerId: process.env.COOKD_RESUME_SCREENER_ID,
              //     slugId: process.env.COOKD_SLUG_ID,
              //     apiKey: process.env.COOKD_API_KEY,
              //     webhookUrl:
              //       "https://d2ft34rr19twyp.cloudfront.net/api/webhook",
              //     candidateJson: {
              //       id: candidate.id,
              //       first_name: candidate.linkedinData.firstName,
              //       last_name: candidate.linkedinData.lastName,
              //       ...candidate.linkedinData,
              //     },
              //   }),
              // });
              // const responseBody = await response.text();
              // console.log(responseBody);
            }
          } catch (error) {
            console.error(`Error scoring candidate ${candidate.id}:`, error);
          }
        })
      );
    }),
  pollCookdScoringRequest: publicProcedure
    .input(z.object({ ids: z.array(z.string()) }))
    .query(async ({ ctx, input }) => {
      const scoredCandidates = await ctx.db.query.candidates.findMany({
        where: (candidate, { and, inArray, eq }) =>
          and(
            inArray(candidate.id, input.ids),
            eq(candidate.cookdReviewed, true)
          ),
      });
      return scoredCandidates;
    }),
});
