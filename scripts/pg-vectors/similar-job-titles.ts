import { desc, inArray } from "drizzle-orm";
import { jobTitles, people } from "../../server/db/schemas/users/schema";
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import OpenAI from "openai";
import * as schema from "../../server/db/schemas/users/schema";
import dotenv from "dotenv";

dotenv.config({ path: "../../.env" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: text,
  });

  return response.data[0].embedding;
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  const dotProduct = vecA.reduce((sum, a, idx) => sum + a * vecB[idx], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return magnitudeA && magnitudeB ? dotProduct / (magnitudeA * magnitudeB) : 0;
}

const pool = new Pool({ connectionString: process.env.DB_URL });
const db = drizzle(pool, { schema });

export const findUsersByJobTitle = async (inputJobTitle: string) => {
  console.log(`[1] Starting search for job title: ${inputJobTitle}`);
  const embedding = await getEmbedding(inputJobTitle);
  console.log(`[2] Embedding generated`);

  const similarJobTitles = await db
    .select({
      personId: jobTitles.personId,
      vector: jobTitles.vector,
      title: jobTitles.title,
    })
    .from(jobTitles);

  console.log(`[3] Found ${similarJobTitles.length} job titles`);

  const similarities: { personId: string; similarity: number }[] =
    similarJobTitles.map((jt) => ({
      personId: jt.personId,
      similarity: cosineSimilarity(embedding, jt.vector),
    }));

  const filteredSimilarities = similarities.filter((s) => s.similarity > 0.5);
  filteredSimilarities.sort((a, b) => b.similarity - a.similarity);
  const topSimilarities = filteredSimilarities.slice(0, 100);

  console.log(
    `[3.5] Found ${topSimilarities.length} similar job titles after filtering`,
  );

  const personIds = topSimilarities.map((s) => s.personId);
  const users = await db.query.people.findMany({
    columns: { id: true, jobTitles: true },
    where: inArray(people.id, personIds),
  });
  console.log(`[4] Retrieved ${users.length} users`);

  const result = users.map((user) => ({
    id: user.id,
    jobTitles: user.jobTitles,
    similarity:
      topSimilarities.find((s) => s.personId === user.id)?.similarity || 0,
  }));
  console.log(`[5] Processed user data`);

  // Sort the result array by similarity in descending order
  result.sort((a, b) => b.similarity - a.similarity);

  console.log(`[6] Sorted result by similarity`);

  return result;
};

findUsersByJobTitle("Senior Machine Learning Engineer").then(console.log);
