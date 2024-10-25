import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "../server/db/schemas/users/schema";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import dotenv from "dotenv";

dotenv.config({ path: "../.env" });

const pool = new Pool({ connectionString: process.env.DB_URL });
const db = drizzle(pool, { schema });

interface Stats {
  followers: { [key: number]: number };
  following: { [key: number]: number };
  mutuals: { [key: number]: number };
}

function updateStats(stats: Stats, category: keyof Stats, count: number) {
  if (!stats[category][count]) {
    stats[category][count] = 0;
  }
  stats[category][count]++;
}

async function processBatch(people: any[], stats: Stats) {
  for (const person of people) {
    if (!person.twitterId) continue;

    const [whopAccountsThatFollowPerson, whopAccountsThatPersonFollows] =
      await Promise.all([
        db.query.whopTwitterFollowing.findMany({
          where: eq(schema.whopTwitterFollowing.twitterId, person.twitterId),
          columns: { twitterId: true, whopTwitterAccountId: true },
        }),
        db.query.whopTwitterFollowers.findMany({
          where: eq(schema.whopTwitterFollowers.twitterId, person.twitterId),
          columns: { twitterId: true, whopTwitterAccountId: true },
        }),
      ]);

    const mutualCount = whopAccountsThatFollowPerson.filter((whopAccount) =>
      whopAccountsThatPersonFollows.some(
        (account) =>
          account.whopTwitterAccountId === whopAccount.whopTwitterAccountId
      )
    ).length;

    // Update stats
    if (
      whopAccountsThatFollowPerson.length > 0 ||
      whopAccountsThatPersonFollows.length > 0 ||
      mutualCount > 0
    ) {
      updateStats(stats, "followers", whopAccountsThatFollowPerson.length);
      updateStats(stats, "following", whopAccountsThatPersonFollows.length);
      updateStats(stats, "mutuals", mutualCount);

      await db
        .update(schema.people)
        .set({
          whopTwitterFollowersCount: whopAccountsThatFollowPerson.length,
          whopTwitterFollowingCount: whopAccountsThatPersonFollows.length,
          whopTwitterMutualsCount: mutualCount,
        })
        .where(eq(schema.people.id, person.id));

      console.log(
        `Updated metrics for ${person.twitterUsername}: Followers=${whopAccountsThatFollowPerson.length}, Following=${whopAccountsThatPersonFollows.length}, Mutuals=${mutualCount}`
      );
    }
  }
}

async function main() {
  const stats: Stats = {
    followers: {},
    following: {},
    mutuals: {},
  };

  // Get all people with Twitter IDs
  const peopleWithTwitter = await db.query.people.findMany({
    where: isNotNull(schema.people.twitterId),
    columns: {
      id: true,
      twitterId: true,
      twitterUsername: true,
    },
  });

  console.log(`Found ${peopleWithTwitter.length} people with Twitter accounts`);

  console.log(
    `Processing all ${peopleWithTwitter.length} people with Twitter accounts`
  );

  await processBatch(peopleWithTwitter, stats);

  // Print current stats after processing
  console.log("\nCurrent Statistics:");
  console.log("Followers distribution:", stats.followers);
  console.log("Following distribution:", stats.following);
  console.log("Mutuals distribution:", stats.mutuals);
  console.log("\n");

  // Print final stats
  console.log("Final Statistics:");
  console.log("Followers distribution:", stats.followers);
}

main()
  .catch(console.error)
  .finally(() => pool.end());
