import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";
import dotenv from "dotenv";
import * as userSchema from "../../server/db/schemas/users/schema";
import { candidates as candidatesTable } from "../../server/db/schemas/users/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { InferSelectModel } from "drizzle-orm";

dotenv.config({ path: "../.env" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const connection = neon(process.env.DB_URL!);

const db = drizzle(connection, {
  schema: {
    ...userSchema,
  },
});

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY ?? "",
});

const index = pinecone.Index("whop");

async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-large",
    input: text,
    encoding_format: "float",
  });

  return response.data[0].embedding;
}

const processTechnologies = async (
  candidates: InferSelectModel<typeof candidatesTable>[],
) => {
  const technologies: Set<string> = new Set();
  for (const candidate of candidates) {
    if (candidate.topTechnologies) {
      for (const tech of candidate.topTechnologies) {
        technologies.add(tech);
      }
    }
  }

  const sortedTechnologies = Array.from(technologies).sort();
  console.log("Processing technologies: " + sortedTechnologies.length);

  const batchSize = 200;
  let i = 0;

  for (let j = 0; j < sortedTechnologies.length; j += batchSize) {
    const batch = sortedTechnologies.slice(j, j + batchSize);
    const promises = batch.map(async (tech) => {
      if (/^[\x00-\x7F]*$/.test(tech)) {
        console.log("getting embedding for: " + tech);
        const techEmbedding = await getEmbedding(tech);

        await index.namespace("technologies").upsert([
          {
            id: tech,
            values: techEmbedding,
            metadata: {
              technology: tech,
            },
          },
        ]);
        console.log("upserted: " + tech);
      } else {
        console.log(`Skipping non-ASCII technology: ${tech}`);
      }
    });

    await Promise.all(promises);
    i += batchSize;
    console.log(
      `Processed ${i} technologies, ${(i / sortedTechnologies.length) * 100}% done`,
    );
  }
};

const main = async () => {
  let offset = 0;
  const limit = 250;
  let candidates: InferSelectModel<typeof candidatesTable>[] = [];

  let candidatesBatch: InferSelectModel<typeof candidatesTable>[];

  do {
    console.log(`Fetching candidates`);

    candidatesBatch = await db.query.candidates.findMany({
      limit: limit,
      offset: offset,
    });

    if (candidatesBatch.length > 0) {
      candidates = candidates.concat(candidatesBatch);
      offset += limit;
    }
  } while (candidatesBatch.length > 0);

  await processTechnologies(candidates);

  console.log("All candidates processed.");
};

main();
