import OpenAI from "openai";
import dotenv from "dotenv";
import * as userSchema from "../../server/db/schemas/users/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
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

    const specialtyPromises = (company.specialties ?? []).map(
      async (specialty) => {
        if (/^[\x00-\x7F]+$/.test(specialty)) {
          // Check if the specialty is valid ASCII
          console.log(`Generating embedding for specialty: "${specialty}"`);
          const specialtyEmbedding = await getEmbedding(specialty);

          console.log(
            `Upserting specialty: "${specialty}" for company ID: ${company.id}`,
          );
          await index.namespace("company-specialties").upsert([
            {
              id: `${company.id}--${specialty}`,
              values: specialtyEmbedding,
              metadata: {
                specialty: specialty,
                companyId: company.id,
              },
            },
          ]);
          console.log(
            `Successfully upserted specialty: "${specialty}" for company ID: ${company.id}`,
          );
        } else {
          console.log(
            `Skipping non-ASCII specialty: "${specialty}" for company ID: ${company.id}`,
          );
        }
      },
    );

    // Wait for all specialty upsertions for the current company to complete
    await Promise.all(specialtyPromises);

    console.log(
      `Finished processing company: ${company.name} (ID: ${company.id})`,
    );
  }

  console.log("All companies processed.");
};

main();
