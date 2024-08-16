import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";
import dotenv from "dotenv";

dotenv.config({ path: "../../.env" });

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
      topK: 20,
      vector: skillEmbedding,
      includeMetadata: true,
    });

    console.log("Top 10 similar technologies:");
    queryResponse.matches.forEach((match, index) => {
      console.log(
        `${index + 1}: ${match.metadata?.technology} (Score: ${match.score})`,
      );
    });
  } catch (error) {
    console.error("Error querying similar technologies:", error);
  }
}

querySimilarTechnologies("Rust");

export { querySimilarTechnologies };
