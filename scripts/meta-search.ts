import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import dotenv from "dotenv";
import { eq, gt, or, and, asc } from "drizzle-orm";
import OpenAI from "openai";
import * as userSchema from "../server/db/schemas/users/schema";

dotenv.config({
  path: "../.env",
});

const connection = neon(process.env.DB_URL!);
const db = drizzle(connection, {
  schema: {
    ...userSchema,
  },
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const companyIdToSearch = "175e4a3e-c89e-4b46-ae47-776c4989cbbb";
const limit = 100;

async function fetchCandidatesWithCursor(cursor?: {
  id: string;
  createdAt: Date;
}) {
  return await db.query.candidates.findMany({
    where: cursor
      ? and(
          eq(userSchema.candidates.companyId, companyIdToSearch),
          or(
            gt(userSchema.candidates.createdAt, cursor.createdAt),
            and(
              eq(userSchema.candidates.createdAt, cursor.createdAt),
              gt(userSchema.candidates.id, cursor.id),
            ),
          ),
        )
      : undefined,
    limit: limit,
    orderBy: (candidates) => [asc(candidates.createdAt), asc(candidates.id)],
  });
}

async function fetchAllCandidates() {
  let allCandidates: any[] = [];
  let lastCursor: { id: string; createdAt: Date } | undefined = undefined;

  while (true) {
    const candidates = await fetchCandidatesWithCursor(lastCursor);

    if (candidates.length === 0) {
      break; // No more candidates to fetch
    }

    allCandidates = allCandidates.concat(candidates);
    lastCursor = {
      id: candidates[candidates.length - 1].id,
      createdAt: candidates[candidates.length - 1].createdAt!,
    }; // Update cursor for next page
  }

  console.log(`All candidates: ${allCandidates.length}`);

  return allCandidates;
}

async function checkIfDataEngineeringAtMeta(positionHistory: any[]) {
  const metaPositions = positionHistory
    .filter(
      (position: any) =>
        (position.companyName.toLowerCase() === "facebook" ||
          position.companyName.toLowerCase() === "meta") &&
        position.startEndDate &&
        position.startEndDate.start &&
        position.startEndDate.start.year &&
        position.startEndDate.start.year < 2015,
    )
    .map((position: any) => ({
      title: position.title,
      description: position.description,
    }));

  if (metaPositions.length === 0) return false;

  const condition = JSON.stringify({
    metaPositions,
  });

  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          'You are to return a valid parseable JSON object with one attribute "condition" which can either be true or false. All questions users ask will always be able to be answered in a yes or no. An example response would be { "condition": true }',
      },
      {
        role: "user",
        content: `Did any of these roles have something to do with engineering specifically related to product (customer facing related) Meta/Facebook? If it is ambiguous, no description and says just like Software Engineer then side with false ${condition}`,
      },
    ],
    response_format: { type: "json_object" },
    model: "gpt-4o-mini",
    temperature: 0,
    max_tokens: 256,
  });

  return JSON.parse(
    completion.choices[0].message.content ?? '{ "condition": false }',
  ).condition;
}

async function main() {
  const allCandidates = await fetchAllCandidates();
  let results: { linkedInUrl: string; id: string; data: boolean }[] = [];

  for (const candidate of allCandidates) {
    const linkedinData = candidate.linkedinData;
    if (
      linkedinData &&
      linkedinData.positions &&
      linkedinData.positions.positionHistory
    ) {
      const positionHistory = linkedinData.positions.positionHistory;

      const dataEngineeringAtMeta =
        await checkIfDataEngineeringAtMeta(positionHistory);

      if (dataEngineeringAtMeta) {
        results.push({
          linkedInUrl: linkedinData.linkedInUrl,
          id: candidate.id,
          data: true,
        });
      }
    }
  }

  console.log(results);
  console.log("Total results:", results.length);
}

main().catch((error) => console.error(error));
