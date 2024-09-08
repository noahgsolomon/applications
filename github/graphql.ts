import { graphql } from "@octokit/graphql";
import * as dotenv from "dotenv";
import fs from "fs";
import * as userSchema from "../server/db/schemas/users/schema";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import OpenAI from "openai";
import { eq } from "drizzle-orm";

class RateLimiter {
  private isWaiting: boolean = false;

  async wait() {
    if (this.isWaiting) {
      return;
    }
    this.isWaiting = true;
    console.log("Rate limit hit. Waiting for 3 minutes...");
    await new Promise((resolve) => setTimeout(resolve, 180000));
    this.isWaiting = false;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T | null> {
    while (true) {
      try {
        return await fn();
      } catch (error) {
        //@ts-ignore
        if (error.message.includes("rate limit")) {
          //@ts-ignore
          console.log(error.message);
          await this.wait();
        } else {
          console.log(error);
          return null;
        }
      }
    }
  }
}

const rateLimiter = new RateLimiter();

dotenv.config({ path: "../.env" });

const connection = neon(process.env.DB_URL!);
const db = drizzle(connection, {
  schema: {
    ...userSchema,
  },
});

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  throw new Error("GitHub token is required in .env file");
}

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

const isNearNYC = async (user: any): Promise<boolean> => {
  if (!user) {
    console.error("User object is null or undefined");
    return false;
  }

  if (!user.location) {
    return false;
  }

  const condition = `Is this location (${user.location}) within 50 miles of Brooklyn, New York City? If it is ambiguous like if it says USA return false.`;
  const result = await askCondition(condition);
  return result;
};

const organizations = [
  "figma",
  "planetscale",
  "postmanlabs",
  "auth0",
  "netlify",
  "launchdarkly",
  "hasura",
  "plaid",
  "vercel",
  "Airtable",
  "segmentio",
  "linear",
  "tailscale",
  "prisma",
  "clerkinc",
  "replit",
  "circleci",
  "zapier",
  "renderinc",
  "supabase",
  "PostHog",
  "tryretool",
  "storyblok",
  "getsentry",
  "muxinc",
  "coinbase",
  "revolut-engineering",
  "monzo",
];

