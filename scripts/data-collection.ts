import { graphql } from "@octokit/graphql";
import { RateLimiter } from "../github/graphql";
import {
  gatherTopSkills,
  generateMiniSummary,
  scrapeLinkedInProfile,
} from "@/src/sort";
import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import OpenAI from "openai";
import * as schema from "../server/db/schemas/users/schema";
import { eq, and, or } from "drizzle-orm";
import { chunk } from "lodash";
import { Queue } from "async-await-queue";
import { sql } from "drizzle-orm";
import { Mutex } from "async-mutex";

async function getNormalizedLocation(location: string): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a location normalizer. Given a location, return the uppercase state name if it's a US location, or the uppercase country name if it's outside the US. If it's a city, return the state (for US) or country it's in. If unsure or the location is invalid, return "UNKNOWN".

Examples:
- New York City -> NEW YORK
- New York-> NEW YORK
- London -> UNITED KINGDOM
- California -> CALIFORNIA
- Tokyo -> JAPAN
- Paris, France -> FRANCE
- Sydney -> AUSTRALIA
- 90210 -> CALIFORNIA
- Earth -> UNKNOWN`,
        },
        {
          role: "user",
          content: location,
        },
      ],
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 256,
    });

    return (
      completion.choices[0].message.content?.trim().toUpperCase() || "UNKNOWN"
    );
  } catch (error) {
    console.error(`Error normalizing location for "${location}":`, error);
    return "UNKNOWN";
  }
}

async function getNormalizedCountry(location: string): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a country normalizer. Given a location, return the uppercase country name. If it's a US location (city or state), return "UNITED STATES". For other locations, return the uppercase country name. If unsure or the location is invalid, return "UNKNOWN".

Examples:
- New York City -> UNITED STATES
- New York -> UNITED STATES
- London -> UNITED KINGDOM
- California -> UNITED STATES
- Tokyo -> JAPAN
- Paris, France -> FRANCE
- Sydney -> AUSTRALIA
- 90210 -> UNITED STATES
- Earth -> UNKNOWN`,
        },
        {
          role: "user",
          content: location,
        },
      ],
      model: "gpt-4o-mini",
      temperature: 0,
      max_tokens: 256,
    });

    return (
      completion.choices[0].message.content?.trim().toUpperCase() || "UNKNOWN"
    );
  } catch (error) {
    console.error(`Error normalizing country for "${location}":`, error);
    return "UNKNOWN";
  }
}

dotenv.config({ path: "../.env" });

const rateLimiter = new RateLimiter();

const pool = new Pool({ connectionString: process.env.DB_URL });
const db = drizzle(pool, { schema });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const organizations = ["icco", "samuelngs", "davidsonfellipe"];

