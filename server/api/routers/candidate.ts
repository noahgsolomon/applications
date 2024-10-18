import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";
import * as schema from "@/server/db/schemas/users/schema";
import OpenAI from "openai";
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { Pinecone } from "@pinecone-database/pinecone";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

async function getEmbedding(text: string) {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-large",
    input: text,
    encoding_format: "float",
  });

  return response.data[0].embedding;
}

const pinecone = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY || "",
});

const index = pinecone.Index("whop");

async function querySimilarTechnologies(skill: string) {
  try {
    console.log(`Getting embedding for skill: ${skill}`);
    const skillEmbedding = await getEmbedding(skill);
    console.log(`Got embedding for skill: ${skill}`);

    const queryResponse = await index.namespace("technologies").query({
      topK: 200,
      vector: skillEmbedding,
      includeMetadata: true,
      includeValues: false,
    });

    const similarTechnologies = queryResponse.matches
      .filter((match) => (match.score ?? 0) > 0.7)
      .map((match) => ({
        technology: match.metadata?.technology as string,
        score: match.score ?? 0,
      }));
    return similarTechnologies;
  } catch (error) {
    console.error("Error querying similar technologies:", error);
    return [];
  }
}

async function querySimilarJobTitles(job: string) {
  try {
    console.log(`Getting embedding for job: ${job}`);
    const jobEmbedding = await getEmbedding(job);

    const queryResponse = await index.namespace("job-titles").query({
      topK: 500,
      vector: jobEmbedding,
      includeMetadata: true,
      includeValues: false,
    });

    const similarJobTitles = queryResponse.matches
      .filter((match) => (match.score ?? 0) > 0.7)
      .map((match) => match.metadata?.jobTitle) as string[];

    console.log(`SIMILAR JOB TITLES LENGTH: ${similarJobTitles.length}`);
    return similarJobTitles;
  } catch (error) {
    console.error("Error querying similar job titles:", error);
    return [];
  }
}

export const candidateRouter = createTRPCRouter({
  getAbsoluteFilteredTopCandidates: publicProcedure
    .input(z.any())
    .mutation(async ({ ctx, input }) => {
      console.log("input", input);
      let conditions = [];
      if (input.showTwitter) {
        conditions.push(isNotNull(schema.people.twitterUsername));
      }
      if (input.showWhop) {
        conditions.push(
          or(
            eq(schema.people.isWhopUser, true),
            eq(schema.people.isWhopCreator, true)
          )
        );
      }
      if (input.showGithub) {
        conditions.push(isNotNull(schema.people.githubLogin));
      }
      if (input.showLinkedin) {
        conditions.push(isNotNull(schema.people.linkedinUrl));
      }
      const topCandidates = await ctx.db.query.people.findMany({
        where: and(
          ...conditions,
          inArray(
            schema.people.id,
            input.allIdsResponse.map((id: any) => id.id)
          )
        ),
      });

      const topCandidatesWithScores = topCandidates
        .map((candidate) => {
          const idResponse = input.allIdsResponse.find(
            (id: any) => id.id === candidate.id
          );
          return {
            data: candidate,
            score: idResponse?.score || 0,
            matchedSkills: idResponse?.matchedSkills || [],
            matchedJobTitle: idResponse?.matchedJobTitle || undefined,
            matchedLocation: idResponse?.matchedLocation || undefined,
            matchedCompanies: idResponse?.matchedCompanies || [],
            matchedSchools: idResponse?.matchedSchools || [],
            matchedFieldsOfStudy: idResponse?.matchedFieldsOfStudy || [],
            from: idResponse?.from || undefined,
            attributions: idResponse?.attributions || undefined,
            activeGithub: idResponse?.activeGithub || undefined,
            activeGithubScore: idResponse?.activeGithubScore || undefined,
          };
        })
        .filter((candidate) =>
          input.showActiveGithub ? candidate.activeGithub : true
        )
        .filter((candidate) =>
          input.showMatchingLocation ? candidate.matchedLocation : true
        )
        .sort((a, b) => b.score - a.score)
        .slice(0, 100);

      return topCandidatesWithScores;
    }),
  getPendingSimilarProfiles: publicProcedure.query(async ({ ctx }) => {
    const pendingSimilarProfiles = await ctx.db
      .select()
      .from(schema.profileQueue);

    return pendingSimilarProfiles;
  }),
  deletePendingSimilarProfiles: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input: { id } }) => {
      await ctx.db
        .delete(schema.profileQueue)
        .where(eq(schema.profileQueue.id, id));
    }),
});
