import { OpenAI } from "openai";
import dotenv from "dotenv";

// Load environment variables
dotenv.config({ path: "../.env" });

// Initialize OpenAI with API key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// Utility function to add generic context to the input text
function enrichText(text: string): string {
  // Add generic context about company relationships
  const genericContext = "";
  return genericContext + text;
}

// Utility function to calculate cosine similarity
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  const dotProduct = vecA.reduce((sum, a, idx) => sum + a * vecB[idx], 0);
  const magnitudeA = Math.sqrt(vecA.reduce((sum, a) => sum + a * a, 0));
  const magnitudeB = Math.sqrt(vecB.reduce((sum, b) => sum + b * b, 0));
  return magnitudeA && magnitudeB ? dotProduct / (magnitudeA * magnitudeB) : 0;
}

// Example function to compare two embeddings with generic context
async function compareText(textA: string, textB: string) {
  const enrichedTextA = enrichText(textA);
  const enrichedTextB = enrichText(textB);

  const embeddingA = await getEmbedding(enrichedTextA);
  const embeddingB = await getEmbedding(enrichedTextB);

  const similarity = cosineSimilarity(embeddingA, embeddingB);
  console.log(`Cosine Similarity: ${similarity}`);
  return similarity;
}

// Fetch the embedding from OpenAI
async function getEmbedding(text: string) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });

  return response.data[0].embedding;
}

// Compare example texts
compareText("Nextjs", "Ruby on Rails")
  .then(() => {
    console.log("Comparison completed.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Error during comparison:", error);
    process.exit(1);
  });
