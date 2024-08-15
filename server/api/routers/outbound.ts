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
  arrayOverlaps,
  desc,
  eq,
  exists,
  inArray,
  InferSelectModel,
  sql,
} from "drizzle-orm";
import { Resource } from "sst";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { InferResultType } from "@/utils/infer";
import { jsonArrayContains, jsonArrayContainsAny } from "@/lib/utils";

const client = new SQSClient();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export const outboundRouter = createTRPCRouter({
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
      console.log(input.skills);

      try {
        let candidatesFiltered: InferSelectModel<typeof candidates>[];
        if (input.nearBrooklyn) {
          if (input.Or) {
            candidatesFiltered = await ctx.db.query.candidates.findMany({
              limit: 100,
              where: (candidate, { and, eq, inArray }) =>
                and(
                  eq(candidate.livesNearBrooklyn, true),
                  jsonArrayContainsAny(candidate.topTechnologies, input.skills),
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
                ),
            });
          } else {
            candidatesFiltered = await ctx.db.query.candidates.findMany({
              limit: 100,
              where: (candidate, { and, eq, inArray }) =>
                and(
                  eq(candidate.livesNearBrooklyn, true),
                  jsonArrayContains(candidate.topTechnologies, input.skills),
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
                ),
            });
          }
        } else {
          if (input.Or) {
            candidatesFiltered = await ctx.db.query.candidates.findMany({
              limit: 100,
              where: (candidate, { and, eq, inArray }) =>
                and(
                  jsonArrayContainsAny(candidate.topTechnologies, input.skills),
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
                ),
            });
          } else {
            candidatesFiltered = await ctx.db.query.candidates.findMany({
              limit: 100,
              where: (candidate, { and, eq, inArray }) =>
                and(
                  jsonArrayContains(candidate.topTechnologies, input.skills),
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
                ),
            });
          }
        }

        console.log("Candidates filtered:", candidatesFiltered);

        return {
          valid: candidatesFiltered.length > 0,
          message:
            candidatesFiltered.length > 0
              ? "Relevant candidates found."
              : "No relevant candidates found.",
          candidates: candidatesFiltered,
          query: input.query,
          job: input.job,
          skills: input.skills,
          nearBrooklyn: input.nearBrooklyn,
          relevantRoleId: input.relevantRoleId ?? undefined,
        };
      } catch (error) {
        console.error("Error during findFilteredCandidates mutation:", error);
        throw new Error("An error occurred during the mutation.");
      }
    }),
  findRelevantCompanies: protectedProcedure
    .input(z.object({ query: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Use ChatGPT to standardize the input query into a proper tech name
      const completion = await openai.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `
You will be provided with a technology term, and your task is to standardize it to its proper, full name.
For example:
- "js" should be converted to "JavaScript"
- "rails" should be converted to "Ruby on Rails"
- "nextjs" should be converted to "Next.js"

If the input is already standardized, return it as is.

Respond only with a JSON object that has a single field "standardizedTech" which is the standardized version of the input.
          `,
          },
          {
            role: "user",
            content: input.query,
          },
        ],
        response_format: { type: "json_object" },
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 256,
      });

      const standardizedResponse = JSON.parse(
        completion.choices[0].message.content ?? "{standardizedTech: ''}",
      );
      const standardizedTech =
        standardizedResponse.standardizedTech.toLowerCase();

      // Fetch all companies from the database without related candidates
      const companiesList = await ctx.db.query.company.findMany();

      const matchingCompanies: InferResultType<
        "company",
        { candidates: true }
      >[] = [];

      // Iterate over the companies list and fetch related candidates as needed
      for (const company of companiesList) {
        const companyDb = await ctx.db.query.company.findFirst({
          with: {
            candidates: {
              where: eq(candidates.isEngineer, true),
            },
          },
          where: eq(companyTable.id, company.id),
        });

        if (!companyDb) continue;

        const techFrequencyMap: Record<string, number> = {};
        const featuresFrequencyMap: Record<string, number> = {};

        companyDb.candidates.forEach((candidate) => {
          candidate.topTechnologies?.forEach((tech: string) => {
            techFrequencyMap[tech] = (techFrequencyMap[tech] || 0) + 1;
          });

          candidate.topFeatures?.forEach((feature: string) => {
            featuresFrequencyMap[feature] =
              (featuresFrequencyMap[feature] || 0) + 1;
          });
        });

        // Sort and extract the top 10 technologies and features
        const topTechnologies = Object.entries(techFrequencyMap)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map((entry) => entry[0].toLowerCase());

        const topFeatures = Object.entries(featuresFrequencyMap)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map((entry) => entry[0].toLowerCase());

        // If the standardized tech matches any top technologies or features, add the company to the list
        if (
          topTechnologies.includes(standardizedTech) ||
          topFeatures.includes(standardizedTech)
        ) {
          matchingCompanies.push(companyDb);
        }
      }

      return {
        valid: matchingCompanies.length > 0,
        companies: matchingCompanies,
        message:
          matchingCompanies.length > 0
            ? "Relevant companies found."
            : "No relevant companies found.",
        filters: [standardizedTech],
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

        console.log("Companies found from DB:", companies);

        const companyNames = companies.map((company) => company.name);
        console.log("Company names extracted:", companyNames);

        const firstCompletion = await openai.chat.completions.create({
          messages: [
            {
              role: "system",
              content: `
        Given the search query, find the company names from the following list: ${companyNames.join(", ")}. 
        If no company in this list is in their query or if their query has no mention of a company, return valid as false (note this doesnt mean the input is invalid, I just consider this valid false as a signal to do something else so fill our the rest of the fields). 
        Also, extract the job title and an array of skills mentioned in the query. Any technology mentioned can be considered a skill. The Or field determines if the skills are all of just one of them. So if the query includes Next.js react or rails Or should be true. Otherwise make Or false.
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
          model: "gpt-4o-mini",
          temperature: 0,
          max_tokens: 512,
        });

        console.log("First OpenAI completion response:", firstCompletion);

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
          model: "gpt-4o-mini",
          temperature: 0,
          max_tokens: 512,
        });

        console.log("Second OpenAI completion response:", secondCompletion);

        const firstResponse = JSON.parse(
          firstCompletion.choices[0].message.content ??
            '{ "valid": false, "message": "No response", "companyNames": [], "job": "", "skills": [], "Or": false }',
        );

        console.log("Parsed first response:", firstResponse);

        const secondResponse = JSON.parse(
          secondCompletion.choices[0].message.content ??
            '{ "relevantRole": "" }',
        );

        console.log("Parsed second response:", secondResponse);

        const response = {
          ...firstResponse,
          ...secondResponse,
        };

        console.log("Combined response:", response);

        const relevantRole = await ctx.db.query.relevantRoles.findFirst({
          where: eq(relevantRoles.jobTitle, response.relevantRole),
        });

        console.log("Relevant role from DB:", relevantRole);

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

        console.log("Companies found in second DB query:", companiesDB);

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

    return companies;
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
        model: "gpt-4o-mini",
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

      console.log(JSON.stringify(response, null, 2));

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

      await client.send(
        new SendMessageCommand({
          QueueUrl: Resource.WhopQueue.url,
          MessageBody: JSON.stringify({
            pendingOutboundId: uuidId,
            type: "OUTBOUND",
          }),
        }),
      );

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

      await client.send(
        new SendMessageCommand({
          QueueUrl: Resource.WhopQueue.url,
          MessageBody: JSON.stringify({
            pendingCompanyOutboundId: uuidId,
            type: "COMPANY",
          }),
        }),
      );
    }),
});