// Function to fetch Twitter data
async function getTwitterData(username: string): Promise<any | null> {
  try {
    const endpoint = `https://api.socialdata.tools/twitter/user/${encodeURIComponent(
      username
    )}`;

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${process.env.SOCIAL_DATA_API_KEY}`,
        Accept: "application/json",
      },
    });

    if (response.status === 404) {
      console.error(
        `Twitter user '${username}' not found (404). Marking as invalid.`
      );
      return null;
    }

    if (!response.ok) {
      console.error(
        `Failed to fetch Twitter data for ${username}: ${response.statusText}`
      );
      return null;
    }

    const data = await response.json();

    if (data) {
      return data;
    } else {
      console.log(`No data found for Twitter username: ${username}`);
      return null;
    }
  } catch (error) {
    console.error(`Error fetching Twitter data for ${username}:`, error);
    return null;
  }
}

async function fetchGitHubUserData(username: string): Promise<any | null> {
  console.log(`Fetching GitHub user data for username: ${username}`);
  const exists = await db.query.people.findFirst({
    where: eq(schema.people.githubLogin, username),
  });

  // if (exists) {
  //   console.log(`User already exists: ${username}`);
  //   return null;
  // }

  const query = `
    query($login: String!) {
      user(login: $login) {
        login
        name
        bio
        location
        company
        websiteUrl
        twitterUsername
        email
        avatarUrl
        followers {
          totalCount
        }
        following(first: 100) {
          totalCount
          nodes {
            login
          }
        }
        repositories(first: 100, isFork: false, ownerAffiliations: OWNER) {
          totalCount
          nodes {
            name
            stargazerCount
            forkCount
            primaryLanguage {
              name
            }
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
          totalCommitContributions
          restrictedContributionsCount
        }
        organizations(first: 100) {
          nodes {
            login
            name
            description
            membersWithRole {
              totalCount
            }
          }
        }
        sponsors(first: 100) {
          totalCount
          nodes {
            __typename
            ... on User {
              login
              name
            }
            ... on Organization {
              login
              name
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
          authorization: `Bearer ${process.env.TOKEN_GITHUB}`,
        },
      });
    });

    const userData = result.user;

    // Extract LinkedIn URL if available
    let linkedinUrl: string | null = null;
    const linkedinAccount = userData.socialAccounts.nodes.find(
      (account: any) => account.provider.toLowerCase() === "linkedin"
    );
    if (linkedinAccount) {
      linkedinUrl = linkedinAccount.url;
    }

    // Calculate total commits
    const totalCommits =
      userData.contributionsCollection.totalCommitContributions +
      userData.contributionsCollection.restrictedContributionsCount;

    // Process GitHub languages
    const githubLanguages: Record<
      string,
      { repoCount: number; stars: number }
    > = {};
    userData.repositories.nodes.forEach((repo: any) => {
      if (repo.primaryLanguage) {
        const lang = repo.primaryLanguage.name;
        if (!githubLanguages[lang]) {
          githubLanguages[lang] = { repoCount: 0, stars: 0 };
        }
        githubLanguages[lang].repoCount++;
        githubLanguages[lang].stars += repo.stargazerCount;
      }
    });

    // Calculate total stars and forks
    const totalStars = userData.repositories.nodes.reduce(
      (sum: number, repo: any) => sum + repo.stargazerCount,
      0
    );
    const totalForks = userData.repositories.nodes.reduce(
      (sum: number, repo: any) => sum + repo.forkCount,
      0
    );

    // Process unique topics
    const uniqueTopics = new Set<string>();
    userData.repositories.nodes.forEach((repo: any) => {
      repo.repositoryTopics.nodes.forEach((topic: any) => {
        uniqueTopics.add(topic.topic.name);
      });
    });

    const normalizedLocation = await getNormalizedLocation(
      userData.location || ""
    );
    const normalizedCountry = await getNormalizedCountry(
      userData.location || ""
    );

    // Fetch LinkedIn data if LinkedIn URL is available
    let linkedinData = null;
    if (linkedinUrl) {
      const linkedinDataResult = await scrapeLinkedInProfile(linkedinUrl);
      linkedinData = linkedinDataResult.person;
    }

    // Fetch Twitter data if username is available
    let twitterData = null;
    if (userData.twitterUsername) {
      twitterData = await getTwitterData(userData.twitterUsername);
    }

    // Process Twitter data
    let twitterFollowerCount = null;
    let twitterFollowingCount = null;
    let twitterFollowerToFollowingRatio = null;
    let twitterBio = null;
    let twitterId = null;

    if (twitterData) {
      twitterFollowerCount = twitterData.followers_count || 0;
      twitterFollowingCount = twitterData.friends_count || 0;
      twitterFollowerToFollowingRatio =
        twitterFollowingCount > 0
          ? twitterFollowerCount / twitterFollowingCount
          : twitterFollowerCount;
      twitterBio = twitterData.description || null;
      twitterId = twitterData.id_str || null;
    }
    let isWhopUser = null;
    let isWhopCreator = null;
    if (userData.email) {
      const whopStatus = await checkWhopStatus(userData.email);
      console.log(`Whop status for ${userData.email}:`, whopStatus);
      if (whopStatus) {
        isWhopUser = whopStatus.is_user;
        isWhopCreator = whopStatus.is_creator;
      }
    }

    return {
      name: userData.name,
      email: userData.email,
      image: userData.avatarUrl,
      location: userData.location,
      normalizedLocation,
      normalizedCountry,
      linkedinUrl: linkedinUrl,
      linkedinData: linkedinData,
      githubLogin: userData.login,
      githubImage: userData.avatarUrl,
      githubId: userData.login,
      githubData: userData,
      githubBio: userData.bio,
      githubCompany: userData.company,
      twitterUsername: userData.twitterUsername,
      twitterId: twitterId,
      twitterData: twitterData,
      twitterFollowerCount: twitterFollowerCount,
      twitterFollowingCount: twitterFollowingCount,
      twitterFollowerToFollowingRatio: twitterFollowerToFollowingRatio,
      twitterBio: twitterBio,
      isWhopUser: isWhopUser,
      isWhopCreator: isWhopCreator,
      summary: null,
      // summary: linkedinData ? await generateSummary(linkedinData) : null,
      miniSummary: linkedinData
        ? await generateMiniSummary(linkedinData)
        : null,
      livesNearBrooklyn: normalizedLocation === "NEW YORK",
      topTechnologies: linkedinData
        ? Array.from(
            new Set([
              ...(await gatherTopSkills(linkedinData)).tech,
              ...((linkedinData as any).skills || []),
            ])
          )
        : [],
      jobTitles: linkedinData
        ? (linkedinData as any).positions?.positionHistory.map(
            (p: any) => p.title
          ) || []
        : [],
      topFeatures: linkedinData
        ? (await gatherTopSkills(linkedinData)).features
        : [],
      isEngineer: linkedinData
        ? (await gatherTopSkills(linkedinData)).isEngineer
        : null,
      createdAt: new Date(),

      // GitHub statistics
      followers: userData.followers.totalCount,
      following: userData.following.totalCount,
      followerToFollowingRatio: userData.following.totalCount
        ? userData.followers.totalCount / userData.following.totalCount
        : userData.followers.totalCount,
      contributionYears: userData.contributionsCollection.contributionYears,
      totalCommits,
      restrictedContributions:
        userData.contributionsCollection.restrictedContributionsCount,
      totalRepositories: userData.repositories.totalCount,
      totalStars,
      totalForks,
      githubLanguages,
      uniqueTopics: Array.from(uniqueTopics),
      sponsorsCount: userData.sponsors.totalCount,
      sponsoredProjects: userData.sponsors.nodes.map(
        (sponsor: any) => sponsor.login
      ),
      organizations: userData.organizations.nodes.map((org: any) => ({
        name: org.name,
        login: org.login,
        description: org.description,
        membersCount: org.membersWithRole.totalCount,
      })),
      websiteUrl: userData.websiteUrl,
      isNearNyc: normalizedLocation === "NEW YORK",
      sourceTables: ["githubUsers"],
    };
  } catch (error) {
    console.error(`Error fetching GitHub user data for ${username}:`, error);
    return null;
  }
}

// Function to check Whop status
interface WhopResponse {
  is_user: boolean;
  is_creator: boolean;
}

async function checkWhopStatus(email: string): Promise<WhopResponse> {
  try {
    const response = await fetch(
      `https://api.whop.com/api/v3/sales/check_email?email=${encodeURIComponent(
        email
      )}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.WHOP_API_KEY!}`,
          Cookie: process.env.WHOP_COOKIE!,
        },
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data: WhopResponse = await response.json();
    return data;
  } catch (error) {
    console.error(`Error checking Whop status for ${email}:`, error);
    return { is_user: false, is_creator: false };
  }
}

// // Function to write data to JSON file
// async function writeToJsonFile(data: any, filename: string): Promise<void> {
//   try {
//     const jsonData = JSON.stringify(data, null, 2);
//     await fs.writeFile(path.join(__dirname, filename), jsonData, "utf8");
//     console.log(`Data written to ${filename}`);
//   } catch (error) {
//     console.error(`Error writing to ${filename}:`, error);
//   }
// }

async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: text,
  });

  if (!response.data || response.data.length === 0) {
    throw new Error("No embedding returned from OpenAI API");
  }

  return response.data[0].embedding;
}

