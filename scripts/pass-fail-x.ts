import dotenv from "dotenv";
dotenv.config({ path: "../.env" });

import OpenAI from "openai";
import { Pinecone } from "@pinecone-database/pinecone";
import fetch from "node-fetch";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY!,
});

const index = pinecone.Index("whop");

async function getEmbedding(text: string): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: "text-embedding-3-large",
      input: text,
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error("Error generating embedding:", error);
    throw error;
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

async function upsertEmbeddingsToPinecone(
  embeddings: number[][],
  metadataList: any[],
  namespace: string,
) {
  try {
    const vectors = embeddings.map((embedding, idx) => ({
      id: metadataList[idx].id,
      values: embedding,
      metadata: metadataList[idx],
    }));

    // Batch upsert for efficiency
    await index.namespace(namespace).upsert(vectors);

    console.log(
      `Upserted ${vectors.length} embeddings to namespace ${namespace}`,
    );
  } catch (error) {
    console.error(
      `Error upserting embeddings to Pinecone namespace ${namespace}:`,
      error,
    );
  }
}

async function processUser(usernames: string[], pass: boolean) {
  try {
    for (const username of usernames) {
      const tweets = await getUserTweets(username, 100);

      const tweetEmbeddings = await Promise.all(
        tweets.map((tweet) => getEmbedding(tweet.full_text)),
      );

      const tweetMetadata = tweets.map((tweet, idx) => ({
        id: `${username}-tweet-${tweet.id_str}`,
        pass: pass,
        text: tweet.full_text,
        username,
        retweet_count: tweet.retweet_count,
        favorite_count: tweet.favorite_count,
        reply_count: tweet.reply_count || 0,
      }));

      await upsertEmbeddingsToPinecone(
        tweetEmbeddings,
        tweetMetadata,
        "x-tweets-staff-swe-infra",
      );

      const userInfo = await getUserInfo(username);

      if (userInfo.bio) {
        const bioEmbedding = await getEmbedding(userInfo.bio);
        const bioMetadata = {
          id: `${username}-bio`,
          text: userInfo.bio,
          pass: pass,
          username,
        };

        await upsertEmbeddingsToPinecone(
          [bioEmbedding],
          [bioMetadata],
          "x-bio-staff-swe-infra",
        );
      } else {
        console.log(`User ${username} has no bio to embed.`);
      }

      const followerCount = userInfo.followers_count;
      const followingCount = userInfo.following_count;
      const followerFollowingRatio =
        followingCount > 0 ? followerCount / followingCount : 0;

      const totalEngagement = tweetMetadata.reduce((sum, tweet) => {
        return (
          sum +
          (tweet.retweet_count || 0) +
          (tweet.favorite_count || 0) +
          (tweet.reply_count || 0)
        );
      }, 0);

      console.log(
        `User ${username} has ${followerCount} followers and ${followingCount} following. Ratio: ${followerFollowingRatio}`,
      );
      console.log(`Total engagement from latest tweets: ${totalEngagement}`);

      console.log(`Completed processing for user ${username}.`);
    }
  } catch (error) {
    console.error(`Error processing user:`, error);
  }
}

async function getUserInfo(username: string): Promise<any> {
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

    if (!response.ok) {
      throw new Error(`Error fetching user info: ${response.statusText}`);
    }

    const data = await response.json();

    if (data) {
      return {
        bio: data.description || null,
        location: data.location || null,
        followers_count: data.followers_count || 0,
        following_count: data.friends_count || 0,
      };
    } else {
      console.log(`No info found for user ${username}`);
      return {};
    }
  } catch (error) {
    console.error(`Error fetching info for user ${username}:`, error);
    return {};
  }
}

processUser(["everconfusedguy", "SferaDev", "nutlope", "okikio_dev"], true)
  .then(() => console.log("Process completed."))
  .catch((error) => console.error("Error in processing:", error));
