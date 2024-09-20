import dotenv from "dotenv";
dotenv.config({ path: "../.env" });

import * as schema from "@/server/db/schemas/users/schema";
import fetch from "node-fetch";
import { isNotNull, eq, or, isNull, and } from "drizzle-orm";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

const pool = new Pool({ connectionString: process.env.DB_URL });
export const db = drizzle(pool, {
  schema,
});

async function updateTwitterData() {
  try {
    const users = await db
      .select()
      .from(schema.githubUsers)
      .where(
        and(
          isNotNull(schema.githubUsers.twitterUsername),
          or(
            isNull(schema.githubUsers.twitterBio),
            isNull(schema.githubUsers.twitterFollowerCount),
            isNull(schema.githubUsers.twitterFollowingCount),
            isNull(schema.githubUsers.twitterFollowerToFollowingRatio),
            isNull(schema.githubUsers.tweets),
          ),
        ),
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

        let tweets: any[] = [];
        if (user.tweets === null) {
          tweets = await getUserTweets(twitterUsername!, 10);
        }

        await db
          .update(schema.githubUsers)
          .set({
            twitterFollowerCount: followers_count,
            twitterFollowingCount: following_count,
            twitterFollowerToFollowingRatio: followerToFollowingRatio,
            twitterBio: description,
            tweets: tweets.length > 0 ? tweets : null,
          })
          .where(eq(schema.githubUsers.id, user.id));

        console.log(`Updated Twitter data for user ID: ${user.id}`);
      } else {
        await db
          .update(schema.githubUsers)
          .set({ twitterUsername: null })
          .where(eq(schema.githubUsers.id, user.id));

        console.log(
          `Invalid Twitter username '${twitterUsername}' for user ID: ${user.id}. Set twitterUsername to null.`,
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  } catch (error) {
    console.error("Error updating Twitter data:", error);
  }
}

async function getTwitterData(username: string): Promise<any | null> {
  try {
    const endpoint = `https://api.socialdata.tools/twitter/user/${encodeURIComponent(
      username,
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
        `Twitter user '${username}' not found (404). Marking as invalid.`,
      );
      return null;
    }

    if (!response.ok) {
      console.error(
        `Failed to fetch Twitter data for ${username}: ${response.statusText}`,
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

async function getUserTweets(
  username: string,
  limit: number = 10,
): Promise<any[]> {
  const baseQuery = `from:${username} -filter:replies`;
  let allTweets: any[] = [];
  let maxId: string | undefined;
  let iteration = 0;

  try {
    while (allTweets.length < limit) {
      console.log(
        `Iteration ${++iteration}, Total tweets: ${allTweets.length}`,
      );

      const query = maxId ? `${baseQuery} max_id:${maxId}` : baseQuery;
      const endpoint = `https://api.socialdata.tools/twitter/search?query=${encodeURIComponent(
        query,
      )}`;

      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.SOCIAL_DATA_API_KEY}`,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Error fetching tweets: ${response.statusText}`);
      }

      const data = await response.json();
      if (!data.tweets || data.tweets.length === 0) {
        console.log("No more tweets to fetch");
        break;
      }

      // Filter out any tweets we've already seen
      const newTweets = data.tweets.filter(
        (tweet: any) => !allTweets.some((t) => t.id_str === tweet.id_str),
      );

      if (newTweets.length === 0) {
        console.log("No new tweets in this batch");
        break;
      }

      allTweets = allTweets.concat(newTweets);
      maxId = (
        BigInt(data.tweets[data.tweets.length - 1].id_str) - BigInt(1)
      ).toString();

      // Add a small delay to avoid hitting rate limits
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Limit the number of tweets collected
      if (allTweets.length >= limit) {
        allTweets = allTweets.slice(0, limit);
        break;
      }
    }

    return allTweets.slice(0, 10);
  } catch (error) {
    console.error("Error fetching user tweets:", error);
    return [];
  }
}

updateTwitterData()
  .then(() => console.log("Twitter data update process completed."))
  .catch((error) => console.error("Error in updating Twitter data:", error));
