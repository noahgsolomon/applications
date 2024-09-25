import * as dotenv from "dotenv";
import * as userSchema from "../server/db/schemas/users/schema";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";
import { and, eq, inArray, isNotNull } from "drizzle-orm";

dotenv.config({ path: "../.env" });

const pool = new Pool({ connectionString: process.env.DB_URL });
export const db = drizzle(pool, {
  schema: userSchema,
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});

const index = pinecone.Index("whop");

const calculateLanguageScore = (languages: any): number => {
  let score = 0;

  const languageWeights: any = {
    TypeScript: { repoWeight: 1, starWeight: 0.01 },
    Swift: { repoWeight: 1, starWeight: 0.02 },
    Ruby: { repoWeight: 1, starWeight: 1 },
  };

  Object.keys(languages).forEach((language) => {
    if (languageWeights[language]) {
      const { repoCount, stars } = languages[language];
      const { repoWeight, starWeight } = languageWeights[language];

      score += repoCount * repoWeight + stars * starWeight;
    }
  });

  return score;
};

const calculateUserScore = (
  user: any,
  isInNewYork: boolean,
): { total: number; breakdown: any } => {
  const logScale = (value: number, base: number = 10) =>
    Math.log(value + 1) / Math.log(base);

  // GitHub weights
  const followerWeight = 0.5;
  const followRatioWeight = 0.25;
  const experienceWeight = 0.1;
  const contributionsWeight = 0.5;
  const repoWeight = 0.25;
  const starWeight = 0.5;
  const forkWeight = 0.25;
  const languageWeight = 5;
  const locationBonus = 3;

  // Twitter weights
  const twitterFollowerWeight = 0.05;
  const twitterFollowRatioWeight = 0.05;
  const twitterAvgLikesWeight = 0.05;

  // GitHub scores
  const followerScore = logScale(user.followers) * followerWeight;
  const followRatio = user.followers / (user.following || 1);
  const followRatioScore = logScale(followRatio) * followRatioWeight;
  const experienceScore =
    Math.min(user.contributionYears?.length || 0, 10) * experienceWeight;
  const contributionsScore =
    logScale(user.totalCommits + user.restrictedContributions) *
    contributionsWeight;
  const repoScore = logScale(user.totalRepositories) * repoWeight;
  const starScore = logScale(user.totalStars) * starWeight;
  const forkScore = logScale(user.totalForks) * forkWeight;

  const languageScore = calculateLanguageScore(user.languages || {});
  const scaledLanguageScore = logScale(languageScore) * languageWeight;

  const hasRuby = user.languages && user.languages.Ruby;
  const hasTypeScript = user.languages && user.languages.TypeScript;

  const locationScore = isInNewYork ? locationBonus : 0;

  let synergyBonus = 0;
  if (isInNewYork && hasRuby) {
    synergyBonus += 2;
  }
  if (isInNewYork && hasRuby && hasTypeScript) {
    synergyBonus += 3;
  }

  // Twitter scores
  const twitterFollowerScore =
    logScale(user.twitterFollowerCount || 0) * twitterFollowerWeight;
  const twitterFollowRatio =
    (user.twitterFollowerCount || 0) / (user.twitterFollowingCount || 1);
  const twitterFollowRatioScore =
    logScale(twitterFollowRatio) * twitterFollowRatioWeight;

  let avgLikes = 0;
  if (user.tweets && Array.isArray(user.tweets)) {
    const totalLikes = user.tweets.reduce(
      (sum: number, tweet: any) => sum + (tweet.favorite_count || 0),
      0,
    );
    avgLikes = user.tweets.length > 0 ? totalLikes / user.tweets.length : 0;
  }
  const twitterAvgLikesScore = logScale(avgLikes) * twitterAvgLikesWeight;

  const breakdown = {
    githubFollowers: followerScore,
    githubFollowRatio: followRatioScore,
    experience: experienceScore,
    contributions: contributionsScore,
    totalRepos: repoScore,
    totalStars: starScore,
    totalForks: forkScore,
    languageScore: scaledLanguageScore,
    locationBonus: locationScore,
    synergyBonus: synergyBonus,
    twitterFollowers: twitterFollowerScore,
    twitterFollowRatio: twitterFollowRatioScore,
    twitterAvgLikes: twitterAvgLikesScore,
  };

  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);

  const normalizedBreakdown = Object.fromEntries(
    Object.entries(breakdown).map(([key, value]) => [key, Math.min(5, value)]),
  );

  return {
    total,
    breakdown: normalizedBreakdown,
  };
};

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

async function searchAndScoreCandidates() {
  try {
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

    const qualificationsEmbedding = await getEmbedding(qualificationsText);

    const queryResponse = await index.namespace("x-bio").query({
      topK: 1000,
      vector: qualificationsEmbedding,
      includeMetadata: true,
      includeValues: false,
    });

    const matches = queryResponse.matches ?? [];

    const userIdToSimilarity: Record<string, number> = {};
    for (const match of matches) {
      const userId = match.metadata?.userId;
      const similarity = match.score ?? 0;
      if (userId) {
        userIdToSimilarity[userId as string] = similarity;
      }
    }

    const userIds = Object.keys(userIdToSimilarity);

    const users = await db
      .select()
      .from(userSchema.githubUsers)
      .where(
        and(
          isNotNull(userSchema.githubUsers.twitterBio),
          eq(userSchema.githubUsers.isUpsertedInAllBios, true),
        ),
      );

    console.log(`Found ${users.length} users matching the query.`);

    const scoredUsers = users
      .map((user) => {
        const isInNewYork = user.normalizedLocation === "NEW YORK";
        const userScore = calculateUserScore(user, isInNewYork);
        const similarityScore = userIdToSimilarity[user.id] ?? 0;

        return {
          ...user,
          score: {
            ...userScore,
            similarityScore: similarityScore * 5,
            total: userScore.total + similarityScore * 5,
          },
        };
      })
      .sort((a, b) => b.score.total - a.score.total);

    const resultLines: string[] = [];
    scoredUsers.slice(0, 100).forEach((user) => {
      resultLines.push(`https://github.com/${user.login}`);
      resultLines.push(`Total Score: ${user.score.total.toFixed(2)}`);
      resultLines.push("Score Breakdown:");
      for (const [key, value] of Object.entries(user.score.breakdown)) {
        resultLines.push(`  ${key}: ${(value as number).toFixed(2)}`);
      }
      resultLines.push(
        `  similarityScore: ${user.score.similarityScore.toFixed(2)}`,
      );
      resultLines.push(`Twitter: https://twitter.com/${user.twitterUsername}`);
      resultLines.push(`Twitter Followers: ${user.twitterFollowerCount}`);
      resultLines.push(`Twitter Following: ${user.twitterFollowingCount}`);
      resultLines.push(`Twitter Bio: ${user.twitterBio}`);
      resultLines.push("");
    });

    console.log(resultLines.join("\n"));
  } catch (error) {
    console.error("Error in searchAndScoreCandidates:", error);
  }
}

searchAndScoreCandidates().catch((error) =>
  console.error("Error in main function:", error),
);
