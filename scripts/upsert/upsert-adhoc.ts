import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";
import dotenv from "dotenv";

dotenv.config({ path: "../../.env" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
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

async function upsertWordsToNamespace(words: string[], namespace: string) {
  const batchSize = 50;
  let i = 0;

  for (let j = 0; j < words.length; j += batchSize) {
    const batch = words.slice(j, j + batchSize);
    const promises = batch.map(async (word) => {
      if (/^[\x00-\x7F]*$/.test(word)) {
        console.log("getting embedding for: " + word);
        const wordEmbedding = await getEmbedding(word);

        await index.namespace(namespace).upsert([
          {
            id: word,
            values: wordEmbedding,
            metadata: {
              feature: word,
            },
          },
        ]);
        console.log("upserted: " + word);
      } else {
        console.log(`Skipping non-ASCII word: ${word}`);
      }
    });

    await Promise.all(promises);
    i += batchSize;
    console.log(`Processed ${i} words, ${(i / words.length) * 100}% done`);
  }

  console.log("All words upserted to namespace: " + namespace);
}

async function main() {
  const words = [
    "design",
    "Design",
    "Graphic Design",
    "graphic design",
    "Design Agency",
    "design agency",
  ];

  const namespace = "company-features";

  await upsertWordsToNamespace(words, namespace);
}

main().catch((error) => console.error(error));
