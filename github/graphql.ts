import { graphql } from "@octokit/graphql";
import * as dotenv from "dotenv";
import * as userSchema from "../server/db/schemas/users/schema";
import {
  people,
  locationsVector,
  fieldsOfStudy,
  skillsNew,
  schools,
  companiesVectorNew,
  jobTitlesVectorNew,
} from "../server/db/schemas/users/schema";
import OpenAI from "openai";
import { eq } from "drizzle-orm";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import axios from "axios";
import fetch from "node-fetch";
import { isNotNull, or, isNull, and } from "drizzle-orm";

dotenv.config({ path: "../.env" });

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  throw new Error("GitHub token is required in .env file");
}

const pool = new Pool({
  connectionString: process.env.DB_URL,
});
const db = drizzle(pool, {
  schema: {
    ...userSchema,
  },
});

export class RateLimiter {
  private isWaiting: boolean = false;

  async wait() {
    if (this.isWaiting) {
      return;
    }
    this.isWaiting = true;
    console.log("Rate limit hit. Waiting for 1 minute...");
    await new Promise((resolve) => setTimeout(resolve, 60000));
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

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const askCondition = async (condition: string): Promise<boolean> => {
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
    completion.choices[0].message.content ?? '{ "condition": false }'
  ).condition as boolean;

  return result;
};

const organizations = [
  "stripe",
  "square",
  "uber",
  "wish",
  "yelp",
  "zoom",
  "zillow",
  "yahoo",
  "yandex",
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
  isTopLevelMember: boolean
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
          socialAccounts(first: 10) {
            nodes {
              provider
              url
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

    const user = result.user;

    // Process LinkedIn data if available
    if (user.websiteUrl && user.websiteUrl.includes("linkedin.com")) {
      await processLinkedInData(user.id, user.websiteUrl);
    }

    return user;
  });
};

async function scrapeLinkedInProfile(linkedinUrl: string) {
  console.log(`Scraping LinkedIn profile for URL: ${linkedinUrl}`);
  const options = {
    method: "GET",
    url: `https://api.scrapin.io/enrichment/profile`,
    params: {
      apikey: process.env.SCRAPIN_API_KEY!,
      linkedInUrl: linkedinUrl,
    },
  };

  try {
    const response = await axios.request(options);
    console.log("Profile data fetched successfully.");
    return response.data;
  } catch (error) {
    console.error(`Error fetching LinkedIn profile data: ${error}`);
    return null;
  }
}

async function processLinkedInData(personId: string, linkedinUrl: string) {
  const linkedinData = await scrapeLinkedInProfile(linkedinUrl);

  if (linkedinData) {
    // Update the person record
    await db
      .update(people)
      .set({
        linkedinUrl: linkedinUrl,
        linkedinData: linkedinData,
      })
      .where(eq(people.id, personId));

    // Process skills
    if (linkedinData.skills) {
      for (const skill of linkedinData.skills) {
        await upsertSkillEmbedding(personId, skill);
      }
    }

    // Process companies
    if (linkedinData.positions) {
      for (const position of linkedinData.positions) {
        if (position.companyName) {
          await upsertCompanyEmbedding(personId, position.companyName);
        }
      }
    }

    // Process education
    if (linkedinData.education) {
      for (const edu of linkedinData.education) {
        if (edu.schoolName) {
          await upsertSchoolEmbedding(personId, edu.schoolName);
        }
        if (edu.fieldOfStudy) {
          await upsertFieldOfStudyEmbedding(personId, edu.fieldOfStudy);
        }
      }
    }

    // Process location
    if (linkedinData.location) {
      const normalizedLocation = await getNormalizedLocation(
        linkedinData.location
      );
      await upsertLocationEmbedding(personId, normalizedLocation);
    }

    // Process job titles
    if (linkedinData.positions) {
      for (const position of linkedinData.positions) {
        if (position.title) {
          await upsertJobTitleEmbedding(personId, position.title);
        }
      }
    }
  }
}

async function upsertJobTitleEmbedding(personId: string, jobTitle: string) {
  const existingJobTitle = await db
    .select()
    .from(jobTitlesVectorNew)
    .where(eq(jobTitlesVectorNew.jobTitle, jobTitle))
    .limit(1);

  if (existingJobTitle.length > 0) {
    const currentPersonIds = existingJobTitle[0].personIds || [];
    const updatedPersonIds = Array.from(
      new Set([...currentPersonIds, personId])
    );
    await db
      .update(jobTitlesVectorNew)
      .set({ personIds: updatedPersonIds })
      .where(eq(jobTitlesVectorNew.jobTitle, jobTitle));
  } else {
    const jobTitleVector = await getEmbedding(jobTitle);
    await db
      .insert(jobTitlesVectorNew)
      .values({
        personIds: [personId],
        jobTitle,
        vector: jobTitleVector,
      })
      .onConflictDoNothing();
  }
}

const processFollowingData = async (user: any) => {
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
          b.contributions.totalCount - a.contributions.totalCount
      );

