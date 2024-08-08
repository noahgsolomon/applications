import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import {
  candidates,
  company,
  outbound,
  outboundCandidates,
  pendingOutbound,
} from "@/server/db/schemas/users/schema";
//@ts-ignore
import { v4 as uuid } from "uuid";
import OpenAI from "openai";
import { desc, eq, InferSelectModel, ne } from "drizzle-orm";
import { Resource } from "sst";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const client = new SQSClient();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export const outboundRouter = createTRPCRouter({
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

      const completion = await openai.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `
      Given the search query, find the company from the following list: ${companyNames.join(", ")}. 
      If no company in this list is in their query or if their query has no mention of a company return valid as false and all other fields an empty string except for skills which would be an empty array.
      Return a job title and an array of skills that are mentioned in the query and whichever one of these jobs is the most valid match for which they inputted under the relevantRole field: Senior Design Engineer, Senior Frontend Engineer, Senior Fullstack Engineer, Senior iOS Engineer, Staff Frontend Engineer, Staff Infrastructure Engineer, Staff iOS Engineer, Staff Rails Engineer, Creator Partnerships Lead, Customer Support Specialist, Head of New Verticals, Senior Growth Data Analyst, Senior Lifecycle Marketing Manager, Senior Product Marketing Manager, Consumer, Senior Product Marketing Manager, Creator, Social Media Lead, Accounting Manager, Executive Assistant, Office Manager, Senior Brand Designer, Senior Product Designer, Creators, Senior Product Designer, User Growth & Engagement. 
      Return the result as a JSON object with the following structure: 
      { 
        "companyName": string, 
        "job": string, 
        "skills": string[], 
        "valid": boolean, 
        "relevantRole": string,
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
        max_tokens: 1024,
      });

      const response = JSON.parse(
        completion.choices[0].message.content ??
          '{ "valid": false, "relevantRole": "", "message": "No response", "companyName": "", "job": "", "skills": [] }',
      );

      if (!response.valid) {
        return {
          valid: false,
          message: "No valid company found in the query.",
          company: null,
          job: "",
          relevantRole: "",
          skills: [],
        };
      }

      const companyDB = await ctx.db.query.company.findFirst({
        where: eq(company.name, response.companyName),
      });

      if (!companyDB) {
        return {
          valid: false,
          message: "Internal server error. Please try again.",
          company: null,
          relevantRole: "",
          job: "",
          skills: [],
        };
      }

      return {
        valid: true,
        message: "Company found.",
        relevantRole: response.relevantRole,
        company: companyDB,
        job: response.job,
        skills: response.skills,
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
      })[];
      matches: (InferSelectModel<typeof candidates> & {
        workedInPosition: boolean;
        workedAtRelevant: boolean;
        similarity: number;
        weight: number;
        matched: boolean;
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
      }));

      const matchedCandidates = candidates.filter(
        (candidate) => candidate.matched,
      );

      result.push({
        ...o,
        candidates,
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
  existingPendingOutbound: protectedProcedure.query(async ({ ctx }) => {
    const existingPendingOutbound = await ctx.db.select().from(pendingOutbound);
    return {
      existing: existingPendingOutbound.length > 0,
      id:
        existingPendingOutbound.length > 0 ? existingPendingOutbound[0].id : -1,
    };
  }),
  isValidOutbound: protectedProcedure
    .input(z.object({ query: z.string() }))
    .query(async ({ ctx, input }) => {
      console.log("");
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
          }),
        }),
      );

      return { isValid };
    }),
});
