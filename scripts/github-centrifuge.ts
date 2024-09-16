import { drizzle } from "drizzle-orm/neon-serverless";
import { neon, Pool } from "@neondatabase/serverless";
import * as schema from "../server/db/schemas/users/schema";
import dotenv from "dotenv";
import { InferSelectModel } from "drizzle-orm";
import { graphql } from "@octokit/graphql";
import { eq } from "drizzle-orm";
import { isNearNYC, RateLimiter } from "@/github/graphql";
import { getNormalizedLocation } from "./normalized-location-github";

dotenv.config({ path: "../.env" });

const pool = new Pool({ connectionString: process.env.DB_URL! });
const db = drizzle(pool, { schema });

type GitHubUser = InferSelectModel<typeof schema.githubUsers>;

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  throw new Error("GitHub token is required in .env file");
}

const rateLimiter = new RateLimiter();

function calculateMean(numbers: number[]): number {
  return numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
}

function calculateVariance(numbers: number[], mean: number): number {
  return (
    numbers.reduce((sum, num) => sum + Math.pow(num - mean, 2), 0) /
    numbers.length
  );
}

export async function fetchUserFromGitHub(
  username: string,
): Promise<GitHubUser | null> {
  const query = `
    query($login: String!) {
      user(login: $login) {
        login
        name
        location
        websiteUrl
        twitterUsername
        email
        bio
        followers {
          totalCount
        }
        following(first: 100) {
          totalCount
          nodes {
            login
          }
        }
        sponsors {
          totalCount
        }
        sponsorshipsAsSponsor(first: 10) {
          nodes {
            sponsorable {
              ... on User {
                login
              }
              ... on Organization {
                login
              }
            }
          }
        }
        organizations(first: 100) {
          totalCount
          nodes {
            login
            name
            description
            membersWithRole {
              totalCount
            }
          }
        }
        repositories(first: 100, orderBy: {field: STARGAZERS, direction: DESC}, ownerAffiliations: OWNER, isFork: false) {
          totalCount
          nodes {
            name
            stargazerCount
            forkCount
            primaryLanguage {
              name
            }
            description
            repositoryTopics(first: 10) {
              nodes {
                topic {
                  name
                }
              }
            }
          }
        }
        contributionsCollection {
          contributionYears
          contributionCalendar {
            totalContributions
          }
          restrictedContributionsCount
          commitContributionsByRepository(maxRepositories: 100) {
            contributions {
              totalCount
            }
            repository {
              name
              owner {
                login
                ... on Organization {
                  name
                  description
                  membersWithRole {
                    totalCount
                  }
                }
              }
              isPrivate
              stargazerCount
            }
          }
        }
        socialAccounts(first: 10) {
          nodes {
            provider
            url
          }
        }
      }
    }
  `;

  try {
    const result: any = await rateLimiter.execute(async () => {
      return graphql<any>({
        query,
        login: username,
        headers: {
          authorization: `Bearer ${GITHUB_TOKEN}`,
        },
      });
    });

    if (!result || !result.user) {
      console.log(`No data found for user: ${username}`);
      return null;
    }

    const user = result.user;
    const languagesMap: {
      [language: string]: { repoCount: number; stars: number };
    } = {};
    let totalStars = 0;
    let totalForks = 0;
    const topics: string[] = [];

    user.repositories.nodes.forEach((repo: any) => {
      totalStars += repo.stargazerCount;
      totalForks += repo.forkCount;

      if (repo.primaryLanguage) {
        const language = repo.primaryLanguage.name;
        if (languagesMap[language]) {
          languagesMap[language].repoCount += 1;
          languagesMap[language].stars += repo.stargazerCount;
        } else {
          languagesMap[language] = { repoCount: 1, stars: repo.stargazerCount };
        }
      }

      repo.repositoryTopics.nodes.forEach((topic: any) => {
        if (!topics.includes(topic.topic.name)) {
          topics.push(topic.topic.name);
        }
      });
    });

    const externalContributions =
      user.contributionsCollection.commitContributionsByRepository
        .filter((repo: any) => repo.repository.owner.login !== user.login)
        .sort(
          (a: any, b: any) =>
            b.contributions.totalCount - a.contributions.totalCount,
        );

    const totalExternalCommits = externalContributions.reduce(
      (sum: number, repo: any) => sum + repo.contributions.totalCount,
      0,
    );

    const linkedInAccount = user.socialAccounts.nodes.find(
      (account: any) => account.provider === "LINKEDIN",
    );
    const linkedinUrl = linkedInAccount ? linkedInAccount.url : null;
    const normalizedLocation = await getNormalizedLocation(user.location || "");
    const nearNyc = await isNearNYC(user);

    return {
      id: user.login,
      name: user.name,
      login: user.login,
      location: user.location,
      websiteUrl: user.websiteUrl,
      twitterUsername: user.twitterUsername,
      email: user.email,
      bio: user.bio,
      followers: user.followers.totalCount,
      following: user.following.totalCount,

      followerToFollowingRatio: user.following.totalCount
        ? user.followers.totalCount / user.following.totalCount
        : user.followers.totalCount,
      contributionYears: user.contributionsCollection.contributionYears,
      totalCommits:
        user.contributionsCollection.contributionCalendar.totalContributions,
      restrictedContributions:
        user.contributionsCollection.restrictedContributionsCount,
      totalRepositories: user.repositories.totalCount,
      totalStars,
      totalForks,
      languages: Object.fromEntries(
        Object.entries(languagesMap).sort(
          (a, b) => b[1].repoCount - a[1].repoCount,
        ),
      ),
      uniqueTopics: topics,
      externalContributions: externalContributions.length,
      totalExternalCommits,
      sponsorsCount: user.sponsors.totalCount,
      sponsoredProjects: user.sponsorshipsAsSponsor.nodes.map(
        (s: any) => s.sponsorable.login,
      ),
      organizations: user.organizations.nodes.map((org: any) => ({
        name: org.name,
        login: org.login,
        description: org.description,
        membersCount: org.membersWithRole.totalCount,
      })),
      isNearNYC: nearNyc,
      normalizedLocation,
      createdAt: new Date(),
      linkedinUrl,
    };
  } catch (error) {
    console.error(`Error fetching data for user ${username}:`, error);
    return null;
  }
}

