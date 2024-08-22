import axios from "axios";
import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";
import dotenv from "dotenv";
import * as userSchema from "../server/db/schemas/users/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";

dotenv.config({
  path: "../.env",
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY ?? "",
});

const index = pinecone.Index("whop");

const connection = neon(process.env.DB_URL!);

const db = drizzle(connection, {
  schema: {
    ...userSchema,
  },
});

const scrapeCompanyProfile = async (linkedinUrl: string) => {
  const options = {
    method: "GET",
    url: "https://api.scrapin.io/enrichment/company",
    params: {
      apikey: process.env.SCRAPIN_API_KEY,
      linkedInUrl: linkedinUrl,
    },
  };

  try {
    const response = await axios.request(options);
    return response.data;
  } catch (error) {
    console.error(`Error fetching company profile data: ${error}`);
    return null;
  }
};

const getEmbedding = async (text: string): Promise<number[]> => {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-large",
    input: text,
    encoding_format: "float",
  });

  return response.data[0].embedding;
};

const upsertWordsToNamespace = async (
  words: string[],
  namespace: string,
  companyId: string,
) => {
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
            id: `${companyId}--${word}`,
            values: wordEmbedding,
            metadata: {
              specialty: word,
              companyId: companyId,
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

  console.log(
    `All words upserted to namespace: ${namespace} for company ${companyId}`,
  );
};

const updateCompanyFeaturesAndSpecialties = async (companyData: any) => {
  const linkedInUrl = companyData.linkedInUrl;

  const company = await db.query.company.findFirst({
    where: eq(userSchema.company.linkedinUrl, linkedInUrl),
  });

  if (company) {
    if (
      !company.topFeatures?.includes("Design Agency") &&
      !company.specialties?.includes("Design Agency")
    ) {
      const updatedSpecialties = Array.from(
        new Set([
          ...(company.specialties ?? []),
          "Design Agency",
          "Graphic Design",
          "Design",
        ]),
      );

      const updatedTopFeatures = Array.from(
        new Set([
          ...(company.topFeatures ?? []),
          "Design Agency",
          "Graphic Design",
          "Design",
        ]),
      );

      await db
        .update(userSchema.company)
        .set({
          specialties: updatedSpecialties,
          topFeatures: updatedTopFeatures,
        })
        .where(eq(userSchema.company.id, company.id));

      console.log(
        `Updated specialties and topFeatures for company: ${company.name}`,
      );
    }

    const wordsToUpsert = [
      "design",
      "Design",
      "Graphic Design",
      "graphic design",
      "Design Agency",
      "design agency",
    ];

    await upsertWordsToNamespace(
      wordsToUpsert,
      "company-specialties",
      company.id,
    );
  } else {
    console.error(
      `Company with LinkedIn URL ${linkedInUrl} not found in the database.`,
    );
  }
};

const processCompanyProfile = async (linkedinUrl: string) => {
  const companyData = await scrapeCompanyProfile(linkedinUrl);

  if (companyData && companyData.success) {
    const { company } = companyData;

    await updateCompanyFeaturesAndSpecialties(company);
  } else {
    console.error(`Failed to process company profile for URL: ${linkedinUrl}`);
  }
};

const companies = [
  "https://www.linkedin.com/company/bulletproof/",
  "https://www.linkedin.com/company/coley-porter-bell/",
  "https://www.linkedin.com/company/stranger-&-stranger/",
  "https://www.linkedin.com/company/thecharlesgrp/",
  "https://www.linkedin.com/company/small-planet-digital/",
  "https://www.linkedin.com/company/lounge-lizard-worldwide-inc./",
  "https://www.linkedin.com/company/blenderbox/",
  "https://www.linkedin.com/company/a-b-partners/",
  "https://www.linkedin.com/company/perpetual/",
  "https://www.linkedin.com/company/weichie/",
  "https://www.linkedin.com/company/smart-design/",
  "https://www.linkedin.com/company/runyon/",
  "https://www.linkedin.com/company/hugeinc/",
  "https://www.linkedin.com/company/r-ga/",
  "https://www.linkedin.com/company/akqa/",
  "https://www.linkedin.com/company/red-antler/",
  "https://www.linkedin.com/company/area-17/",
  "https://www.linkedin.com/company/barrel/",
  "https://www.linkedin.com/company/c42d-creative-inc/",
  "https://www.linkedin.com/company/studio-rodrigo/",
  "https://www.linkedin.com/company/redpaperheart/",
  "https://www.linkedin.com/company/trollback/",
  "https://www.linkedin.com/company/kettle/",
  "https://www.linkedin.com/company/franklyn/",
  "https://www.linkedin.com/company/code-and-theory/",
  "https://www.linkedin.com/company/madeo/",
  "https://www.linkedin.com/company/orange-you-glad/",
  "https://www.linkedin.com/company/the-working-assembly/",
  "https://www.linkedin.com/company/stinkstudios/",
  "https://www.linkedin.com/company/spcshp/",
  "https://www.linkedin.com/company/trinetix-inc/",
  "https://www.linkedin.com/company/designit/",
];

async function main() {
  for (const linkedinUrl of companies) {
    await processCompanyProfile(linkedinUrl);
    await new Promise((resolve) => setTimeout(resolve, 10000));
  }
}

main().catch((error) => console.error(error));
