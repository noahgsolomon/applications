import dotenv from "dotenv";
dotenv.config({ path: "../.env" });

import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";
import * as schema from "@/server/db/schemas/users/schema";
import { inArray } from "drizzle-orm";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

const pool = new Pool({ connectionString: process.env.DB_URL });
export const db = drizzle(pool, {
  schema,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});

const index = pinecone.Index("whop");

async function getEmbedding(text: string): Promise<number[]> {
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

async function searchCandidates() {
  try {
    // Qualifications text
    const qualificationsText = `
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

    // Get embedding for the qualifications text
    const qualificationsEmbedding = await getEmbedding(qualificationsText);

    // Query Pinecone's x-bio namespace for the top 100 most similar bios
    const queryResponse = await index.namespace("x-bio").query({
      topK: 100,
      vector: qualificationsEmbedding,
      includeMetadata: true,
      includeValues: false,
    });

    const matches = queryResponse.matches ?? [];

    // Extract user IDs and similarity scores from the matches
    const userIdToSimilarity: Record<string, number> = {};
    for (const match of matches) {
      const userId = match.metadata?.userId;
      const similarity = match.score ?? 0;
      if (userId) {
        userIdToSimilarity[userId as string] = similarity;
      }
    }

    const userIds = Object.keys(userIdToSimilarity);

    // Fetch user data from the database for the matched user IDs
    const users = await db
      .select()
      .from(schema.githubUsers)
      .where(inArray(schema.githubUsers.id, userIds));

    console.log(`Found ${users.length} users matching the query.`);

    const results: {
      userId: string;
      username: string;
      score: number;
      normalizedLocation: string | null;
      twitterFollowerCount: number | null;
      twitterFollowingCount: number | null;
      twitterFollowerToFollowingRatio: number | null;
      twitterBio: string;
    }[] = [];

    for (const user of users) {
      const twitterBio = user.twitterBio!;
      const username = user.twitterUsername ?? "unknown";
      const userId = user.id;
      const normalizedLocation = user.normalizedLocation;

      // Initialize score
      let score = 0;

      // Check if the user is in New York using normalizedLocation
      const isInNewYork = normalizedLocation === "NEW YORK";
      if (isInNewYork) {
        score += 1; // Increase score if in New York
      }

      // Get similarity score from Pinecone query
      const similarity = userIdToSimilarity[userId] ?? 0;

      // Add similarity score (weighted)
      score += similarity * 5; // Adjust the weight as needed

      // Factor in Twitter follower count and ratio
      const followerCount = user.twitterFollowerCount ?? 0;
      const followerRatio = user.twitterFollowerToFollowingRatio ?? 0;

      // Normalize follower count (e.g., logarithmic scale)
      const normalizedFollowerCount = Math.log10(followerCount + 1); // Logarithmic scale
      score += normalizedFollowerCount * 0.5; // Adjust the weight as needed

      // Factor in follower ratio
      const normalizedFollowerRatio = Math.min(followerRatio / 10, 1); // Cap at 1
      score += normalizedFollowerRatio * 0.5; // Adjust the weight as needed

      // Collect the result
      results.push({
        userId,
        username,
        score,
        normalizedLocation,
        twitterFollowerCount: followerCount,
        twitterFollowingCount: user.twitterFollowingCount ?? 0,
        twitterFollowerToFollowingRatio: followerRatio,
        twitterBio,
      });
    }

    // Sort the results by score in descending order
    results.sort((a, b) => b.score - a.score);

    // Output the top results
    console.log("Top candidates:");
    for (const result of results.slice(0, 50)) {
      console.log(
        `https://x.com/${result.username}, Score: ${result.score.toFixed(
          2,
        )}, Location: ${result.normalizedLocation ?? "Unknown"}, Followers: ${
          result.twitterFollowerCount
        }`,
      );
    }

    // Optionally, save the results to a file
    // import fs from 'fs';
    // fs.writeFileSync('top_candidates.json', JSON.stringify(results, null, 2));
  } catch (error) {
    console.error("Error in searchCandidates:", error);
  }
}

searchCandidates();
