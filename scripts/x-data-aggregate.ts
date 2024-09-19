import dotenv from "dotenv";
dotenv.config({ path: "../.env" });

export async function resolveTcoLink(url: string): Promise<string> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(
        `Failed to resolve t.co link: ${url}. Status: ${response.status}`,
      );
      return url;
    }
    const resolvedUrl = response.url;
    console.log(`Resolved ${url} to ${resolvedUrl}`);
    return resolvedUrl;
  } catch (error) {
    console.error(`Error resolving t.co link: ${url}`, error);
    return url;
  }
}

export async function getPopularTweets(username: string, limit: number = 1000) {
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
      const endpoint = `https://api.socialdata.tools/twitter/search?query=${encodeURIComponent(query)}`;

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
        (tweet: any) => !allTweets.some((t: any) => t.id_str === tweet.id_str),
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
    }

    allTweets.sort((a, b) => {
      const engagementA =
        a.retweet_count + a.favorite_count + (a.reply_count || 0);
      const engagementB =
        b.retweet_count + b.favorite_count + (b.reply_count || 0);
      return engagementB - engagementA;
    });
    allTweets = allTweets.slice(0, limit);

    const popularTweets = await Promise.all(
      allTweets.map(async (tweet: any) => {
        const image = tweet.entities?.media?.[0]?.media_url_https ?? "";
        const video =
          tweet.entities?.media?.[0]?.video_info?.variants?.[
            tweet.entities?.media?.[0]?.video_info?.variants.length - 1
          ]?.url ?? "";

        const tcoLinks: string[] =
          tweet.full_text.match(/https?:\/\/t\.co\/\w+/g) || [];
        const resolvedLinks: string[] = await Promise.all(
          tcoLinks.map(resolveTcoLink),
        );
        const linkMap = Object.fromEntries(
          tcoLinks.map((tco, index) => [tco, resolvedLinks[index]]),
        );

        let updatedFullText = tweet.full_text;
        for (const [tco, resolved] of Object.entries(linkMap)) {
          if (
            tco === tcoLinks[tcoLinks.length - 1] &&
            ((image && image !== "") || (video && video !== ""))
          ) {
            updatedFullText = updatedFullText.replace(tco, "").trim();
          } else {
            updatedFullText = updatedFullText.replace(tco, resolved as string);
          }
        }

        return {
          id: tweet.id_str,
          full_text: updatedFullText,
          username: tweet.user.screen_name,
          link: `https://x.com/${tweet.user.screen_name}/status/${tweet.id_str}`,
          image,
          video,
          retweet_count: tweet.retweet_count,
          favorite_count: tweet.favorite_count,
          reply_count: tweet.reply_count || 0,
          engagement:
            tweet.retweet_count +
            tweet.favorite_count +
            (tweet.reply_count || 0),
        };
      }),
    );

    console.log(allTweets.length);

    return popularTweets;
  } catch (error) {
    console.error("Error fetching popular tweets:", error);
    return [];
  }
}

// Usage
getPopularTweets("7etsuo").then((tweets) =>
  console.log(JSON.stringify(tweets, null, 2) + "\n", "Process completed."),
);