export async function getOrFetchUser(
  username: string,
): Promise<GitHubUser | null> {
  let user = null;

  user = await db.query.githubUsers.findFirst({
    where: eq(schema.githubUsers.login, username),
  });

  if (!user) {
    console.log(
      `User ${username} not found in database, fetching from GitHub API...`,
    );
    user = await fetchUserFromGitHub(username);
    if (user) {
      await db.insert(schema.githubUsers).values(user);
      console.log(`User ${username} fetched and inserted into database.`);
    }
  }

  return user;
}

export function analyzeSimilarities(users: GitHubUser[]) {
  const organizations = new Set<string>();
  const normalizedLocations = new Map<string, number>();
  const languageCounts: Record<string, number> = {};
  const followerCounts: number[] = [];
  const followerRatios: number[] = [];
  const starCounts: number[] = [];
  const contributionYearsLengths: number[] = [];
  const totalCommits: number[] = [];

  users.forEach((user) => {
    user.organizations?.forEach((org) => organizations.add(org.login));
    if (user.normalizedLocation) {
      normalizedLocations.set(
        user.normalizedLocation,
        (normalizedLocations.get(user.normalizedLocation) || 0) + 1,
      );
    }
    Object.keys(user.languages || {}).forEach((lang) => {
      languageCounts[lang] = (languageCounts[lang] || 0) + 1;
    });
    followerCounts.push(user.followers);
    followerRatios.push(user.followerToFollowingRatio || 0);
    starCounts.push(user.totalStars);
    contributionYearsLengths.push(user.contributionYears?.length || 0);
    totalCommits.push(user.totalCommits);
  });

  const commonLocations = Array.from(normalizedLocations.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([location]) => location);

  const commonLanguages = Object.entries(languageCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([lang]) => lang);

  const followersMean = calculateMean(followerCounts);
  const followersVariance = calculateVariance(followerCounts, followersMean);
  const ratioMean = calculateMean(followerRatios);
  const ratioVariance = calculateVariance(followerRatios, ratioMean);
  const starsMean = calculateMean(starCounts);
  const starsVariance = calculateVariance(starCounts, starsMean);
  const yearsMean = calculateMean(contributionYearsLengths);
  const yearsVariance = calculateVariance(contributionYearsLengths, yearsMean);
  const commitsMean = calculateMean(totalCommits);
  const commitsVariance = calculateVariance(totalCommits, commitsMean);

  return {
    organizations: Array.from(organizations),
    commonLocations,
    commonLanguages,
    followerStats: { mean: followersMean, variance: followersVariance },
    ratioStats: { mean: ratioMean, variance: ratioVariance },
    starStats: { mean: starsMean, variance: starsVariance },
    yearsStats: { mean: yearsMean, variance: yearsVariance },
    commitStats: { mean: commitsMean, variance: commitsVariance },
  };
}

