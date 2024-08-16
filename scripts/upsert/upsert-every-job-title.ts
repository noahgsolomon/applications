import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";
import dotenv from "dotenv";
import * as userSchema from "../../server/db/schemas/users/schema";
import { candidates as candidatesTable } from "../../server/db/schemas/users/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { InferSelectModel } from "drizzle-orm";

dotenv.config({ path: "../../.env" });

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
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: text,
      encoding_format: "float",
    });

    if (response && response.data && response.data.length > 0) {
      return response.data[0].embedding;
    } else {
      console.error("Invalid response from OpenAI API:", response);
      return [];
    }
  } catch (error) {
    console.error("Error while getting embedding:", error);
    return [];
  }
}

const processJobTitles = async (
  candidates: InferSelectModel<typeof candidatesTable>[],
) => {
  const jobTitles: Set<string> = new Set();
  for (const candidate of candidates) {
    if (candidate.jobTitles) {
      for (const title of candidate.jobTitles) {
        const trimmedTitle = title.trim();
        if (trimmedTitle) {
          jobTitles.add(trimmedTitle);
        } else {
          console.log(`Skipping empty or malformed job title: ${title}`);
        }
      }
    }
  }

  const sortedJobTitles = Array.from(jobTitles).sort();
  console.log("Processing job titles: " + sortedJobTitles.length);

  const batchSize = 25;
  let i = 0;

  for (let j = 35000; j < sortedJobTitles.length; j += batchSize) {
    const batch = sortedJobTitles.slice(j, j + batchSize);
    const promises = batch.map(async (title) => {
      if (/^[\x00-\x7F]*$/.test(title)) {
        console.log("getting embedding for: " + title);
        const titleEmbedding = await getEmbedding(title);
        if (titleEmbedding.length > 0) {
          await index.namespace("job-titles").upsert([
            {
              id: title,
              values: titleEmbedding,
              metadata: {
                jobTitle: title,
              },
            },
          ]);
          console.log("upserted: " + title);
        }
      } else {
        console.log(`Skipping non-ASCII job title: ${title}`);
      }
    });

    await Promise.all(promises);
    i += batchSize;
    console.log(
      `Processed ${i} job titles, ${(i / sortedJobTitles.length) * 100}% done`,
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

  await processJobTitles(candidates);

  console.log("All candidates processed.");
};

main();
