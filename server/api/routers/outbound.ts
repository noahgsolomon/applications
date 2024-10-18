import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";
import OpenAI from "openai";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { Resource } from "sst";
import { parse } from "json2csv";
import { TRPCError } from "@trpc/server";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

export const outboundRouter = createTRPCRouter({
  insertIntoQueue: publicProcedure
    .input(
      z.object({
        payload: z.any(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // const { payload } = input;

      const similarProfileQueries = await ctx.db.query.profileQueue.findMany();

      if (similarProfileQueries.length > 0) {
        return;
      }
      const sqsClient = new SQSClient({ region: "us-east-1" });

      const queueUrl = Resource.SortQueue.url;

      if (!queueUrl) {
        throw new Error("Queue URL not configured");
      }

      try {
        const command = new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(input.payload),
        });

        const response = await sqsClient.send(command);

        return {
          success: true,
          messageId: response.MessageId,
        };
      } catch (error) {
        console.error("Error sending message to SQS:", error);
        throw new Error("Error sending message to SQS");
      }
    }),
  downloadAsCsv: publicProcedure
    .input(z.array(z.any()))
    .mutation(async ({ input }) => {
      try {
        const csvData = input.map((candidate) => {
          const data = candidate;

          return {
            name: data.name || "",
            email: data.email || "",
            githubUrl:
              data.githubUrl || `https://github.com/${data.githubLogin}`,
            isWhopUser: data.isWhopUser || false,
            mostUsedLanguage: data.mostUsedLanguage || "",
            mostStarredLanguage: data.mostStarredLanguage || "",
            followers: data.followers || 0,
            followerRatio: data.followerToFollowingRatio || 0,
            contributionYears: Array.isArray(data.contributionYears)
              ? data.contributionYears.join(", ")
              : data.contributionYears || "",
            totalCommits: data.totalCommits || 0,
            totalStars: data.totalStars || 0,
            totalRepositories: data.totalRepositories || 0,
            totalForks: data.totalForks || 0,
            location: data.location || "",
            score: candidate.score
              ? parseFloat(candidate.score).toFixed(4)
              : "",
            activeGithubScore: candidate.activeGithubScore
              ? parseFloat(candidate.activeGithubScore).toFixed(4)
              : "",
          };
        });

        const fields = [
          "name",
          "email",
          "githubUrl",
          "isWhopUser",
          "mostUsedLanguage",
          "mostStarredLanguage",
          "followers",
          "followerRatio",
          "contributionYears",
          "totalCommits",
          "totalStars",
          "location",
          "score",
          "activeGithubScore",
          "totalRepositories",
          "totalForks",
        ];

        const csv = parse(csvData, { fields });

        return {
          csv,
          filename: "filtered_candidates.csv",
        };
      } catch (error) {
        console.error("Error generating CSV:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to generate CSV",
        });
      }
    }),
});
