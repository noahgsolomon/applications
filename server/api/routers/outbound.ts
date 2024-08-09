import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  candidates,
  company,
  outbound,
  outboundCandidates,
  pendingCompanyOutbound,
  pendingOutbound,
  relevantRoles,
} from "@/server/db/schemas/users/schema";
import { createSelectSchema } from "drizzle-zod";
//@ts-ignore
import { v4 as uuid } from "uuid";
import OpenAI from "openai";
import { desc, eq, inArray, InferSelectModel, ne } from "drizzle-orm";
import { Resource } from "sst";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const client = new SQSClient();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export const outboundRouter = createTRPCRouter({
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
        If no company in this list is in their query or if their query has no mention of a company, return valid as false. 
        Also, extract the job title and an array of skills mentioned in the query.
        Return the result as a JSON object with the following structure: 
        { 
          "companyNames": string[], 
          "job": string, 
          "skills": string[], 
          "valid": boolean, 
          "message": string 
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

      const firstResponse = JSON.parse(
        firstCompletion.choices[0].message.content ??
          '{ "valid": false, "message": "No response", "companyNames": [], "job": "", "skills": [] }',
      );

      const secondResponse = JSON.parse(
        secondCompletion.choices[0].message.content ?? '{ "relevantRole": "" }',
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
        // return {
        //   valid: false,
        //   message: "No valid company found in the query.",
        //   companies: [],
        //   job: "",
        //   relevantRole: "",
        //   skills: [],
        // };
        responseCompanyNames = companyNames;
      }

      const companiesDB = await ctx.db.query.company.findMany({
        where: inArray(company.name, responseCompanyNames),
      });

      if (!companiesDB || companiesDB.length === 0) {
        return {
          valid: false,
          message: "Internal server error. Please try again.",
          companies: [],
          relevantRole: undefined,
          job: "",
          skills: [],
        };
      }

      //TODO add relevant roles in db so to make this not implicitly null
      return {
        valid: true,
        message: "Company found.",
        relevantRole: undefined,
        companies: companiesDB,
        job: response.job,
        skills: response.skills,
        query: input.query,
      };
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
  searches: protectedProcedure.query(async ({ ctx }) => {
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

    // Fetch all outbound entries
    const outboundEntries = await ctx.db.query.outbound.findMany({
      orderBy: [desc(outbound.createdAt)],
    });

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
            where: inArray(company.id, pendingCompanyOutbound.companyIds),
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