function computeAverageEmbedding(embeddings: number[][]): number[] | null {
  if (embeddings.length === 0) {
    console.log("No embeddings to average.");
    return null;
  }
  const vectorLength = embeddings[0].length;
  const sumVector = new Array(vectorLength).fill(0);

  embeddings.forEach((embedding) => {
    for (let i = 0; i < vectorLength; i++) {
      sumVector[i] += embedding[i];
    }
  });

  return sumVector.map((val) => val / embeddings.length);
}

async function updatePersonEmbeddings(personId: string, updates: any) {
  await db
    .update(schema.people)
    .set(updates)
    .where(eq(schema.people.id, personId));
}

const companyMutexes = new Map<string, Mutex>();

async function upsertData(
  table: any,
  columnName: string,
  value: string,
  personId: string
) {
  value = value.toLowerCase().trim();

  // Get or create a mutex for the company name
  let mutex = companyMutexes.get(value);
  if (!mutex) {
    mutex = new Mutex();
    companyMutexes.set(value, mutex);
  }

  return mutex.runExclusive(async () => {
    const existingRow = await db
      .select()
      .from(table)
      .where(eq(table[columnName], value))
      .limit(1);

    if (existingRow.length > 0) {
      const currentPersonIds = existingRow[0].personIds || [];
      if (!currentPersonIds.includes(personId)) {
        try {
          await db
            .update(table)
            .set({ personIds: [...currentPersonIds, personId] })
            .where(eq(table[columnName], value));
        } catch (error) {
          console.error(`Error updating for ${value}:`, error);
        }
        return existingRow[0].vector;
      } else {
        return existingRow[0].vector;
      }
    } else {
      const vector = await getEmbedding(value);
      try {
        await db.insert(table).values({
          [columnName]: value,
          personIds: [personId],
          vector: vector,
        });
        return vector;
      } catch (error) {
        console.error(`Error inserting new for ${value}:`, error);
        return null;
      }
    }
  });
}

