import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";
import * as schema from "../server/db/schemas/users/schema";
import dotenv from "dotenv";
import { and, asc, eq, gt, or } from "drizzle-orm";

dotenv.config({ path: "../.env" });

const connection = neon(process.env.DB_URL!);
const db = drizzle(connection, { schema });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const pinecone = new Pinecone({
  apiKey: "fa3798aa-083f-4c82-86d9-c77cf19f2d3a",
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

async function fetchCandidatesWithCursor(cursor: {
  id: string;
  createdAt: Date;
}) {
  try {
    const candidates = await db.query.candidates.findMany({
      columns: {
        id: true,
        topFeatures: true,
        createdAt: true,
      },
      where: and(
        eq(schema.candidates.isSkillAvgInVectorDB, false),
        or(
          gt(schema.candidates.createdAt, cursor.createdAt),
          and(
            eq(schema.candidates.createdAt, cursor.createdAt),
            gt(schema.candidates.id, cursor.id),
          ),
        ),
      ),
      limit: 1000,
      orderBy: (candidates) => [asc(candidates.createdAt), asc(candidates.id)],
    });
    return candidates;
  } catch (error) {
    throw error;
  }
}

async function fetchAllCandidates() {
  let allCandidates: any[] = [];
  let lastCursor: { id: string; createdAt: Date } = {
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
      createdAt: candidates[candidates.length - 1].createdAt!,
    };
  }

  return allCandidates;
}

async function computeAndStoreFeatureAverages() {
  let processedCount = 0;

  const candidates = await fetchAllCandidates();

  console.log(`Retrieved ${candidates.length} candidates`);

  for (const candidate of candidates) {
    if (!candidate.topFeatures || candidate.topFeatures.length === 0) {
      continue;
    }

    const features = candidate.topFeatures;
    const featureEmbeddings = await Promise.all(features.map(getEmbedding));
    const averageEmbedding = featureEmbeddings.reduce(
      (acc, embedding) =>
        acc.map(
          (val: number, i: number) =>
            val + embedding[i] / featureEmbeddings.length,
        ),
      new Array(featureEmbeddings[0].length).fill(0),
    );

    await index.namespace("candidate-feature-average").upsert([
      {
        id: candidate.id,
        values: averageEmbedding,
        metadata: {
          userId: candidate.id,
          features,
        },
      },
    ]);

    // Update the database with the average embedding
    await db
      .update(schema.candidates)
      .set({ isFeatureAvgInVectorDB: true })
      .where(eq(schema.candidates.id, candidate.id));

    processedCount++;
    console.log(`Processed candidate ${processedCount}`);
  }

  console.log(`Completed processing ${processedCount} candidates.`);
}

computeAndStoreFeatureAverages()
  .then(() => console.log("Script completed successfully."))
  .catch((error) => console.error("Error:", error));
