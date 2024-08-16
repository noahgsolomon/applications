import * as userSchema from "../server/db/schemas/users/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";
import OpenAI from "openai";

dotenv.config({
  path: "../.env",
});

const connection = neon(process.env.DB_URL!);

const db = drizzle(connection, {
  schema: {
    ...userSchema,
  },
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function gatherTopSkills(candidateId: string) {
  const candidate = await db.query.candidates.findFirst({
    where: eq(userSchema.candidates.id, candidateId),
  });

  if (!candidate || !candidate.linkedinData) {
    throw new Error("Candidate or LinkedIn data not found.");
  }

  const skills = candidate.linkedinData.skills || [];
  const positions = candidate.linkedinData.positions.positionHistory
    .map((position: any) => position.description)
    .join(" ");

  const profileData = {
    skills,
    positions,
  };

  if (
    (candidate.topFeatures?.length ?? 0) > 0 ||
    (candidate.topTechnologies?.length ?? 0) > 0
  ) {
    console.log("candidate already has been processed");
    return;
  }

  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          "You are to take in this person's LinkedIn profile data and generate a JSON object with three fields: 'tech', 'features', and 'isEngineer'. The 'tech' field should contain a JSON array of strings representing the hard tech skills they are most familiar with. It should be as specific as possible containing little overlap, as example if they no Next.js then you should put that not Javascript because it is implicit that they know JS, so seek specificity rather than generality. The 'features' field should contain a JSON array of strings representing the top hard features they have worked on the most, such as notifications, architecture, caching, etc. The same specificity over generality sentiment for the features too. The 'isEngineer' field should be a boolean value indicating whether this person is likely an engineer based on their profile. Ensure the response is in a valid JSON format, with both arrays sorted by the most significant skill or feature first. Do not include any extraneous text, and do not format the response with '```json'.",
      },
      {
        role: "user",
        content: JSON.stringify(profileData),
      },
    ],
    response_format: { type: "text" },
    model: "gpt-4o-mini",
    temperature: 0,
    max_tokens: 2048,
  });

  console.log(completion.choices[0].message.content ?? "");
  return JSON.parse(completion.choices[0].message.content ?? "") as {
    tech: string[];
    features: string[];
    isEngineer: boolean;
  };
}
// (async () => {
//   const candidateSkills = await gatherTopSkills(
//     "2d871952-a9af-4719-ae97-0de5e54be913",
//   );
//   console.log(candidateSkills);
// })();
