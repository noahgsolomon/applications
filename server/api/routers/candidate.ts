import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";
import * as schema from "@/server/db/schemas/users/schema";
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";

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
        columns: {
          id: true,
        },
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
