import OpenAI from "openai";
import dotenv from "dotenv";
import * as userSchema from "../server/db/schemas/users/schema";
import { neon, Pool } from "@neondatabase/serverless";
import { eq, isNotNull, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-serverless";

dotenv.config({ path: "../.env" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const pool = new Pool({ connectionString: process.env.DB_URL });
const db = drizzle(pool, {
  schema: {
    ...userSchema,
  },
});

export async function getNormalizedLocation(location: string): Promise<string> {
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

export async function getNormalizedCountry(location: string): Promise<string> {
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

async function updateUserLocations() {
  const users = await db.query.githubUsers.findMany({
    where: isNull(userSchema.githubUsers.normalizedLocation),
  });

  console.log(`Found ${users.length} users with non-null locations.`);

  for (const user of users) {
    if (user.location) {
      console.log(
        `Processing user ${user.login} with location: ${user.location}`
      );
      const normalizedLocation = await getNormalizedLocation(user.location);

      await db
        .update(userSchema.githubUsers)
        .set({ normalizedLocation })
        .where(eq(userSchema.githubUsers.id, user.id));

      console.log(
        `Updated ${user.login}: ${user.location} -> ${normalizedLocation}`
      );
    } else {
      await db
        .update(userSchema.githubUsers)
        .set({ normalizedLocation: "UNDEFINED" })
        .where(eq(userSchema.githubUsers.id, user.id));
    }
  }
}

async function main() {
  try {
    await updateUserLocations();
    console.log("Location normalization completed successfully.");
  } catch (error) {
    console.error("Error in main function:", error);
  }
}

// main();
