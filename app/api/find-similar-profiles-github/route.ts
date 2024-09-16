import { z } from "zod";
import { db } from "@/server/db";
import { githubUsers } from "@/server/db/schemas/users/schema";
import { eq, InferSelectModel } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  analyzeSimilarities,
  calculateSimilarityScore,
  fetchAllGitHubUsers,
  getOrFetchUser,
} from "@/scripts/github-centrifuge";

const inputSchema = z.object({
  githubUrls: z.array(z.string()),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const input = inputSchema.parse(body);

    console.log("Starting findSimilarGitHubProfiles");

    const inputUsers: InferSelectModel<typeof githubUsers>[] = [];
    for (const username of input.githubUrls.map((url) =>
      url.replace("https://github.com/", ""),
    )) {
      let user = await getOrFetchUser(username);

      if (user) {
        inputUsers.push(user);
      } else {
        console.error(
          `Failed to fetch or insert user for username: ${username}`,
        );
      }
    }

    if (inputUsers.length === 0) {
      console.log("No matching input users found");
      return NextResponse.json(
        { message: "No matching input users found in the database." },
        { status: 404 },
      );
    }

    console.log(`Found ${inputUsers.length} matching input users.`);

    // Analyze similarities among input users
    const similarities = analyzeSimilarities(inputUsers);

    // Fetch all GitHub users
    const allUsers = await fetchAllGitHubUsers();
    console.log(`Fetched ${allUsers.length} GitHub users from the database.`);

    // Calculate similarity scores
    const similarityScores = allUsers.map((user) => ({
      user,
      similarityScore: calculateSimilarityScore(user, similarities),
    }));

    // Filter out input users and sort by similarity score
    const inputUserIds = new Set(inputUsers.map((user) => user.id));
    const topSimilarUsers = similarityScores
      .filter((score) => !inputUserIds.has(score.user.id))
      .sort((a, b) => b.similarityScore - a.similarityScore)
      .slice(0, 100);

    return NextResponse.json({
      success: true,
      message: "Similar GitHub profiles found based on various factors.",
      similarProfiles: topSimilarUsers.map(({ user, similarityScore }) => ({
        ...user,
        similarityScore,
      })),
    });
  } catch (error) {
    console.error("Error in findSimilarGitHubProfiles:", error);
    return NextResponse.json(
      { message: "An error occurred while finding similar GitHub profiles." },
      { status: 500 },
    );
  }
}