const fetchOrganizationMembers = async (orgName: string) => {
  const query = `
    query($orgName: String!, $cursor: String) {
      organization(login: $orgName) {
        membersWithRole(first: 100, after: $cursor) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            login
          }
        }
      }
    }
  `;

  let hasNextPage = true;
  let cursor: string | null = null;
  const members: string[] = [];

  while (hasNextPage) {
    const result: any = await rateLimiter.execute(async () => {
      return graphql<any>({
        query,
        orgName,
        cursor,
        headers: {
          authorization: `Bearer ${GITHUB_TOKEN}`,
        },
      });
    });
    if (result === null) {
      return [];
    }

    const { nodes, pageInfo } = result.organization.membersWithRole;
    members.push(...nodes.map((node: any) => node.login));
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return members;
};

const fetchUserDetails = async (
  username: string,
  isTopLevelMember: boolean,
) => {
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
          ${
            isTopLevelMember
              ? ""
              : `
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
              membersWithRole(first: 100) {
                totalCount
                nodes {
                  login
                  name
                }
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
          `
          }
        }
      }
    `;

  return rateLimiter.execute(async () => {
    const result = await graphql<{ user: any }>({
      query,
      login: username,
      headers: {
        authorization: `Bearer ${GITHUB_TOKEN}`,
      },
    });

    if (result === null) {
      return null;
    }

    return result.user;
  });
};

const processFollowingData = (user: any) => {
  if (!user) return null;

  const followers = user.followers.totalCount;
  const following = user.following.totalCount;
  const followerToFollowingRatio =
    following === 0 ? followers : (followers / following).toFixed(2);

  let totalStars = 0;
  let totalForks = 0;
  const languagesMap: {
    [language: string]: { repoCount: number; stars: number };
  } = {};
  const contributors: string[] = [];
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

  const totalCommits =
    user.contributionsCollection.contributionCalendar.totalContributions;

  return {
    name: user.name,
    login: user.login,
    location: user.location,
    websiteUrl: user.websiteUrl,
    twitterUsername: user.twitterUsername,
    email: user.email,
    bio: user.bio,
    followers,
    following,
    followingList: user.following.nodes.map((node: any) => ({
      login: node.login,
    })),
    followerToFollowingRatio,
    contributionYears: user.contributionsCollection.contributionYears,
    totalCommits,
    restrictedContributions:
      user.contributionsCollection.restrictedContributionsCount,
    totalRepositories: user.repositories.totalCount,
    totalStars,
    totalForks,
    languages: Object.entries(languagesMap).sort(
      (a, b) => b[1].repoCount - a[1].repoCount,
    ),
    uniqueContributors: contributors,
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
  };
};

const processUserData = (user: any) => {
  if (!user) return null;

  // const followers = user.followers.totalCount;
  // const following = user.following.totalCount;
  // const followerToFollowingRatio =
  //   following === 0 ? followers : (followers / following).toFixed(2);
  //
  // let totalStars = 0;
  // let totalForks = 0;
  // const languagesMap: {
  //   [language: string]: { repoCount: number; stars: number };
  // } = {};
  // const contributors: string[] = [];
  // const topics: string[] = [];

  // user.repositories.nodes.forEach((repo: any) => {
  //   totalStars += repo.stargazerCount;
  //   totalForks += repo.forkCount;
  //
  //   if (repo.primaryLanguage) {
  //     const language = repo.primaryLanguage.name;
  //     if (languagesMap[language]) {
  //       languagesMap[language].repoCount += 1;
  //       languagesMap[language].stars += repo.stargazerCount;
  //     } else {
  //       languagesMap[language] = { repoCount: 1, stars: repo.stargazerCount };
  //     }
  //   }
  //
  //   repo.repositoryTopics.nodes.forEach((topic: any) => {
  //     if (!topics.includes(topic.topic.name)) {
  //       topics.push(topic.topic.name);
  //     }
  //   });
  // });
  //
  // const externalContributions =
  //   user.contributionsCollection.commitContributionsByRepository
  //     .filter((repo: any) => repo.repository.owner.login !== user.login)
  //     .sort(
  //       (a: any, b: any) =>
  //         b.contributions.totalCount - a.contributions.totalCount,
  //     );
  //
  // const totalExternalCommits = externalContributions.reduce(
  //   (sum: number, repo: any) => sum + repo.contributions.totalCount,
  //   0,
  // );
  //
  // const totalCommits =
  //   user.contributionsCollection.contributionCalendar.totalContributions;

  return {
    // name: user.name,
    // login: user.login,
    // location: user.location,
    // websiteUrl: user.websiteUrl,
    // twitterUsername: user.twitterUsername,
    // email: user.email,
    // bio: user.bio,
    // followers,
    // following,
    followingList: user.following.nodes.map((node: any) => ({
      login: node.login,
    })),
    // followerToFollowingRatio,
    // contributionYears: user.contributionsCollection.contributionYears,
    // totalCommits,
    // restrictedContributions:
    //   user.contributionsCollection.restrictedContributionsCount,
    // totalRepositories: user.repositories.totalCount,
    // totalStars,
    // totalForks,
    // languages: Object.entries(languagesMap).sort(
    //   (a, b) => b[1].repoCount - a[1].repoCount,
    // ),
    // uniqueContributors: contributors,
    // uniqueTopics: topics,
    // externalContributions: externalContributions.length,
    // totalExternalCommits,
    // sponsorsCount: user.sponsors.totalCount,
    // sponsoredProjects: user.sponsorshipsAsSponsor.nodes.map(
    //   (s: any) => s.sponsorable.login,
    // ),
    // organizations: user.organizations.nodes.map((org: any) => ({
    //   name: org.name,
    //   login: org.login,
    //   description: org.description,
    //   membersCount: org.membersWithRole.totalCount,
    // })),
  };
};

const processBatch = async (usernames: string[]) => {
  const results = [];

  for (const username of usernames) {
    console.log(`Fetching data for user: ${username}`);
    const userData = await fetchUserDetails(username, true);
    if (userData) {
      const processedData = processUserData(userData);
      if (processedData) {
        await processFollowing(processedData.followingList);
        results.push(processedData);
      }
    }
  }

  return results;
};

const insertOrUpdateUser = async (processedData: any, nearNyc: boolean) => {
  try {
    await db
      .insert(userSchema.githubUsers)
      .values({
        id: processedData.login,
        name: processedData.name || null,
        login: processedData.login,
        location: processedData.location || null,
        websiteUrl: processedData.websiteUrl || null,
        twitterUsername: processedData.twitterUsername || null,
        email: processedData.email || null,
        bio: processedData.bio || null,
        followers: processedData.followers,
        following: processedData.following,
        followerToFollowingRatio: parseFloat(
          processedData.followerToFollowingRatio,
        ),
        contributionYears: processedData.contributionYears,
        totalCommits: processedData.totalCommits,
        restrictedContributions: processedData.restrictedContributions,
        totalRepositories: processedData.totalRepositories,
        totalStars: processedData.totalStars,
        totalForks: processedData.totalForks,
        languages: Object.fromEntries(processedData.languages),
        uniqueTopics: processedData.uniqueTopics,
        externalContributions: processedData.externalContributions,
        totalExternalCommits: processedData.totalExternalCommits,
        sponsorsCount: processedData.sponsorsCount,
        sponsoredProjects: processedData.sponsoredProjects,
        organizations: processedData.organizations,
        isNearNYC: nearNyc,
      })
      .onConflictDoUpdate({
        target: userSchema.githubUsers.login,
        set: {
          name: processedData.name || null,
          location: processedData.location || null,
          websiteUrl: processedData.websiteUrl || null,
          twitterUsername: processedData.twitterUsername || null,
          email: processedData.email || null,
          bio: processedData.bio || null,
          followers: processedData.followers,
          following: processedData.following,
          followerToFollowingRatio: parseFloat(
            processedData.followerToFollowingRatio,
          ),
          contributionYears: processedData.contributionYears,
          totalCommits: processedData.totalCommits,
          restrictedContributions: processedData.restrictedContributions,
          totalRepositories: processedData.totalRepositories,
          totalStars: processedData.totalStars,
          totalForks: processedData.totalForks,
          languages: Object.fromEntries(processedData.languages),
          uniqueTopics: processedData.uniqueTopics,
          externalContributions: processedData.externalContributions,
          totalExternalCommits: processedData.totalExternalCommits,
          sponsorsCount: processedData.sponsorsCount,
          sponsoredProjects: processedData.sponsoredProjects,
          organizations: processedData.organizations,
          isNearNYC: nearNyc,
        },
      });
    console.log(`Inserted/Updated data for user: ${processedData.login}`);
  } catch (error) {
    console.error(
      `Error inserting/updating data for user: ${processedData.login}`,
      error,
    );
  }
};

const processFollowing = async (followingList: any[]) => {
  for (const followingPerson of followingList) {
    const exists = await db.query.githubUsers.findFirst({
      where: eq(userSchema.githubUsers.login, followingPerson.login),
    });
    if (exists) {
      console.log("skipping..");
    } else {
      const userData = await fetchUserDetails(followingPerson.login, false);
      if (userData) {
        const processedData = processFollowingData(userData);
        if (processedData) {
          const nearNyc = await isNearNYC(processedData);
          await insertOrUpdateUser(processedData, nearNyc);
        }
      }
    }
  }
};

const main = async () => {
  for (const org of organizations) {
    console.log(`Processing organization: ${org}`);
    const members = await fetchOrganizationMembers(org);
    console.log(`Found ${members.length} members for ${org}`);

    const batchSize = 10;
    const orgData: any[] = [];

    for (let i = 0; i < members.length; i += batchSize) {
      const batch = members.slice(i, i + batchSize);
      console.log(
        `Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(members.length / batchSize)}`,
      );
      const batchResults = await processBatch(batch);
      orgData.push(...batchResults.filter((result) => result !== null));
    }

    fs.writeFileSync(`${org}_data.json`, JSON.stringify(orgData, null, 2));
    console.log(`Data for ${org} saved to ${org}_data.json`);
  }
};

main().catch((error) => console.error("Error in main function:", error));
