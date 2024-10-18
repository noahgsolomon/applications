import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "../server/db/schemas/users/schema";
import dotenv from "dotenv";
import OpenAI from "openai";
import { cosineDistance, gt, sql } from "drizzle-orm";

dotenv.config({ path: "../.env" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
const pool = new Pool({ connectionString: process.env.DB_URL });
const db = drizzle(pool, { schema });

let totalScraped = 0;
let totalLinkedIn = 0;
let totalTwitter = 0;
let totalGithub = 0;
let totalWhop = 0;
let totalRails = 0;
let totalNextjs = 0;
let totalSwift = 0;

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

const main = async () => {
  const people = await db.query.people.findMany({
    columns: {
      id: true,
      linkedinUrl: true,
      githubLogin: true,
      twitterUsername: true,
      isWhopUser: true,
    },
  });
  totalScraped = people.length;
  totalLinkedIn = people.filter((person) => person.linkedinUrl).length;
  totalTwitter = people.filter((person) => person.twitterUsername).length;
  totalGithub = people.filter((person) => person.githubLogin).length;
  totalWhop = people.filter((person) => person.isWhopUser).length;

  const swiftVector = await getEmbedding("swift");
  const railsVector = await getEmbedding("rails");
  const nextjsVector = await getEmbedding("nextjs");

  const similarity = sql<number>`1 - (${cosineDistance(
    schema.skillsNew.vector,
    swiftVector
  )})`;

  const matchingSkillsForSwift = await db
    .select({
      technology: schema.skillsNew.skill,
      similarity,
      personIds: schema.skillsNew.personIds,
    })
    .from(schema.skillsNew)
    .where(gt(similarity, 0.7))
    .orderBy(cosineDistance(schema.skillsNew.vector, swiftVector))
    .limit(100000);

  totalSwift = matchingSkillsForSwift
    .map((skill) => skill.personIds?.length ?? 0)
    .reduce((a, b) => a + b, 0);

  const matchingSkillsForRails = await db
    .select({
      technology: schema.skillsNew.skill,
      similarity,
      personIds: schema.skillsNew.personIds,
    })
    .from(schema.skillsNew)
    .where(gt(similarity, 0.7))
    .orderBy(cosineDistance(schema.skillsNew.vector, railsVector))
    .limit(100000);

  totalRails = matchingSkillsForRails
    .map((skill) => skill.personIds?.length ?? 0)
    .reduce((a, b) => a + b, 0);

  const matchingSkillsForNextjs = await db
    .select({
      technology: schema.skillsNew.skill,
      similarity,
      personIds: schema.skillsNew.personIds,
    })
    .from(schema.skillsNew)
    .where(gt(similarity, 0.7))
    .orderBy(cosineDistance(schema.skillsNew.vector, nextjsVector))
    .limit(100000);

  totalNextjs = matchingSkillsForNextjs
    .map((skill) => skill.personIds?.length ?? 0)
    .reduce((a, b) => a + b, 0);

  const reactVector = await getEmbedding("react");

  const matchingSkillsForReact = await db
    .select({
      technology: schema.skillsNew.skill,
      similarity,
      personIds: schema.skillsNew.personIds,
    })
    .from(schema.skillsNew)
    .where(gt(similarity, 0.7))
    .orderBy(cosineDistance(schema.skillsNew.vector, reactVector))
    .limit(100000);

  totalNextjs = matchingSkillsForReact
    .map((skill) => skill.personIds?.length ?? 0)
    .reduce((a, b) => a + b, 0);
};

main().then(() => {
  console.log(
    `Total scraped: ${totalScraped}\nTotal LinkedIn: ${totalLinkedIn}\nTotal Twitter: ${totalTwitter}\nTotal Github: ${totalGithub}\nTotal Whop: ${totalWhop}\nTotal Rails: ${totalRails}\nTotal Nextjs: ${totalNextjs}\nTotal Swift: ${totalSwift}`
  );
});
