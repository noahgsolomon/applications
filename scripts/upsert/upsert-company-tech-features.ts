import OpenAI from "openai";
import dotenv from "dotenv";
import * as userSchema from "../../server/db/schemas/users/schema";
import { company as companyTable } from "../../server/db/schemas/users/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import { Pinecone } from "@pinecone-database/pinecone";

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

const main = async () => {
  console.log("Fetching companies from the database...");
  const companies = await db.query.company.findMany();

  console.log(
    `Fetched ${companies.length} companies. Starting to process each company...`,
  );

  for (const company of companies) {
    console.log(`Processing company: ${company.name} (ID: ${company.id})`);

    const featurePromises = (company.topFeatures ?? []).map(async (feature) => {
      if (/^[\x00-\x7F]+$/.test(feature)) {
        // Check if the feature is valid ASCII
        console.log(`Generating embedding for feature: "${feature}"`);
        const featureEmbedding = await getEmbedding(feature);

        console.log(
          `Upserting feature: "${feature}" for company ID: ${company.id}`,
        );
        await index.namespace("company-features").upsert([
          {
            id: `${company.id}--${feature}`,
            values: featureEmbedding,
            metadata: {
              feature: feature,
              companyId: company.id,
            },
          },
        ]);
        console.log(
          `Successfully upserted feature: "${feature}" for company ID: ${company.id}`,
        );
      } else {
        console.log(
          `Skipping non-ASCII feature: "${feature}" for company ID: ${company.id}`,
        );
      }
    });

    // Wait for all feature upsertions for the current company to complete
    await Promise.all(featurePromises);

    console.log(
      `Finished processing company: ${company.name} (ID: ${company.id})`,
    );
  }

  console.log("All companies processed.");
};

main();