const processedUsers = new Set<string>();

async function processOrganizationWithSlidingWindow(orgName: string) {
  console.log(`Processing organization: ${orgName}`);
  // const members = await fetchOrganizationMembers(orgName);
  const members = [orgName];
  console.log(`Found ${members.length} members for ${orgName}`);

  const queue = new Queue(100);
  let processedCount = 0;
  const totalMembers = members.length;

  const processMember = async (username: string) => {
    await queue.wait(username);
    try {
      const userData = await fetchGitHubUserData(username);
      if (userData) {
        await processUser(userData);
      }
    } finally {
      queue.end(username);
      processedCount++;
      console.log(`Processed ${processedCount}/${totalMembers} members`);
    }
  };

  // Start processing all members
  const processingPromises = members.map(processMember);

  // Wait for all members to be processed
  await Promise.all(processingPromises);
}

async function processUser(userData: any, depth: number = 0) {
  if (!userData || !userData.githubLogin) {
    console.log("Invalid user data received. Skipping.");
    return;
  }

  // if (processedUsers.has(userData.githubLogin)) {
  //   return;
  // }

  console.log(`Processing user: ${userData.githubLogin} (Depth: ${depth})`);
  processedUsers.add(userData.githubLogin);

  // Compute and store vectors for the user
  const updates = await computeAndStoreVectorsForUser(userData);

  // Check if the user exists in the database
  const existingUser = await db.query.people.findFirst({
    where: or(
      eq(schema.people.githubLogin, userData.githubLogin),
      eq(schema.people.githubId, userData.githubId),
      eq(schema.people.twitterId, userData.twitterId)
    ),
  });

  if (!existingUser) {
    console.log(`Inserting new user: ${userData.githubLogin}`);
    // Insert the new user with computed vectors
    await insertNewUser(userData, updates);
  } else {
    console.log(`User already exists: ${userData.githubLogin}`);
    // Update the existing user with new vectors
    // await updateExistingUser(existingUser.id, updates);
  }

  // Process following users up to depth 2
  if (depth < 2) {
    const followingList = userData.githubData.following.nodes || [];
    for (const followingUser of followingList) {
      await fetchGitHubUserData(followingUser.login).then(
        (followingUserData) => {
          if (followingUserData) {
            processUser(followingUserData, depth + 1);
          }
        }
      );
    }
  }
}

