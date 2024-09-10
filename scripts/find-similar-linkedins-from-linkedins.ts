import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { inArray } from "drizzle-orm";
import OpenAI from "openai";
import * as userSchema from "../server/db/schemas/users/schema";
import dotenv from "dotenv";

dotenv.config({ path: "../.env" });

const connection = neon(process.env.DB_URL!);
const db = drizzle(connection, { schema: userSchema });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function getEmbedding(text: string) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-large",
    input: text,
    encoding_format: "float",
  });
  return response.data[0].embedding;
}

async function multiUserSkillEmbedding(linkedinUrls: string[]) {
  // Normalize LinkedIn URLs by trimming trailing slashes
  const normalizedUrls = linkedinUrls.map((url) => url.replace(/\/$/, ""));

  // Fetch candidates from the database
  const candidates = await db
    .select()
    .from(userSchema.candidates)
    .where(inArray(userSchema.candidates.url, normalizedUrls));

  if (candidates.length === 0) {
    console.log("No matching candidates found.");
    return null;
  }

  // Extract all unique skills from the candidates
  const allSkills = Array.from(
    new Set(
      candidates.flatMap((candidate) => candidate.linkedinData.skills || []),
    ),
  );

  // Compute embeddings for each skill
  const skillEmbeddings = await Promise.all(allSkills.map(getEmbedding));

  // Calculate the average embedding
  const averageEmbedding = skillEmbeddings.reduce(
    (acc, embedding) =>
      acc.map((val, i) => val + embedding[i] / skillEmbeddings.length),
    new Array(skillEmbeddings[0].length).fill(0),
  );

  return {
    averageEmbedding,
    candidateCount: candidates.length,
    totalSkillCount: allSkills.length,
  };
}

// Example usage
const linkedinUrls = [
  "https://www.linkedin.com/in/ashleytrap",
  "https://www.linkedin.com/in/aditi-mulye-a93038138",
];

multiUserSkillEmbedding(linkedinUrls)
  .then((result) => console.log(result))
  .catch((error) => console.error("Error:", error));
