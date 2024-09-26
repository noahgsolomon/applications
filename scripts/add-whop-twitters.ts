import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import * as schema from "../server/db/schemas/users/schema";
import { eq } from "drizzle-orm";
import dotenv from "dotenv";

dotenv.config({ path: "../.env" });

const API_KEY = process.env.SOCIAL_DATA_API_KEY;
const DB_URL = process.env.DB_URL;

if (!API_KEY || !DB_URL) {
  throw new Error("API_KEY and DB_URL are required in .env file");
}

const pool = new Pool({ connectionString: DB_URL });
const db = drizzle(pool, {
  schema,
});

type Follows = {
  id_str: string;
  screen_name: string;
  twitterData: any;
}[];

async function fetchFollowers(
  userId: string,
  cursor?: string,
  collectedFollowers: Follows = [],
): Promise<Follows> {
  const url = `https://api.socialdata.tools/twitter/followers/list?user_id=${userId}${cursor ? `&cursor=${cursor}` : ""}`;
  console.log(url);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Error fetching followers: ${response.statusText}`);
  }

  const data = await response.json();
  const users = data.users || [];

  const followers = users.map((user: any) => ({
    screen_name: user.screen_name,
    id_str: user.id_str,
    twitterData: user,
  })) as Follows;
  collectedFollowers.push(...followers);

  const nextCursor = data.next_cursor;
  if (nextCursor) {
    return fetchFollowers(userId, nextCursor, collectedFollowers);
  }

  return collectedFollowers;
}

async function fetchFollowing(
  userId: string,
  cursor?: string,
  collectedFollowing: Follows = [],
  position: number = 0,
): Promise<Follows> {
  console.log(`Fetching following for user ${userId} - Position: ${position}`);
  const url = `https://api.socialdata.tools/twitter/friends/list?user_id=${userId}${cursor ? `&cursor=${cursor}` : ""}`;
  console.log(url);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Error fetching following: ${response.statusText}`);
  }

  const data = await response.json();
  const users = data.users || [];

  const following = users.map((user: any) => ({
    screen_name: user.screen_name,
    id_str: user.id_str,
    twitterData: user,
  })) as Follows;
  collectedFollowing.push(...following);

  console.log(`Fetched ${following.length} following at position ${position}`);

  const nextCursor = data.next_cursor;
  if (nextCursor) {
    return fetchFollowing(
      userId,
      nextCursor,
      collectedFollowing,
      position + following.length,
    );
  }

  console.log(`Total following fetched: ${collectedFollowing.length}`);
  return collectedFollowing;
}

async function insertFollowers(accountId: string, followers: Follows) {
  for (const follower of followers) {
    await db
      .insert(schema.whopTwitterFollowers)
      .values({
        twitterId: follower.id_str,
        whopTwitterAccountId: accountId,
        username: follower.screen_name,
        twitterData: follower.twitterData,
      })
      .onConflictDoNothing();
  }
}

async function insertFollowing(accountId: string, following: Follows) {
  console.log(
    `Inserting ${following.length} following for account ${accountId}`,
  );
  for (let i = 0; i < following.length; i++) {
    const followee = following[i];
    await db
      .insert(schema.whopTwitterFollowing)
      .values({
        whopTwitterAccountId: accountId,
        twitterId: followee.id_str,
        username: followee.screen_name,
        twitterData: followee.twitterData,
      })
      .onConflictDoNothing();

    if ((i + 1) % 100 === 0 || i === following.length - 1) {
      console.log(`Inserted ${i + 1} out of ${following.length} following`);
    }
  }
  console.log(`Finished inserting following for account ${accountId}`);
}

async function processUsernames(usernames: string[]) {
  for (const username of usernames) {
    console.log(
      `Processing username: ${username} (${usernames.indexOf(username) + 1}/${usernames.length})`,
    );

    const user = await db.query.whopTwitterAccounts.findFirst({
      where: (whopTwitterAccounts) =>
        eq(whopTwitterAccounts.username, username),
    });

    let userId: string;
    if (!user) {
      try {
        const userProfile = await fetchUserProfile(username);
        await insertUserToDb(userProfile);
        userId = userProfile.id_str;
        console.log(`Inserted new user: ${username}`);
      } catch (error) {
        console.error(`Error fetching user profile for ${username}:`, error);
        continue;
      }
    } else {
      userId = user.twitterId;
    }

    const followersProcessed = await db.query.whopTwitterFollowers.findFirst({
      where: eq(schema.whopTwitterFollowers.whopTwitterAccountId, userId),
    });
    const followingProcessed = await db.query.whopTwitterFollowing.findFirst({
      where: eq(schema.whopTwitterFollowing.whopTwitterAccountId, userId),
    });

    if (followersProcessed && followingProcessed) {
      console.log(
        `Followers and following already processed for ${username}. Skipping...`,
      );
      continue;
    }

    try {
      console.log(`Fetching followers for ${username} (userId: ${userId})`);
      const followers = await fetchFollowers(userId);
      console.log(`Fetched ${followers.length} followers for ${username}`);
      await insertFollowers(userId, followers);
      console.log(`Inserted ${followers.length} followers for ${username}`);
    } catch (error) {
      console.error(`Error fetching followers for ${username}:`, error);
    }

    try {
      console.log(`Fetching following for ${username} (userId: ${userId})`);
      const following = await fetchFollowing(userId);
      console.log(`Fetched ${following.length} following for ${username}`);
      await insertFollowing(userId, following);
      console.log(`Inserted ${following.length} following for ${username}`);
    } catch (error) {
      console.error(`Error fetching following for ${username}:`, error);
    }
  }
}

async function fetchUserProfile(username: string): Promise<any> {
  const url = `https://api.socialdata.tools/twitter/user/${username}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Error fetching user profile: ${response.statusText}`);
  }

  return await response.json();
}

async function insertUserToDb(userProfile: any) {
  await db.insert(schema.whopTwitterAccounts).values({
    username: userProfile.screen_name,
    twitterId: userProfile.id_str,
    twitterData: userProfile,
  });
}

const usernames = [
  "ColinMcDermott",
  "AustinGeorgas",
  "iamdwilms",
  "jacksharkey11",
  "hmaceater",
  "cultured",
  "messwork",
  "nickrotondi",
  "hiiinternet",
  "Keviduk",
  "Rodotcket",
  "s1aydon",
  "Delmo_dev",
  "jantschulev",
  "czoob3",
  "artur_bien",
  "Jaxenormus",
  "Kokkorakis_",
  "ike_baldwin",
  "MrWatchCEO",
  "gronkwizard",
  "whopbiz",
  "tfalexandrino",
  "necatikcl",
  "abearsomewhere",
  "ChaseWhop",
  "itsmada7",
  "dantells444",
];
console.log("Starting to process usernames...");
processUsernames(usernames)
  .then(() => console.log("Finished processing all usernames."))
  .catch((error) =>
    console.error("Error in processUsernames function:", error),
  );
