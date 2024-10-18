import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";
import {
  candidates,
  company as companyTable,
} from "@/server/db/schemas/users/schema";
import * as schema from "@/server/db/schemas/users/schema";
import OpenAI from "openai";
import { and, eq, exists, inArray, isNotNull, or } from "drizzle-orm";
import { jsonArrayContainsAny } from "@/lib/utils";
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
  findFilteredCandidates: publicProcedure
    .input(
      z.object({
        query: z.string(),
        job: z.string(),
        relevantRoleId: z.string().optional(),
        nearBrooklyn: z.boolean(),
        searchInternet: z.boolean(),
        skills: z.array(z.string()),
        booleanSearch: z.string().optional(),
        companyIds: z.array(z.string()),
        location: z.string().optional(),
        activeGithub: z.boolean().optional(),
        whopUser: z.boolean().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      console.log("Starting findFilteredCandidates mutation");
      const similarTechnologiesArrays = await Promise.all(
        input.skills.map((skill) => querySimilarTechnologies(skill))
      );

      let similarJobTitlesArray: string[] = [];
      if (input.job && input.job !== "") {
        similarJobTitlesArray = await querySimilarJobTitles(input.job);
      }

      try {
        console.log(
          "Similar technologies arrays:",
          similarTechnologiesArrays.flat()
        );

        const allSimilarTechnologies = similarTechnologiesArrays.flat();

        console.log("Expanded skills:", allSimilarTechnologies);

        const candidatesFiltered = await ctx.db.query.candidates.findMany({
          with: { company: true },
          where: (candidate, { and, eq, inArray }) => {
            let condition = or(
              eq(candidate.livesNearBrooklyn, true),
              eq(candidate.livesNearBrooklyn, false)
            );
            if (input.nearBrooklyn) {
              condition = eq(candidate.livesNearBrooklyn, true);
            }
            let skillCondition = undefined;
            if (input.skills.length > 0) {
              skillCondition = jsonArrayContainsAny(
                candidate.topTechnologies,
                allSimilarTechnologies.map((tech) => tech.technology)
              );
            }
            let jobTitleCondition = undefined;
            if (similarJobTitlesArray.length > 0) {
              jobTitleCondition = jsonArrayContainsAny(
                candidate.jobTitles,
                similarJobTitlesArray
              );
            }
            return and(
              condition,
              skillCondition,
              exists(
                ctx.db
                  .select()
                  .from(companyTable)
                  .where(
                    and(
                      inArray(companyTable.id, input.companyIds),
                      eq(candidate.companyId, companyTable.id)
                    )
                  )
              ),
              jobTitleCondition
            );
          },
        });

        // Sort candidates based on the number of matching skills
        const sortedCandidates = candidatesFiltered
          .map((candidate) => {
            const matchingSkillsCount = allSimilarTechnologies.filter((tech) =>
              candidate.topTechnologies?.includes(tech.technology)
            ).length;
            return { ...candidate, matchingSkillsCount };
          })
          .sort((a, b) => b.matchingSkillsCount - a.matchingSkillsCount);

        // Truncate to 100 candidates
        const topCandidates = sortedCandidates.slice(0, 100);

        // Make fetch request for each candidate
        await Promise.all(
          topCandidates.map(async (candidate) => {
            try {
              const candidateDB = await ctx.db.query.candidates.findFirst({
                where: eq(candidates.id, candidate.id),
              });
              if (!candidateDB?.cookdReviewed) {
                // const response = await fetch("https://cookd.dev/api/score", {
                //   method: "POST",
                //   headers: {
                //     "Content-Type": "application/json",
                //   },
                //   body: JSON.stringify({
                //     resumeScreenerId: process.env.COOKD_RESUME_SCREENER_ID,
                //     slugId: process.env.COOKD_SLUG_ID,
                //     apiKey: process.env.COOKD_API_KEY,
                //     webhookUrl:
                //       "https://d2ft34rr19twyp.cloudfront.net/api/webhook",
                //     candidateJson: {
                //       id: candidate.id,
                //       first_name: candidate.linkedinData.firstName,
                //       last_name: candidate.linkedinData.lastName,
                //       ...candidate.linkedinData,
                //     },
                //   }),
                // });
                // const responseBody = await response.text();
                // console.log(responseBody);
              }
            } catch (error) {
              console.error(`Error scoring candidate ${candidate.id}:`, error);
            }
          })
        );

        return {
          valid: topCandidates.length > 0,
          message:
            topCandidates.length > 0
              ? "Relevant candidates found."
              : "No relevant candidates found.",
          candidates: topCandidates,
          query: input.query,
          job: input.job,
          skills: similarTechnologiesArrays.flat(),
          nearBrooklyn: input.nearBrooklyn,
          relevantRoleId: input.relevantRoleId ?? undefined,
        };
      } catch (error) {
        console.error("Error during findFilteredCandidates mutation:", error);
        throw new Error("An error occurred during the mutation.");
      }
    }),
});
