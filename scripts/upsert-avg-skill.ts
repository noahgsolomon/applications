import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";
import * as schema from "../server/db/schemas/users/schema";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";
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

async function computeAndStoreSkillAverages() {
  const candidates = await db.query.candidates.findMany({
    where: eq(schema.candidates.isSkillAvgInVectorDB, false),
    columns: {
      id: true,
      topTechnologies: true,
    },
  });
  console.log(`Retrieved ${candidates.length} candidates`);

  for (const candidate of candidates) {
    if (!candidate.topTechnologies || candidate.topTechnologies.length === 0) {
      continue;
    }

    const skills = candidate.topTechnologies;
    const skillEmbeddings = await Promise.all(skills.map(getEmbedding));
    const averageEmbedding = skillEmbeddings.reduce(
      (acc, embedding) =>
        acc.map(
          (val: number, i: number) =>
            val + embedding[i] / skillEmbeddings.length,
        ),
      new Array(skillEmbeddings[0].length).fill(0),
    );

    await index.namespace("candidate-skill-average").upsert([
      {
        id: candidate.id,
        values: averageEmbedding,
        metadata: {
          userId: candidate.id,
          skills,
        },
      },
    ]);

    // Update the database with the average embedding
    await db
      .update(schema.candidates)
      .set({ isSkillAvgInVectorDB: true })
      .where(eq(schema.candidates.id, candidate.id));

    console.log(`Processed candidate ${candidate.id}`);
  }

  console.log(`Completed processing ${candidates.length} candidates.`);
}

computeAndStoreSkillAverages()
  .then(() => console.log("Script completed successfully."))
  .catch((error) => console.error("Error:", error));
