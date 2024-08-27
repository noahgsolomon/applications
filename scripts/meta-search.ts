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

const companyIdToSearch = "e0db0e46-458a-4f4b-86ff-707793d5a8b7";
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

async function checkIfMobileAppDevelopmentAtUber(positionHistory: any[]) {
  const uberPositions = positionHistory
    .filter(
      (position: any) =>
        position.companyName.toLowerCase() === "uber" &&
        ((position.startEndDate &&
          position.startEndDate.start &&
          position.startEndDate.start.year &&
          position.startEndDate.start.year >= 2010 &&
          position.startEndDate.start.year <= 2016) ||
          (position.startEndDate &&
            position.startEndDate.end &&
            position.startEndDate.end.year &&
            position.startEndDate.end.year >= 2010 &&
            position.startEndDate.end.year <= 2016)),
    )
    .map((position: any) => ({
      title: position.title,
      description: position.description,
    }));

  if (uberPositions.length === 0) return false;

  const condition = JSON.stringify({
    uberPositions,
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
        content: `Did any of these roles involve working on mobile application development at Uber? If it is ambiguous, like no description and says just like Software Engineer then side with false ${condition}`,
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
  const checkPromises = allCandidates.map(async (candidate) => {
    const linkedinData = candidate.linkedinData;
    if (
      linkedinData &&
      linkedinData.positions &&
      linkedinData.positions.positionHistory
    ) {
      const positionHistory = linkedinData.positions.positionHistory;

      const mobileAppDevelopmentAtUber =
        await checkIfMobileAppDevelopmentAtUber(positionHistory);

      if (mobileAppDevelopmentAtUber) {
        return {
          linkedInUrl: linkedinData.linkedInUrl,
          id: candidate.id,
          data: true,
        };
      }
    }
    return null;
  });

  const results = (await Promise.all(checkPromises)).filter(
    (result): result is { linkedInUrl: string; id: string; data: boolean } =>
      result !== null,
  );

  console.log(results);
  console.log("Total results:", results.length);
}

main().catch((error) => console.error(error));
