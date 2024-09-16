import * as dotenv from "dotenv";
import * as userSchema from "../server/db/schemas/users/schema";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import OpenAI from "openai";
import fs from "fs";
import { eq } from "drizzle-orm";

dotenv.config({ path: "../.env" });

const connection = neon(process.env.DB_URL!);
const db = drizzle(connection, {
  schema: {
    ...userSchema,
  },
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const askCondition = async (condition: string): Promise<boolean> => {
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          'You are to return a valid parseable JSON object with one attribute "condition" which can either be true or false. All questions users ask will always be able to be answered in a yes or no. An example response would be { "condition": true }',
      },
      {
        role: "user",
        content: condition,
      },
    ],
    response_format: { type: "json_object" },
    model: "gpt-4o-mini",
    temperature: 0,
    max_tokens: 256,
  });

  const result = JSON.parse(
    completion.choices[0].message.content ?? '{ "condition": false }',
  ).condition as boolean;

  return result;
};

export const isNearNYC = async (user: any): Promise<boolean> => {
  if (!user) {
    console.error("User object is null or undefined");
    return false;
  }

  if (typeof user.isNearNYC === "boolean") {
    return user.isNearNYC;
  }

  if (!user.location) {
    await updateUserNearNYCStatus(user.id, false);
    return false;
  }

  const condition = `Is this location (${user.location}) within 50 miles of Brooklyn, New York City? If it is ambiguous like if it says USA return false.`;
  const result = await askCondition(condition);

  await updateUserNearNYCStatus(user.id, result);
  return result;
};

const updateUserNearNYCStatus = async (userId: string, isNearNYC: boolean) => {
  await db
    .update(userSchema.githubUsers)
    .set({ isNearNYC })
    .where(eq(userSchema.githubUsers.id, userId));
};

// Function to calculate language score based on stars and repos for JS, TS, and Ruby
const calculateLanguageScore = (languages: any): number => {
  let score = 0;

  const languageWeights: any = {
    JavaScript: { repoWeight: 3, starWeight: 5 },
    TypeScript: { repoWeight: 4, starWeight: 5 },
    Ruby: { repoWeight: 5, starWeight: 5 },
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
  nearNYC: boolean,
): { total: number; breakdown: any } => {
  // Higher precedence for followers by giving it a higher weight
  const followerWeight = 40;
  const repoWeight = 10;
  const starWeight = 20;

  // Follower to following ratio
  const followRatio = user.followers / (user.following || 1);

  // Experience is based on the number of contribution years
  const experienceWeight = user.contributionYears?.length || 0;

  // Contributions based on total commits
  const contributionsWeight = user.totalCommits + user.restrictedContributions;

  // Language score based on languages, repo counts, and stars
  const languageScore = calculateLanguageScore(user.languages || {});

  // Breakdown of the score components
  const breakdown = {
    followRatio: followRatio * 10,
    followers: user.followers * followerWeight,
    experience: experienceWeight * 100,
    contributions: contributionsWeight * 10,
    totalRepos: user.totalRepositories * repoWeight,
    totalStars: user.totalStars * starWeight,
    totalForks: user.totalForks * 30,
    languageScore: languageScore,
    locationBonus: nearNYC ? 10000000 : 0, // Large bonus if near NYC
  };

  // Calculate the total score by summing up all the values in the breakdown
  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);

  return { total, breakdown };
};

const writeResultsToFile = (users: any[]) => {
  // Sort users by score in descending order
  const sortedUsers = users.sort((a, b) => b.score.total - a.score.total);

  const nycUsers = sortedUsers.filter((user) => user.nearNYC);
  const nonNycUsers = sortedUsers.filter((user) => !user.nearNYC);

  const resultLines: string[] = [];

  const writeUsername = (user: any, isNYC: boolean) => {
    const nycSuffix = isNYC ? " -- lives in New York" : "";
    resultLines.push(`https://github.com/${user.login}${nycSuffix}`);
  };

  // Add NYC users
  nycUsers.forEach((user) => writeUsername(user, true));

  // Add non-NYC users
  nonNycUsers.forEach((user) => writeUsername(user, false));

  // Write to file
  fs.writeFileSync("scored_users.txt", resultLines.join("\n"), "utf-8");
};

const main = async () => {
  try {
    console.log("Querying users from the database...");
    // Query users from the database
    const users = await db.query.githubUsers.findMany();
    console.log(`Retrieved ${users.length} users from the database.`);

    // Function to batch isNearNYC requests
    const batchIsNearNYC = async (batch: any[]) => {
      console.log(`Processing batch of ${batch.length} users for isNearNYC...`);
      return await Promise.all(
        batch.map(async (user) => {
          const nearNYC = await isNearNYC(user);
          return { ...user, nearNYC };
        }),
      );
    };

    const batchSize = 100;
    let processedUsers: any[] = [];

    // Process users in batches of 50
    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);
      const processedBatch = await batchIsNearNYC(batch);
      processedUsers = [...processedUsers, ...processedBatch];
      console.log(`Processed ${processedUsers.length} users so far...`);
    }

    // Calculate scores for all processed users and sort them
    const scoredUsers = processedUsers
      .map((user) => {
        const userScore = calculateUserScore(user, user.nearNYC);
        return { ...user, score: userScore };
      })
      .sort((a, b) => b.score.total - a.score.total);

    // Write the results to a file
    console.log("Writing results to file...");
    writeResultsToFile(scoredUsers);

    console.log(
      "Processing complete. Users written to 'scored_users.txt' sorted by score.",
    );

    console.log("Processing complete. Scores written to 'scored_users.txt'.");
  } catch (error) {
    console.error("An error occurred:", error);
  }
};

main().catch((error) => console.error("Error in main function:", error));
