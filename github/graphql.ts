import { graphql } from "@octokit/graphql";
import * as dotenv from "dotenv";
import fs from "fs";
import * as userSchema from "../server/db/schemas/users/schema";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";

dotenv.config({ path: "../.env" });

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
    const result: any = await graphql<any>({
      query,
      orgName,
      cursor,
      headers: {
        authorization: `Bearer ${GITHUB_TOKEN}`,
      },
    });

    const { nodes, pageInfo } = result.organization.membersWithRole;
    members.push(...nodes.map((node: any) => node.login));
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
  }

  return members;
};

const fetchUserDetails = async (username: string) => {
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
        following {
          totalCount
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
      }
    }
  `;

  try {
    const result = await graphql<{ user: any }>({
      query,
      login: username,
      headers: {
        authorization: `Bearer ${GITHUB_TOKEN}`,
      },
    });

    return result.user;
  } catch (error) {
    console.error(`Error fetching user details for ${username}:`, error);
    return null;
  }
};

const processUserData = (user: any) => {
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

const main = async () => {
  for (const org of organizations) {
    console.log(`Processing organization: ${org}`);
    const members = await fetchOrganizationMembers(org);
    console.log(`Found ${members.length} members for ${org}`);

    const orgData: any[] = [];

    for (const member of members) {
      console.log(`Fetching data for user: ${member}`);
      const userData = await fetchUserDetails(member);
      if (userData) {
        const processedData = processUserData(userData);
        if (processedData) {
          orgData.push(processedData);

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
                  restrictedContributions:
                    processedData.restrictedContributions,
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
                },
              });
            console.log(
              `Inserted/Updated data for user: ${processedData.login}`,
            );
          } catch (error) {
            console.error(
              `Error inserting/updating data for user: ${processedData.login}`,
              error,
            );
          }
        } else {
          console.log(`No data found for user: ${member}`);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    fs.writeFileSync(`${org}_data.json`, JSON.stringify(orgData, null, 2));
    console.log(`Data for ${org} saved to ${org}_data.json`);
  }
};

main().catch((error) => console.error("Error in main function:", error));
