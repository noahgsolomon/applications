import * as dotenv from "dotenv";
import * as userSchema from "../server/db/schemas/users/schema";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import fs from "fs";

dotenv.config({ path: "../.env" });

const pool = new Pool({ connectionString: process.env.DB_URL });
export const db = drizzle(pool, {
  schema: userSchema,
});

// Function to calculate language score based on stars and repos for JS, TS, and Ruby
const calculateLanguageScore = (languages: any): number => {
  let score = 0;

  const languageWeights: any = {
    TypeScript: { repoWeight: 1, starWeight: 2 },
    Swift: { repoWeight: 1, starWeight: 4 },
    Ruby: { repoWeight: 20, starWeight: 60 },
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
  // Logarithmic scaling function
  const logScale = (value: number, base: number = 10) =>
    Math.log(value + 1) / Math.log(base);

  // Adjust weights
  const followerWeight = 0.5;
  const followRatioWeight = 0.25;
  const experienceWeight = 0.2;
  const contributionsWeight = 0.5;
  const repoWeight = 0.25;
  const starWeight = 0.5;
  const forkWeight = 0.25;
  const languageWeight = 1;
  const locationBonus = 2;

  // Calculate individual scores
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

  // Calculate language score with emphasis on Ruby and TypeScript
  const languageScore = calculateLanguageScore(user.languages || {});
  const scaledLanguageScore = logScale(languageScore) * languageWeight;

  // Check for Ruby and TypeScript experience
  const hasRuby = user.languages && user.languages.Ruby;
  const hasTypeScript = user.languages && user.languages.TypeScript;

  // Calculate location score
  const locationScore = isInNewYork ? locationBonus : 0;

  // Calculate synergy bonus
  let synergyBonus = 0;
  if (isInNewYork && hasRuby) {
    synergyBonus += 2; // Bonus for Ruby + NYC
  }
  if (isInNewYork && hasRuby && hasTypeScript) {
    synergyBonus += 3; // Additional bonus for Ruby + TypeScript + NYC
  }

  // Breakdown of the score components
  const breakdown = {
    followers: followerScore,
    followRatio: followRatioScore,
    experience: experienceScore,
    contributions: contributionsScore,
    totalRepos: repoScore,
    totalStars: starScore,
    totalForks: forkScore,
    languageScore: scaledLanguageScore,
    locationBonus: locationScore,
    synergyBonus: synergyBonus,
  };

  // Calculate the total score
  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);

  // Normalize the total score to a 0-10 range
  const normalizedTotal = total;

  // Normalize each component in the breakdown
  const normalizedBreakdown = Object.fromEntries(
    Object.entries(breakdown).map(([key, value]) => [key, Math.min(5, value)]),
  );

  return {
    total: normalizedTotal,
    breakdown: normalizedBreakdown,
  };
};

const writeResultsToFile = (users: any[]) => {
  // Sort users by score in descending order
  const sortedUsers = users.sort((a, b) => b.score.total - a.score.total);

  const nycUsers = sortedUsers.filter((user) => user.isInNewYork);
  const nonNycUsers = sortedUsers.filter((user) => !user.isInNewYork);

  const resultLines: string[] = [];

  const writeUserDetails = (user: any) => {
    resultLines.push(`https://github.com/${user.login}`);
    resultLines.push(`Total Score: ${user.score.total.toFixed(2)}`);
    resultLines.push("Score Breakdown:");
    for (const [key, value] of Object.entries(user.score.breakdown)) {
      resultLines.push(`  ${key}: ${(value as number).toFixed(2)}`);
    }
    resultLines.push("");
  };

  // Add NYC users
  resultLines.push("Users in New York:");
  nycUsers.forEach((user) => writeUserDetails(user));

  // Add non-NYC users
  resultLines.push("Users not in New York:");
  nonNycUsers.forEach((user) => writeUserDetails(user));

  // Write to file
  fs.writeFileSync("scored_users.txt", resultLines.join("\n"), "utf-8");
};

const main = async (usernames?: string[]) => {
  try {
    console.log("Querying users...");
    let users;
    if (usernames && usernames.length > 0) {
      // Query only the specified users from the database
      users = await db.query.githubUsers.findMany({
        where: (githubUsers, { inArray }) =>
          inArray(githubUsers.login, usernames),
      });
      console.log(
        `Retrieved ${users.length} specified users from the database.`,
      );
    } else {
      // Query all users from the database
      users = await db.query.githubUsers.findMany();
      console.log(`Retrieved ${users.length} users from the database.`);
    }

    // Process users and check if they are in New York
    const processedUsers = users.map((user) => ({
      ...user,
      isInNewYork: user.normalizedLocation === "NEW YORK",
    }));

    // Calculate scores for all processed users and sort them
    const scoredUsers = processedUsers
      .map((user) => {
        const userScore = calculateUserScore(user, user.isInNewYork);
        return { ...user, score: userScore };
      })
      .sort((a, b) => b.score.total - a.score.total);

    // Write the results to a file
    console.log("Writing results to file...");
    writeResultsToFile(scoredUsers);

    console.log(
      "Processing complete. Users written to 'scored_users.txt' sorted by score.",
    );
  } catch (error) {
    console.error("An error occurred:", error);
  }
};

main().catch((error) => console.error("Error in main function:", error));
