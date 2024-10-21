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
        limit: 500,
      });

      let topCandidatesIdsWithScores = topCandidates
        .map((candidate) => {
          const idResponse = input.allIdsResponse.find(
            (id: any) => id.id === candidate.id
          );
          return {
            data: candidate as { id: string },
            score: (idResponse?.score ?? 0) as number,
            matchedLocation: idResponse?.matchedLocation as
              | { score: number; location: string }
              | undefined,
            activeGithub: idResponse?.activeGithub as boolean | undefined,
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

      const topCandidatesWithScoresData = await ctx.db.query.people.findMany({
        where: inArray(
          schema.people.id,
          topCandidatesIdsWithScores.map((candidate) => candidate.data.id)
        ),
      });

      const topCandidatesWithScores = topCandidatesWithScoresData.map(
        (candidate) => {
          const candidateWithScore = topCandidatesIdsWithScores.find(
            (c) => c.data.id === candidate.id
          );
          const { data, ...candidateWithScoreWithoutData } =
            candidateWithScore || {};
          return { data: { ...candidate }, ...candidateWithScoreWithoutData };
        }
      );

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
