import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import { eq, or } from "drizzle-orm/expressions";
import {
  people,
  candidates,
  githubUsers,
} from "../server/db/schemas/users/schema";
import dotenv from "dotenv";

dotenv.config({ path: "../.env" });

import * as schema from "../server/db/schemas/users/schema";

const pool = new Pool({ connectionString: process.env.DB_URL });
const db = drizzle(pool, {
  schema,
});

const API_KEY = process.env.SOCIAL_DATA_API_KEY;

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

async function migrateData() {
  console.log("[migrateData] Starting data migration...");

  // Step 1: Migrate data from githubUsers
  console.log("[migrateData] Step 1: Migrating data from githubUsers");
  const githubUserRows = await db
    .select()
    .from(githubUsers)
    .where(eq(githubUsers.processed, false));

  console.log(
    `[migrateData] Retrieved ${githubUserRows.length} unprocessed GitHub users`,
  );

  for (const githubUser of githubUserRows) {
    console.log(`[migrateData] Processing GitHub user: ${githubUser.login}`);
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
    };

    // Fetch Twitter data if twitterUsername is available
    if (githubUser.twitterUsername) {
      console.log(
        `[migrateData] Fetching Twitter data for: ${githubUser.twitterUsername}`,
      );
      try {
        const twitterData = await fetchUserProfile(githubUser.twitterUsername);
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
          candidate.linkedinData?.firstName +
            " " +
            candidate.linkedinData?.lastName;
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
    await db.insert(people).values(personData).onConflictDoUpdate({
      target: people.githubId,
      set: personData,
    });

    // Mark githubUser as processed
    await db
      .update(githubUsers)
      .set({ processed: true })
      .where(eq(githubUsers.id, githubUser.id));
    console.log(
      `[migrateData] Marked GitHub user as processed: ${githubUser.login}`,
    );
  }

  // Step 2: Migrate data from candidates not already processed
  console.log("[migrateData] Step 2: Migrating data from candidates");
  const unprocessedCandidates = await db
    .select()
    .from(candidates)
    .where(eq(candidates.processed, false));

  console.log(
    `[migrateData] Retrieved ${unprocessedCandidates.length} unprocessed candidates`,
  );

  for (const candidate of unprocessedCandidates) {
    console.log(`[migrateData] Processing candidate: ${candidate.url}`);
    const personData: typeof people.$inferInsert = {
      name:
        candidate.linkedinData?.firstName +
        " " +
        candidate.linkedinData?.lastName,
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
    await db.insert(people).values(personData).onConflictDoUpdate({
      target: people.linkedinUrl,
      set: personData,
    });

    // Mark candidate as processed
    await db
      .update(candidates)
      .set({ processed: true })
      .where(eq(candidates.id, candidate.id));
    console.log(
      `[migrateData] Marked candidate as processed: ${candidate.url}`,
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
      .where(eq(table.processed, false));

    console.log(
      `[processTwitterAccounts] Retrieved ${unprocessedAccounts.length} unprocessed accounts from ${sourceTable}`,
    );

    for (const twitterAccount of unprocessedAccounts) {
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
      await db.insert(people).values(personData).onConflictDoUpdate({
        target: people.twitterId,
        set: personData,
      });

      // Mark Twitter account as processed
      await db
        .update(table)
        .set({ processed: true })
        .where(eq(table.id, twitterAccount.id));
      console.log(
        `[processTwitterAccounts] Marked Twitter account as processed: ${twitterAccount.username}`,
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

migrateData()
  .then(() => {
    console.log("[migrateData] Migration script finished successfully.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("[migrateData] Error during migration:", error);
    process.exit(1);
  });