  const totalExternalCommits = externalContributions.reduce(
    (sum: number, repo: any) => sum + repo.contributions.totalCount,
    0
  );

  const totalCommits =
    user.contributionsCollection.contributionCalendar.totalContributions;

  const linkedInAccount = user.socialAccounts.nodes.find(
    (account: any) => account.provider === "LINKEDIN"
  );
  const linkedinUrl = linkedInAccount ? linkedInAccount.url : null;

  const normalizedLocation = await getNormalizedLocation(user.location || "");

  return {
    name: user.name,
    login: user.login,
    location: user.location,
    normalizedLocation,
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
      (a, b) => b[1].repoCount - a[1].repoCount
    ),
    uniqueContributors: contributors,
    uniqueTopics: topics,
    externalContributions: externalContributions.length,
    totalExternalCommits,
    sponsorsCount: user.sponsors?.totalCount || 0,
    sponsoredProjects:
      user.sponsorshipsAsSponsor?.nodes.map((s: any) => s.sponsorable.login) ||
      [],
    organizations:
      user.organizations?.nodes.map((org: any) => ({
        name: org.name,
        login: org.login,
        description: org.description,
        membersCount: org.membersWithRole.totalCount,
      })) || [],
    linkedinUrl,
  };
};

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

    if (!response.ok) {
      console.error(
        `Failed to fetch Twitter data for ${username}: ${response.statusText}`
      );
      return null;
    }

    const data = await response.json();

    if (data) {
      const followers_count = data.followers_count || 0;
      const following_count = data.friends_count || 0;
      const followerToFollowingRatio =
        following_count > 0
          ? followers_count / following_count
          : followers_count;

      return {
        twitterFollowerCount: followers_count,
        twitterFollowingCount: following_count,
        twitterFollowerToFollowingRatio: followerToFollowingRatio,
        twitterBio: data.description || null,
      };
    } else {
      console.log(`No data found for Twitter username: ${username}`);
      return null;
    }
  } catch (error) {
    console.error(`Error fetching Twitter data for ${username}:`, error);
    return null;
  }
}

const processUserData = async (user: any) => {
  if (!user) return null;

  const linkedInAccount = user.socialAccounts.nodes.find(
    (account: any) => account.provider === "LINKEDIN"
  );
  const linkedinUrl = linkedInAccount ? linkedInAccount.url : null;

  const normalizedLocation = await getNormalizedLocation(user.location || "");

  let twitterData = null;
  if (user.twitterUsername) {
    twitterData = await getTwitterData(user.twitterUsername);
  }

  return {
    followingList: user.following.nodes.map((node: any) => ({
      login: node.login,
    })),
    linkedinUrl,
    location: user.location,
    normalizedLocation,
    ...twitterData,
  };
};