async function computeAndStoreVectorsForUser(userData: any) {
  const updates: any = {};

  // Process location
  if (userData.normalizedLocation) {
    const locationVector = await upsertData(
      schema.locationsVector,
      "location",
      userData.normalizedLocation,
      userData.id
    );
    if (locationVector) {
      updates.locationVector = locationVector;
    }
  }

  // Process skills
  const allSkills = [
    ...(userData.topTechnologies || []),
    ...Object.keys(userData.githubLanguages || {}),
    ...(userData.topFeatures || []),
  ];
  if (allSkills.length > 0) {
    const skillVectors = await Promise.all(
      allSkills.map((skill: string) =>
        upsertData(schema.skillsNew, "skill", skill, userData.id)
      )
    );
    const validSkillVectors = skillVectors.filter(
      (v): v is number[] => v !== null
    );
    if (validSkillVectors.length > 0) {
      updates.averageSkillVector = computeAverageEmbedding(validSkillVectors);
    }
  }

  // Process job titles
  if (userData.jobTitles && userData.jobTitles.length > 0) {
    const jobTitleVectors = await Promise.all(
      userData.jobTitles.map((title: string) =>
        upsertData(schema.jobTitlesVectorNew, "jobTitle", title, userData.id)
      )
    );
    const validJobTitleVectors = jobTitleVectors.filter(
      (v): v is number[] => v !== null
    );
    if (validJobTitleVectors.length > 0) {
      updates.averageJobTitleVector =
        computeAverageEmbedding(validJobTitleVectors);
    }
  }

  // Process companies
  const companies = [
    ...(userData.organizations?.map((org: any) => org.name) || []),
    userData.githubCompany,
    ...(userData.linkedinData?.positions?.positionHistory.map(
      (p: any) => p.companyName
    ) || []),
  ].filter(Boolean);
  if (companies.length > 0) {
    const companyVectors = await Promise.all(
      companies.map((company: string) =>
        upsertData(schema.companiesVectorNew, "company", company, userData.id)
      )
    );
    const validCompanyVectors = companyVectors.filter(
      (v): v is number[] => v !== null
    );
    if (validCompanyVectors.length > 0) {
      updates.averageCompanyVector =
        computeAverageEmbedding(validCompanyVectors);
    }
  }

  // Process schools and fields of study
  if (userData.linkedinData && userData.linkedinData.education) {
    const schoolVectors = await Promise.all(
      userData.linkedinData.education.educationHistory.map(
        (edu: any) =>
          edu.school &&
          upsertData(schema.schools, "school", edu.school, userData.id)
      )
    );
    const fieldOfStudyVectors = await Promise.all(
      userData.linkedinData.education.educationHistory.map(
        (edu: any) =>
          edu.fieldOfStudy &&
          upsertData(
            schema.fieldsOfStudy,
            "fieldOfStudy",
            edu.fieldOfStudy,
            userData.id
          )
      )
    );
    const validSchoolVectors = schoolVectors.filter(
      (v): v is number[] => v !== null
    );
    const validFieldOfStudyVectors = fieldOfStudyVectors.filter(
      (v): v is number[] => v !== null
    );

    if (validSchoolVectors.length > 0) {
      updates.averageSchoolVector = computeAverageEmbedding(validSchoolVectors);
    }
    if (validFieldOfStudyVectors.length > 0) {
      updates.averageFieldOfStudyVector = computeAverageEmbedding(
        validFieldOfStudyVectors
      );
    }
  }

  return updates;
}

async function insertNewUser(userData: any, updates: any) {
  try {
    await db.insert(schema.people).values({
      ...userData,
      ...updates,
      githubLogin: userData.githubLogin,
      sourceTables: ["githubUsers"],
    });
    console.log(`Inserted new user: ${userData.githubLogin}`);
  } catch (e) {}
}

async function updateExistingUser(userId: string, updates: any) {
  await db
    .update(schema.people)
    .set(updates)
    .where(eq(schema.people.id, userId));
  console.log(`Updated existing user: ${userId}`);
}

async function fetchOrganizationMembers(orgName: string): Promise<string[]> {
  const members: string[] = [];
  let hasNextPage = true;
  let endCursor = null;

  while (hasNextPage) {
    const query = `
      query($orgName: String!, $after: String) {
        organization(login: $orgName) {
          membersWithRole(first: 100, after: $after) {
            nodes {
              login
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }
      }
    `;

    const variables: any = { orgName, after: endCursor };

    const result: any = await rateLimiter.execute(() =>
      graphql<any>(query, {
        ...variables,
        headers: {
          authorization: `Bearer ${process.env.TOKEN_GITHUB}`,
        },
      })
    );

    if (result && result.organization && result.organization.membersWithRole) {
      const { nodes, pageInfo } = result.organization.membersWithRole;
      members.push(...nodes.map((node: any) => node.login));
      hasNextPage = pageInfo.hasNextPage;
      endCursor = pageInfo.endCursor;
    } else {
      hasNextPage = false;
    }
  }

  return members;
}

const main = async () => {
  for (const org of organizations) {
    await processOrganizationWithSlidingWindow(org);
  }
};

main().then(() => {
  console.log("Finished processing all organizations and their members.");
});