export function calculateSimilarityScore(
  user: GitHubUser,
  similarities: ReturnType<typeof analyzeSimilarities>,
): number {
  let score = 0;
  score += user.organizations?.some((org) =>
    similarities.organizations.includes(org.login),
  )
    ? 1
    : 0;
  score += similarities.commonLocations.includes(user.normalizedLocation || "")
    ? 2
    : 0;
  const userLanguages = Object.keys(user.languages || {});
  score += similarities.commonLanguages.filter((lang) =>
    userLanguages.includes(lang),
  ).length;
  score +=
    1 /
    (1 +
      Math.abs(user.followers - similarities.followerStats.mean) /
        Math.sqrt(similarities.followerStats.variance));
  const userRatio = user.followerToFollowingRatio || 0;
  score +=
    1 /
    (1 +
      Math.abs(userRatio - similarities.ratioStats.mean) /
        Math.sqrt(similarities.ratioStats.variance));
  score +=
    1 /
    (1 +
      Math.abs(user.totalStars - similarities.starStats.mean) /
        Math.sqrt(similarities.starStats.variance));
  const userYears = user.contributionYears?.length || 0;
  score +=
    1 /
    (1 +
      Math.abs(userYears - similarities.yearsStats.mean) /
        Math.sqrt(similarities.yearsStats.variance));
  score +=
    1 /
    (1 +
      Math.abs(user.totalCommits - similarities.commitStats.mean) /
        Math.sqrt(similarities.commitStats.variance));

  return score;
}

export async function fetchAllGitHubUsers(): Promise<GitHubUser[]> {
  try {
    const users = await db.query.githubUsers.findMany();
    return users;
  } catch (error) {
    console.error("Error fetching GitHub users:", error);
    throw error;
  }
}

async function main(inputUserLogins: string[]) {
  try {
    const inputUsers: GitHubUser[] = [];
    for (const login of inputUserLogins) {
      const user = await getOrFetchUser(login);
      if (user) {
        inputUsers.push(user);
      } else {
        console.log(`Could not find or fetch user: ${login}`);
      }
    }

    if (inputUsers.length === 0) {
      console.log("No valid input users found.");
      return;
    }

    console.log(`Processing ${inputUsers.length} input users.`);

    const allUsers = await fetchAllGitHubUsers();
    console.log(`Fetched ${allUsers.length} GitHub users from the database.`);

    const similarities = analyzeSimilarities(inputUsers);
    console.log(
      "Similarities among input users:",
      JSON.stringify(similarities, null, 2),
    );

    const similarityScores = allUsers.map((user) => ({
      user,
      similarityScore: calculateSimilarityScore(user, similarities),
    }));

    const inputUserIds = new Set(inputUsers.map((user) => user.id));
    const topSimilarUsers = similarityScores
      .filter((score) => !inputUserIds.has(score.user.id))
      .sort((a, b) => b.similarityScore - a.similarityScore)
      .slice(0, 100);

    console.log("Top 100 most similar GitHub users (excluding input users):");
    for (const { user, similarityScore } of topSimilarUsers) {
      console.log(
        `User: ${user.login}, Similarity Score: ${similarityScore.toFixed(4)}, Followers: ${user.followers}, Stars: ${user.totalStars}, Repos: ${user.totalRepositories}, Location: ${user.location || "N/A"}, Normalized Location: ${user.normalizedLocation || "N/A"}`,
      );
    }
  } catch (error) {
    console.error("Error in main function:", error);
  }
}

const inputUserLogins = ["noahgsolomon"];

main(inputUserLogins)
  .then(() => console.log("Analysis completed successfully."))
  .catch((error) => console.error("Error during analysis:", error));
