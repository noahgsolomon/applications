import dotenv from "dotenv";
dotenv.config({ path: "../.env" });

import { Pinecone } from "@pinecone-database/pinecone";

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const index = pinecone.Index("whop");

async function queryAllEmbeddingsFromNamespace(namespace) {
  try {
    // Create a zero vector of length 3072
    const zeroVector = new Array(3072).fill(0);

    // Query the namespace with a large topK to retrieve embeddings
    const queryResponse = await index.namespace(namespace).query({
      vector: zeroVector,
      topK: 100, // Adjust topK as needed
      includeMetadata: true,
      includeValues: true,
    });

    const matches = queryResponse.matches ?? [];

    console.log(
      `Retrieved ${matches.length} embeddings from namespace ${namespace}.`,
    );

    // Extract embeddings from matches
    const embeddings = matches.map((match) => match.values ?? []);

    return embeddings;
  } catch (error) {
    console.error(
      `Error querying embeddings from namespace ${namespace}:`,
      error,
    );
    throw error;
  }
}

function averageEmbeddings(embeddings) {
  if (embeddings.length === 0) {
    throw new Error("No embeddings to average.");
  }

  const embeddingLength = embeddings[0].length;
  const avgEmbedding = new Array(embeddingLength).fill(0);

  for (const embedding of embeddings) {
    for (let i = 0; i < embeddingLength; i++) {
      avgEmbedding[i] += embedding[i];
    }
  }

  for (let i = 0; i < embeddingLength; i++) {
    avgEmbedding[i] /= embeddings.length;
  }

  return avgEmbedding;
}

async function queryWithAveragedEmbedding(avgEmbedding) {
  try {
    // Query the x-bio namespace using the averaged embedding
    const queryResponse = await index.namespace("x-bio").query({
      vector: avgEmbedding,
      topK: 100,
      includeMetadata: true,
      includeValues: false,
    });

    const matches = queryResponse.matches ?? [];

    console.log(`Found ${matches.length} top matches in x-bio namespace.`);

    const results = matches.map((match) => ({
      id: match.id,
      score: match.score ?? 0,
      metadata: match.metadata ?? {},
    }));

    // Output the results
    console.log("Top matches:");
    for (const result of results) {
      console.log(
        `https://x.com/${result.metadata.username}, Score: ${result.score.toFixed(
          4,
        )}`,
      );
    }

    // Optionally, you can return the results
    return results;
  } catch (error) {
    console.error("Error querying x-bio namespace:", error);
  }
}

async function main() {
  try {
    // Step 1: Query embeddings from x-bio-staff-swe-infra namespace using zero vector
    const embeddings = await queryAllEmbeddingsFromNamespace(
      "x-bio-staff-swe-infra",
    );

    // Step 2: Average the embeddings
    const avgEmbedding = averageEmbeddings(embeddings);

    console.log("Computed the averaged embedding.");

    // Step 3: Query x-bio namespace using the averaged embedding
    await queryWithAveragedEmbedding(avgEmbedding);
  } catch (error) {
    console.error("Error in main:", error);
  }
}

main();
