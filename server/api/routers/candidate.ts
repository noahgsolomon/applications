import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";
import * as schema from "@/server/db/schemas/users/schema";
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";

export const candidateRouter = createTRPCRouter({
  getAbsoluteFilteredTopCandidates: publicProcedure
    .input(z.any())
    .mutation(async ({ ctx, input }) => {
      console.log("starting getAbsoluteFilteredTopCandidates");
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
      console.log("finished conditions");
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
      console.log("finished finding top candidates");

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
            whopMutuals: idResponse?.whopMutuals as number | undefined,
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

      console.log("finished sorting and slicing");

      const topCandidatesWithScoresData = await ctx.db.query.people.findMany({
        columns: {
          id: true,
          name: true,
          email: true,
          linkedinData: true,
          linkedinUrl: true,
          githubLogin: true,
          githubBio: true,
          githubImage: true,
          githubLanguages: true,
          twitterBio: true,
          twitterUsername: true,
          image: true,
          location: true,
          isWhopUser: true,
          isWhopCreator: true,
          jobTitles: true,
          topTechnologies: true,
          topFeatures: true,
          miniSummary: true,
          normalizedLocation: true,
          organizations: true,
          githubCompany: true,
          twitterData: true,
        },
        where: inArray(
          schema.people.id,
          topCandidatesIdsWithScores.map((candidate) => candidate.data.id)
        ),
      });

      console.log("finished finding top candidates with scores data");

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

      console.log("finished mapping top candidates with scores");

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
