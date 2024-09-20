import dotenv from "dotenv";
dotenv.config({ path: "../.env" });

import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});

const index = pinecone.Index("whop");

// List of usernames to exclude from the results
const excludedUsernames = [
  "falcoagustin",
  "nanzhong",
  "hichaelmart",
  "connordav_is",
  "Raynos",
  "astuyve",
  "brandur",
  "isukkaw",
  "kuvos",
  "penberg",
  "feedthejim",
];

async function getEmbedding(text) {
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: text,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error("Error generating embedding:", error);
    throw error;
  }
}

async function querySimilarBios(queryText) {
  try {
    console.log(`Generating embedding for query: "${queryText}"`);
    const queryEmbedding = await getEmbedding(queryText);

    const queryResponse = await index.namespace("x-bio").query({
      topK: 200, // Increase topK to account for filtering
      vector: queryEmbedding,
      includeMetadata: true,
      includeValues: false,
    });

    // Filter out matches with usernames in the excluded list
    const similarBios = queryResponse.matches
      ?.filter(
        (match) =>
          match.metadata?.username &&
          !excludedUsernames.includes(match.metadata.username),
      )
      .slice(0, 100) // Limit to top 100 after filtering
      .map((match) => ({
        username: match.metadata?.username,
        bio: match.metadata?.text,
        score: match.score ?? 0,
      }));

    console.log(`Top ${similarBios?.length} similar bios:`);
    console.log(JSON.stringify(similarBios, null, 2));

    return similarBios;
  } catch (error) {
    console.error("Error querying similar bios:", error);
  }
}

// Infrastructure-related terms
const infrastructureRelatedWords = `
Qualifications
Strong understanding of AWS services, including Aurora/RDS, OpenSearch, ECS, and S3
Experience with CI/CD tools, particularly GitHub Actions and self-hosted runners
Excellent documentation and communication skills
Strong networking knowledge, including VPCs, DNS, and Cloudflare
Expertise in security measures, including rate limits and WAF rules
Ability to manage and optimize infrastructure for performance and scalability
Proactive approach to monitoring and maintaining infrastructure health
Experience with disaster recovery planning and execution
Familiarity with distributed tracing, logging, and observability tools (NewRelic)
Deep knowledge of HTTP and networking concepts, including load balancers or web sockets
Experience scaling Ruby on Rails applications
Nice to haves
Experience with Next.js / Vercel
Experience with Terraform
Proficiency in Infrastructure as Code (IAC) with Pulumi and TypeScript
`;

// Combine the terms into a single string for the query
const queryText = infrastructureRelatedWords;

// Execute the query
querySimilarBios(queryText);
