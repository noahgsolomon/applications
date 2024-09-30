import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import { eq, or } from "drizzle-orm/expressions";
import {
  people,
  candidates,
  githubUsers,
  jobTitles,
  skills,
} from "../server/db/schemas/users/schema";
import dotenv from "dotenv";
import OpenAI from "openai";
import * as schema from "../server/db/schemas/users/schema";

dotenv.config({ path: "../.env" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const pool = new Pool({ connectionString: process.env.DB_URL });
const db = drizzle(pool, {
  schema,
});

const API_KEY = process.env.SOCIAL_DATA_API_KEY;

/**
 * Fetches a user's Twitter profile data.
 * @param username - The Twitter username.
 * @returns The Twitter profile data or null if fetching fails.
 */
async function fetchUserProfile(username: string): Promise<any> {
  console.log(`[fetchUserProfile] Fetching data for username: ${username}`);
  const url = `https://api.socialdata.tools/twitter/user/${username}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    console.error(
      `[fetchUserProfile] Error fetching user profile for ${username}: ${response.statusText}`,
    );
    return null;
  }

  console.log(
    `[fetchUserProfile] Successfully fetched data for username: ${username}`,
  );
  return await response.json();
}

/**
 * Generates an embedding vector for a given text using OpenAI's Embeddings API.
 * @param text - The input text to generate an embedding for.
 * @returns A promise that resolves to an array of numbers representing the embedding.
 */
async function getEmbedding(text: string): Promise<number[]> {
  const input = text.replace(/\n/g, " ");
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input,
  });

  if (!response.data || response.data.length === 0) {
    throw new Error("No embedding returned from OpenAI API");
  }

  return response.data[0].embedding;
}

/**
 * Updates the vector columns in the people table for a given person.
 * Determines the appropriate location to use based on the provided logic.
 * @param personId - The ID of the person.
 * @param normalizedLocation - The normalized location string.
 * @param location - The original location string.
 * @param linkedinData - The LinkedIn data object.
 */
async function updateLocationVector(
  personId: string,
  normalizedLocation: string | null,
  location: string | null,
  linkedinData: any,
) {
  let chosenLocation: string | null = null;

  if (
    normalizedLocation &&
    normalizedLocation.trim() !== "" &&
    normalizedLocation.trim().toUpperCase() !== "UNKNOWN"
  ) {
    chosenLocation = normalizedLocation.trim();
  } else if (
    normalizedLocation &&
    normalizedLocation.trim().toUpperCase() === "UNKNOWN" &&
    linkedinData?.location
  ) {
    chosenLocation = linkedinData.location.trim();
  } else if (
    location &&
    location.trim() !== "" &&
    location.trim().toUpperCase() !== "UNKNOWN"
  ) {
    chosenLocation = location.trim();
  }

  if (!chosenLocation || chosenLocation.toUpperCase() === "UNKNOWN") {
    console.log(
      `[updateLocationVector] No valid location found for person ID: ${personId}`,
    );
    return;
  }

  try {
    const locationVector = await getEmbedding(chosenLocation);
    await db
      .update(people)
      .set({ locationVector })
      .where(eq(people.id, personId))
      .execute();
    console.log(
      `[updateLocationVector] Updated location vector for person ID: ${personId}`,
    );
  } catch (error) {
    console.error(
      `[updateLocationVector] Failed to update location vector for person ID: ${personId}`,
      error,
    );
  }
}

/**
 * Inserts a job title and its embedding into the job_titles table.
 * @param personId - The ID of the person.
 * @param title - The job title.
 */
async function insertJobTitle(personId: string, title: string) {
  try {
    const titleVector = await getEmbedding(title);
    await db
      .insert(jobTitles)
      .values({
        personId: personId,
        title: title,
        vector: titleVector,
      })
      .execute();
    console.log(
      `[insertJobTitle] Inserted job title "${title}" for person ID: ${personId}`,
    );
  } catch (error) {
    console.error(
      `[insertJobTitle] Failed to insert job title "${title}" for person ID: ${personId}`,
      error,
    );
  }
}

/**
 * Inserts a skill and its embedding into the skills table.
 * @param personId - The ID of the person.
 * @param skill - The skill or technology.
 */
async function insertSkill(personId: string, skill: string) {
  try {
    const skillVector = await getEmbedding(skill);
    await db
      .insert(skills)
      .values({
        personId: personId,
        skill: skill,
        vector: skillVector,
      })
      .execute();
    console.log(
      `[insertSkill] Inserted skill "${skill}" for person ID: ${personId}`,
    );
  } catch (error) {
    console.error(
      `[insertSkill] Failed to insert skill "${skill}" for person ID: ${personId}`,
      error,
    );
  }
}

/**
 * Splits an array into smaller chunks of a specified size.
 * @param array - The array to split.
 * @param size - The size of each chunk.
 * @returns An array of chunks.
 */
function chunkArray<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

/**
 * Migrates data from source tables into the people table and inserts embeddings.
 * Processes records in batches of 100 for parallelization.
 */
async function migrateData() {
  console.log("[migrateData] Starting data migration...");

  // Step 1: Migrate data from githubUsers
  console.log("[migrateData] Step 1: Migrating data from githubUsers");
  const githubUserRows = await db
    .select()
    .from(githubUsers)
    .where(eq(githubUsers.processed, false))
    .execute();

  console.log(
    `[migrateData] Retrieved ${githubUserRows.length} unprocessed GitHub users`,
  );

  const githubBatches = chunkArray(githubUserRows, 100);
  for (const batch of githubBatches) {
    await Promise.all(
      batch.map(async (githubUser) => {
        console.log(
          `[migrateData] Processing GitHub user: ${githubUser.login}`,
        );
        const personData: typeof people.$inferInsert = {
          name: githubUser.name || null,
          githubLogin: githubUser.login,
          githubId: githubUser.id,
          followers: githubUser.followers,
          following: githubUser.following,
          followerToFollowingRatio: githubUser.followerToFollowingRatio,
          contributionYears: githubUser.contributionYears,
          totalCommits: githubUser.totalCommits,
          restrictedContributions: githubUser.restrictedContributions,
          totalRepositories: githubUser.totalRepositories,
          totalStars: githubUser.totalStars,
          totalForks: githubUser.totalForks,
          githubLanguages: githubUser.languages,
          uniqueTopics: githubUser.uniqueTopics,
          externalContributions: githubUser.externalContributions,
          totalExternalCommits: githubUser.totalExternalCommits,
          sponsorsCount: githubUser.sponsorsCount,
          sponsoredProjects: githubUser.sponsoredProjects,
          organizations: githubUser.organizations,
          location: githubUser.location,
          normalizedLocation: githubUser.normalizedLocation,
          websiteUrl: githubUser.websiteUrl,
          twitterUsername: githubUser.twitterUsername,
          isNearNyc: githubUser.isNearNYC,
          isUpsertedInAllBios: githubUser.isUpsertedInAllBios,
          isWhopUser: githubUser.isWhopUser,
          isWhopCreator: githubUser.isWhopCreator,
          createdAt: githubUser.createdAt,
          sourceTables: ["githubUsers"],
          linkedinData: {}, // Will be filled if candidate data exists
        };

        // Fetch Twitter data if twitterUsername is available
        if (githubUser.twitterUsername) {
          console.log(
            `[migrateData] Fetching Twitter data for: ${githubUser.twitterUsername}`,
          );
          try {
            const twitterData = await fetchUserProfile(
              githubUser.twitterUsername,
            );
            if (twitterData) {
              personData.twitterData = twitterData;
              personData.twitterFollowerCount = twitterData.followers_count;
              personData.twitterFollowingCount = twitterData.friends_count;
              personData.twitterFollowerToFollowingRatio =
                twitterData.followers_count / (twitterData.friends_count || 1);
              personData.twitterBio = twitterData.description;
              personData.tweets = twitterData.statuses;
              console.log(
                `[migrateData] Fetched Twitter data for: ${githubUser.twitterUsername}`,
              );
            }
          } catch (error) {
            console.error(
              `[migrateData] Failed to fetch Twitter data for ${githubUser.twitterUsername}:`,
              error,
            );
          }
        }

        // If githubUser has a linkedinUrl, attempt to fetch candidate data
        if (githubUser.linkedinUrl) {
          console.log(
            `[migrateData] Processing LinkedIn data for: ${githubUser.linkedinUrl}`,
          );
          personData.linkedinUrl = githubUser.linkedinUrl.replace(/\/$/, "");
          const candidate = await db
            .select()
            .from(candidates)
            .where(
              or(
                eq(candidates.url, githubUser.linkedinUrl),
                eq(candidates.url, `${githubUser.linkedinUrl}/`),
              ),
            )
            .then((rows) => rows[0]);

          if (candidate) {
            console.log(
              `[migrateData] Merging candidate data for LinkedIn URL: ${githubUser.linkedinUrl}`,
            );
            personData.name =
              personData.name ||
              `${candidate.linkedinData?.firstName || ""} ${
                candidate.linkedinData?.lastName || ""
              }`.trim();
            personData.email = candidate.linkedinData?.emailAddress || null;
            personData.image = candidate.linkedinData?.photoUrl || null;
            personData.summary = candidate.summary;
            personData.miniSummary = candidate.miniSummary;
            personData.workedInBigTech = candidate.workedInBigTech;
            personData.livesNearBrooklyn = candidate.livesNearBrooklyn;
            personData.companyIds = candidate.companyIds;
            personData.cookdData = candidate.cookdData;
            personData.cookdScore = candidate.cookdScore;
            personData.cookdReviewed = candidate.cookdReviewed;
            personData.topTechnologies = candidate.topTechnologies;
            personData.jobTitles = candidate.jobTitles;
            personData.topFeatures = candidate.topFeatures;
            personData.isEngineer = candidate.isEngineer;
            personData.linkedinData = candidate.linkedinData;
            personData.sourceTables?.push("candidates");

            // Mark candidate as processed
            await db
              .update(candidates)
              .set({ processed: true })
              .where(eq(candidates.id, candidate.id));
            console.log(
              `[migrateData] Marked candidate as processed for LinkedIn URL: ${githubUser.linkedinUrl}`,
            );
          }
        }

        // Insert or update the person record
        console.log(
          `[migrateData] Inserting/Updating person record for GitHub user: ${githubUser.login}`,
        );
        try {
          const insertedPerson = await db
            .insert(people)
            .values(personData)
            .onConflictDoUpdate({
              target: people.githubId,
              set: personData,
            })
            .returning();
          console.log(
            `[migrateData] Successfully inserted/updated person record for GitHub user: ${githubUser.login}`,
          );

          const personId = insertedPerson[0].id;

          // Determine location to use
          await updateLocationVector(
            personId,
            personData.normalizedLocation ?? null,
            personData.location ?? null,
            personData.linkedinData,
          );

          // Insert job titles embeddings
          if (
            Array.isArray(personData.jobTitles) &&
            personData.jobTitles.length > 0
          ) {
            for (const title of personData.jobTitles) {
              await insertJobTitle(personId, title);
            }
          }

          // Insert skills embeddings
          if (
            Array.isArray(personData.topTechnologies) &&
            personData.topTechnologies.length > 0
          ) {
            for (const skill of personData.topTechnologies) {
              await insertSkill(personId, skill);
            }
          }
        } catch (error) {
          console.error(
            `[migrateData] Error inserting/updating person record for GitHub user ${githubUser.login}:`,
            error,
          );
        }

        // Mark githubUser as processed
        await db
          .update(githubUsers)
          .set({ processed: true })
          .where(eq(githubUsers.id, githubUser.id));
        console.log(
          `[migrateData] Marked GitHub user as processed: ${githubUser.login}`,
        );
      }),
    ); // <-- Added missing closing parenthesis here
  }

  // Step 2: Migrate data from candidates not already processed
  console.log("[migrateData] Step 2: Migrating data from candidates");
  const unprocessedCandidates = await db
    .select()
    .from(candidates)
    .where(eq(candidates.processed, false))
    .execute();

  console.log(
    `[migrateData] Retrieved ${unprocessedCandidates.length} unprocessed candidates`,
  );

  const candidateBatches = chunkArray(unprocessedCandidates, 100);
  for (const batch of candidateBatches) {
    await Promise.all(
      batch.map(async (candidate) => {
        console.log(`[migrateData] Processing candidate: ${candidate.url}`);
        const personData: typeof people.$inferInsert = {
          name:
            `${candidate.linkedinData?.firstName || ""} ${candidate.linkedinData?.lastName || ""}`.trim() ||
            null,
          email: candidate.linkedinData?.emailAddress || null,
          image: candidate.linkedinData?.photoUrl || null,
          linkedinUrl: candidate.url,
          summary: candidate.summary,
          miniSummary: candidate.miniSummary,
          workedInBigTech: candidate.workedInBigTech,
          livesNearBrooklyn: candidate.livesNearBrooklyn,
          companyIds: candidate.companyIds,
          cookdData: candidate.cookdData,
          cookdScore: candidate.cookdScore,
          cookdReviewed: candidate.cookdReviewed,
          topTechnologies: candidate.topTechnologies,
          jobTitles: candidate.jobTitles,
          topFeatures: candidate.topFeatures,
          isEngineer: candidate.isEngineer,
          linkedinData: candidate.linkedinData,
          createdAt: candidate.createdAt,
          sourceTables: ["candidates"],
        };

        // Insert or update the person record
        console.log(
          `[migrateData] Inserting/Updating person record for candidate: ${candidate.url}`,
        );
        try {
          const insertedPerson = await db
            .insert(people)
            .values(personData)
            .onConflictDoUpdate({
              target: people.linkedinUrl,
              set: personData,
            })
            .returning();
          console.log(
            `[migrateData] Successfully inserted/updated person record for candidate: ${candidate.url}`,
          );

          const personId = insertedPerson[0].id;

          // Determine location to use
          await updateLocationVector(
            personId,
            personData.normalizedLocation ?? null,
            personData.location ?? null,
            personData.linkedinData,
          );

          // Insert job titles embeddings
          if (
            Array.isArray(personData.jobTitles) &&
            personData.jobTitles.length > 0
          ) {
            for (const title of personData.jobTitles) {
              await insertJobTitle(personId, title);
            }
          }

          // Insert skills embeddings
          if (
            Array.isArray(personData.topTechnologies) &&
            personData.topTechnologies.length > 0
          ) {
            for (const skill of personData.topTechnologies) {
              await insertSkill(personId, skill);
            }
          }
        } catch (error) {
          console.error(
            `[migrateData] Error inserting/updating person record for candidate ${candidate.url}:`,
            error,
          );
        }

        // Mark candidate as processed
        await db
          .update(candidates)
          .set({ processed: true })
          .where(eq(candidates.id, candidate.id));
        console.log(
          `[migrateData] Marked candidate as processed: ${candidate.url}`,
        );
      }),
    );
  }

  // Step 3: Migrate data from Whop Twitter tables not already processed
  console.log("[migrateData] Step 3: Migrating data from Whop Twitter tables");
  const processTwitterAccounts = async (
    table:
      | typeof schema.whopTwitterAccounts
      | typeof schema.whopTwitterFollowers
      | typeof schema.whopTwitterFollowing,
    sourceTable: string,
  ) => {
    const unprocessedAccounts = await db
      .select()
      .from(table)
      .where(eq(table.processed, false))
      .execute();

    console.log(
      `[processTwitterAccounts] Retrieved ${unprocessedAccounts.length} unprocessed accounts from ${sourceTable}`,
    );

    const twitterBatches = chunkArray(unprocessedAccounts, 100);
    for (const batch of twitterBatches) {
      await Promise.all(
        batch.map(async (twitterAccount) => {
          console.log(
            `[processTwitterAccounts] Processing Twitter account: ${twitterAccount.username}`,
          );
          const personData: typeof people.$inferInsert = {
            name: twitterAccount.twitterData?.name || null,
            twitterUsername: twitterAccount.username,
            twitterId: twitterAccount.twitterId,
            twitterData: twitterAccount.twitterData,
            sourceTables: [sourceTable],
          };

          // Insert or update the person record
          console.log(
            `[processTwitterAccounts] Inserting/Updating person record for Twitter account: ${twitterAccount.username}`,
          );
          try {
            const insertedPerson = await db
              .insert(people)
              .values(personData)
              .onConflictDoUpdate({
                target: people.twitterId,
                set: personData,
              })
              .returning();
            console.log(
              `[processTwitterAccounts] Successfully inserted/updated person record for Twitter account: ${twitterAccount.username}`,
            );

            const personId = insertedPerson[0].id;

            // Determine location to use
            await updateLocationVector(
              personId,
              insertedPerson[0].normalizedLocation,
              insertedPerson[0].location,
              insertedPerson[0].linkedinData,
            );

            // Insert job titles embeddings
            if (
              Array.isArray(personData.jobTitles) &&
              personData.jobTitles.length > 0
            ) {
              for (const title of personData.jobTitles) {
                await insertJobTitle(personId, title);
              }
            }

            // Insert skills embeddings
            if (
              Array.isArray(personData.topTechnologies) &&
              personData.topTechnologies.length > 0
            ) {
              for (const skill of personData.topTechnologies) {
                await insertSkill(personId, skill);
              }
            }
          } catch (error) {
            console.error(
              `[processTwitterAccounts] Error inserting/updating person record for Twitter account ${twitterAccount.username}:`,
              error,
            );
          }

          // Mark Twitter account as processed
          await db
            .update(table)
            .set({ processed: true })
            .where(eq(table.id, twitterAccount.id));
          console.log(
            `[processTwitterAccounts] Marked Twitter account as processed: ${twitterAccount.username}`,
          );
        }),
      );
    }
  };

  await processTwitterAccounts(
    schema.whopTwitterAccounts,
    "whopTwitterAccounts",
  );
  await processTwitterAccounts(
    schema.whopTwitterFollowers,
    "whopTwitterFollowers",
  );
  await processTwitterAccounts(
    schema.whopTwitterFollowing,
    "whopTwitterFollowing",
  );

  console.log("[migrateData] Data migration to 'people' table completed.");
}

// Execute the migration
migrateData()
  .then(() => {
    console.log("[migrateData] Migration script finished successfully.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("[migrateData] Error during migration:", error);
    process.exit(1);
  });
