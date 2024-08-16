import dotenv from "dotenv";
// @ts-ignore
import { v4 as uuid } from "uuid";
import * as userSchema from "../server/db/schemas/users/schema";
import { candidates as candidatesTable } from "../server/db/schemas/users/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, InferSelectModel } from "drizzle-orm";

dotenv.config({
  path: "../.env",
});

const connection = neon(process.env.DB_URL!);
const db = drizzle(connection, {
  schema: {
    ...userSchema,
  },
});

const processCandidates = async (
  candidates: InferSelectModel<typeof candidatesTable>[],
) => {
  for (const candidate of candidates) {
    console.log(`Processing candidate: ${candidate.id}`);
    const jobTitles = candidate.linkedinData.positions.positionHistory.map(
      (position: any) => position.title,
    ) as string[];
    await db
      .update(candidatesTable)
      .set({ jobTitles: jobTitles })
      .where(eq(candidatesTable.id, candidate.id));
  }
};

const main = async () => {
  let offset = 0;
  const limit = 250;
  let candidates: InferSelectModel<typeof candidatesTable>[] = [];

  do {
    candidates = await db.query.candidates.findMany({
      limit: limit,
      offset: offset,
    });

    if (candidates.length > 0) {
      await processCandidates(candidates);
      offset += limit;
    }
  } while (candidates.length > 0);

  console.log("All candidates processed.");
};

main();
