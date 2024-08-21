import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";
import dotenv from "dotenv";

dotenv.config({ path: "../.env" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY || "",
});

const index = pinecone.Index("whop");

async function getEmbedding(text) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-large",
    input: text,
    encoding_format: "float",
  });

  return response.data[0].embedding;
}

async function querySimilarTechnologies(skill) {
  try {
    console.log(`Getting embedding for skill: ${skill}`);
    const skillEmbedding = await getEmbedding(skill);

    const queryResponse = await index.namespace("technologies").query({
      topK: 200,
      vector: skillEmbedding,
      includeMetadata: true,
      includeValues: false,
    });

    const similarTechnologies = queryResponse.matches
      .filter((match) => (match.score ?? 0) > 0.7)
      .map((match) => ({
        technology: match.metadata?.technology,
        score: match.score ?? 0,
      }));
    console.log(JSON.stringify(similarTechnologies, null, 2));
    return similarTechnologies;
  } catch (error) {
    console.error("Error querying similar technologies:", error);
  }
}

querySimilarTechnologies("Next.js");

export { querySimilarTechnologies };