async function getNormalizedLocation(location: string): Promise<string> {
  try {
    const completion = await openai.chat.completions.create({
      messages: [
        {
          role: "system",
          content: `You are a location normalizer. Given a location, return the uppercase state name if it's a US location, or the uppercase country name if it's outside the US. If it's a city, return the state (for US) or country it's in. If unsure or the location is invalid, return "UNKNOWN".
Examples:
- New York City -> NEW YORK
- New York -> NEW YORK
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

const insertOrUpdateUser = async (processedData: any) => {
  try {
    await db
      .insert(userSchema.people)
      .values({
        id: processedData.login,
        name: processedData.name || null,
        githubLogin: processedData.login,
        location: processedData.location || null,
        normalizedLocation: processedData.normalizedLocation || null,
        websiteUrl: processedData.websiteUrl || null,
        twitterUsername: processedData.twitterUsername || null,
        email: processedData.email || null,
        githubBio: processedData.bio || null,
        followers: processedData.followers,
        following: processedData.following,
        followerToFollowingRatio: parseFloat(
          processedData.followerToFollowingRatio
        ),
        contributionYears: processedData.contributionYears,
        totalCommits: processedData.totalCommits,
        restrictedContributions: processedData.restrictedContributions,
        totalRepositories: processedData.totalRepositories,
        totalStars: processedData.totalStars,
        totalForks: processedData.totalForks,
        githubLanguages: Object.fromEntries(processedData.languages),
        uniqueTopics: processedData.uniqueTopics,
        externalContributions: processedData.externalContributions,
        totalExternalCommits: processedData.totalExternalCommits,
        sponsorsCount: processedData.sponsorsCount,
        sponsoredProjects: processedData.sponsoredProjects,
        organizations: processedData.organizations,
        linkedinUrl: processedData.linkedinUrl || null,
        githubData: {},
        sourceTables: ["githubUsers"],
        twitterFollowerCount: processedData.twitterFollowerCount || null,
        twitterFollowingCount: processedData.twitterFollowingCount || null,
        twitterFollowerToFollowingRatio:
          processedData.twitterFollowerToFollowingRatio || null,
        twitterBio: processedData.twitterBio || null,
      })
      .onConflictDoUpdate({
        target: userSchema.people.githubLogin,
        set: {
          name: processedData.name || null,
          location: processedData.location || null,
          normalizedLocation: processedData.normalizedLocation || null,
          websiteUrl: processedData.websiteUrl || null,
          twitterUsername: processedData.twitterUsername || null,
          email: processedData.email || null,
          githubBio: processedData.bio || null,
          followers: processedData.followers,
          following: processedData.following,
          followerToFollowingRatio: parseFloat(
            processedData.followerToFollowingRatio
          ),
          contributionYears: processedData.contributionYears,
          totalCommits: processedData.totalCommits,
          restrictedContributions: processedData.restrictedContributions,
          totalRepositories: processedData.totalRepositories,
          totalStars: processedData.totalStars,
          totalForks: processedData.totalForks,
          githubLanguages: Object.fromEntries(processedData.languages),
          uniqueTopics: processedData.uniqueTopics,
          externalContributions: processedData.externalContributions,
          totalExternalCommits: processedData.totalExternalCommits,
          sponsorsCount: processedData.sponsorsCount,
          sponsoredProjects: processedData.sponsoredProjects,
          organizations: processedData.organizations,
          linkedinUrl: processedData.linkedinUrl || null,
          githubData: {},
          sourceTables: ["githubUsers"],
          twitterFollowerCount: processedData.twitterFollowerCount || null,
          twitterFollowingCount: processedData.twitterFollowingCount || null,
          twitterFollowerToFollowingRatio:
            processedData.twitterFollowerToFollowingRatio || null,
          twitterBio: processedData.twitterBio || null,
        },
      });
    console.log(`Inserted/Updated data for user: ${processedData.login}`);
  } catch (error) {
    console.error(
      `Error inserting/updating data for user: ${processedData.login}`,
      error
    );
  }
};

const processFollowing = async (followingList: any[]) => {
  for (const followingPerson of followingList) {
    const exists = await db.query.people.findFirst({
      where: eq(userSchema.people.githubLogin, followingPerson.login),
    });
    if (exists) {
      console.log("skipping..");
    } else {
      const userData = await fetchUserDetails(followingPerson.login, false);
      if (userData) {
        const processedData = await processFollowingData(userData);
        if (processedData) {
          await insertOrUpdateUser(processedData);
        }
      }
    }
  }
};

const processBatch = async (usernames: string[]) => {
  const results = [];

  for (const username of usernames) {
    console.log(`Fetching data for user: ${username}`);
    const userData = await fetchUserDetails(username, true);
    if (userData) {
      const processedData = await processUserData(userData);
      if (processedData) {
        await processFollowing(processedData.followingList);
        results.push(processedData);
      }
    }
  }

  return results;
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
        `Processing batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(
          members.length / batchSize
        )}`
      );
      const batchResults = await processBatch(batch);
      orgData.push(...batchResults.filter((result) => result !== null));
    }

    console.log(`Data for ${org} saved to ${org}_data.json`);
  }
};

// main().catch((error) => console.error("Error in main function:", error));

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

async function upsertSkillEmbedding(personId: string, skill: string) {
  const normalizedSkill = skill.toLowerCase().trim();
  const existingSkill = await db
    .select()
    .from(skillsNew)
    .where(eq(skillsNew.skill, normalizedSkill))
    .limit(1);

  if (existingSkill.length > 0) {
    const currentPersonIds = existingSkill[0].personIds || [];
    const updatedPersonIds = Array.from(
      new Set([...currentPersonIds, personId])
    );
    await db
      .update(skillsNew)
      .set({ personIds: updatedPersonIds })
      .where(eq(skillsNew.skill, normalizedSkill));
  } else {
    const skillVector = await getEmbedding(normalizedSkill);
    await db
      .insert(skillsNew)
      .values({
        personIds: [personId],
        skill: normalizedSkill,
        vector: skillVector,
      })
      .onConflictDoNothing();
  }
}

async function upsertCompanyEmbedding(personId: string, company: string) {
  const existingCompany = await db
    .select()
    .from(companiesVectorNew)
    .where(eq(companiesVectorNew.company, company))
    .limit(1);

  if (existingCompany.length > 0) {
    const currentPersonIds = existingCompany[0].personIds || [];
    const updatedPersonIds = Array.from(
      new Set([...currentPersonIds, personId])
    );
    await db
      .update(companiesVectorNew)
      .set({ personIds: updatedPersonIds })
      .where(eq(companiesVectorNew.company, company));
  } else {
    const companyVector = await getEmbedding(company);
    await db
      .insert(companiesVectorNew)
      .values({
        personIds: [personId],
        company,
        vector: companyVector,
      })
      .onConflictDoNothing();
  }
}

async function upsertSchoolEmbedding(personId: string, school: string) {
  const existingSchool = await db
    .select()
    .from(schools)
    .where(eq(schools.school, school))
    .limit(1);

  if (existingSchool.length > 0) {
    const currentPersonIds = existingSchool[0].personIds || [];
    const updatedPersonIds = Array.from(
      new Set([...currentPersonIds, personId])
    );
    await db
      .update(schools)
      .set({ personIds: updatedPersonIds })
      .where(eq(schools.school, school));
  } else {
    const schoolVector = await getEmbedding(school);
    await db
      .insert(schools)
      .values({
        personIds: [personId],
        school,
        vector: schoolVector,
      })
      .onConflictDoNothing();
  }
}

async function upsertFieldOfStudyEmbedding(
  personId: string,
  fieldOfStudy: string
) {
  const existingFieldOfStudy = await db
    .select()
    .from(fieldsOfStudy)
    .where(eq(fieldsOfStudy.fieldOfStudy, fieldOfStudy))
    .limit(1);

  if (existingFieldOfStudy.length > 0) {
    const currentPersonIds = existingFieldOfStudy[0].personIds || [];
    const updatedPersonIds = Array.from(
      new Set([...currentPersonIds, personId])
    );
    await db
      .update(fieldsOfStudy)
      .set({ personIds: updatedPersonIds })
      .where(eq(fieldsOfStudy.fieldOfStudy, fieldOfStudy));
  } else {
    const fieldOfStudyVector = await getEmbedding(fieldOfStudy);
    await db
      .insert(fieldsOfStudy)
      .values({
        personIds: [personId],
        fieldOfStudy,
        vector: fieldOfStudyVector,
      })
      .onConflictDoNothing();
  }
}

async function upsertLocationEmbedding(
  personId: string,
  normalizedLocation: string
) {
  const existingLocation = await db
    .select()
    .from(locationsVector)
    .where(eq(locationsVector.location, normalizedLocation))
    .limit(1);

  if (existingLocation.length > 0) {
    const currentPersonIds = existingLocation[0].personIds || [];
    const updatedPersonIds = Array.from(
      new Set([...currentPersonIds, personId])
    );
    await db
      .update(locationsVector)
      .set({ personIds: updatedPersonIds })
      .where(eq(locationsVector.location, normalizedLocation));
  } else {
    const locationVector = await getEmbedding(normalizedLocation);
    await db
      .insert(locationsVector)
      .values({
        personIds: [personId],
        location: normalizedLocation,
        vector: locationVector,
      })
      .onConflictDoNothing();
  }
}

async function updateTwitterData() {
  try {
    const users = await db
      .select()
      .from(people)
      .where(
        and(
          isNotNull(people.twitterUsername),
          or(
            isNull(people.twitterBio),
            isNull(people.twitterFollowerCount),
            isNull(people.twitterFollowingCount),
            isNull(people.twitterFollowerToFollowingRatio),
            isNull(people.tweets)
          )
        )
      );

    console.log(`Found ${users.length} users needing Twitter data updates.`);

    for (const user of users) {
      const twitterUsername = user.twitterUsername;

      // Fetch Twitter data
      const twitterData = await getTwitterData(twitterUsername!);

      if (twitterData) {
        const followers_count = twitterData.followers_count || 0;
        const following_count = twitterData.friends_count || 0;
        const description = twitterData.description || null;

        const followerToFollowingRatio =
          following_count > 0
            ? followers_count / following_count
            : followers_count;

        await db
          .update(people)
          .set({
            twitterFollowerCount: followers_count,
            twitterFollowingCount: following_count,
            twitterFollowerToFollowingRatio: followerToFollowingRatio,
            twitterBio: description,
          })
          .where(eq(people.id, user.id));

        console.log(`Updated Twitter data for user ID: ${user.id}`);
      } else {
        await db
          .update(people)
          .set({ twitterUsername: null })
          .where(eq(people.id, user.id));

        console.log(
          `Invalid Twitter username '${twitterUsername}' for user ID: ${user.id}. Set twitterUsername to null.`
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error("Error updating Twitter data:", error);
  }
}
