import fs from "fs";
import path from "path";
import { parse } from "json2csv";
import { processFilterCriteria } from "../src/sort";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "../server/db/schemas/users/schema";

const pool = new Pool({ connectionString: process.env.DB_URL });
export const db = drizzle(pool, {
  schema,
});

// Define the FilterCriteria interface
interface FilterCriteria {
  query: string;
  companyIds: {
    values: string[];
    weight: number;
  };
  otherCompanyNames: {
    values: string[];
    weight: number;
  };
  job: {
    value: string;
    weight: number;
  };
  skills: {
    values: { skill: string; weight: number }[];
  };
  location: {
    value: string;
    weight: number;
  };
  schools: {
    values: string[];
    weight: number;
  };
  fieldsOfStudy: {
    values: string[];
    weight: number;
  };
  whopUser: {
    value: boolean;
    weight: number;
  };
  activeGithub: {
    value: boolean;
    weight: number;
  };
}

async function main() {
  const filterCriteria: FilterCriteria = {
    query: "",
    companyIds: {
      values: [],
      weight: 0,
    },
    otherCompanyNames: {
      values: [],
      weight: 0,
    },
    job: {
      value: "",
      weight: 0,
    },
    skills: {
      values: [
        { skill: "nextjs", weight: 10 },
        { skill: "ruby", weight: 10 },
        { skill: "swift", weight: 10 },
      ],
    },
    location: {
      value: "New York",
      weight: 15,
    },
    schools: {
      values: [],
      weight: 0,
    },
    fieldsOfStudy: {
      values: [],
      weight: 0,
    },
    whopUser: {
      value: true,
      weight: 15,
    },
    activeGithub: {
      value: true,
      weight: 40,
    },
  };

  try {
    // Call the processFilterCriteria function
    const candidates = await processFilterCriteria(filterCriteria);

    // Filter out candidates without githubLogin
    const filteredCandidates = candidates.filter(
      (candidate) => candidate.data?.githubLogin
    );

    // Map the filtered candidates to the required attributes
    const csvData = filteredCandidates.map((candidate) => {
      const { data, score, activeGithubScore } = candidate;

      // Extract the top language (assuming it's the first in githubLanguages)
      const mostUsedLanguage = data?.githubLanguages
        ? Object.entries(data.githubLanguages).sort(
            (a, b) => b[1].repoCount - a[1].repoCount
          )[0]?.[0] || ""
        : "";
      const mostStarredLanguage = data?.githubLanguages
        ? Object.entries(data.githubLanguages).sort(
            (a, b) => b[1].stars - a[1].stars
          )[0]?.[0] || ""
        : "";

      return {
        name: data?.name || "",
        email: data?.email || "",
        githubUrl: `https://github.com/${data?.githubLogin}`,
        isWhopUser: data?.isWhopUser || false,
        mostUsedLanguage,
        mostStarredLanguage,
        followers: data?.followers || 0,
        followerRatio: data?.followerToFollowingRatio || 0,
        contributionYears: data?.contributionYears
          ? data.contributionYears.join(", ")
          : "",
        totalCommits: data?.totalCommits || 0,
        totalStars: data?.totalStars || 0,
        totalRepositories: data?.totalRepositories || 0,
        totalForks: data?.totalForks || 0,
        location: data?.normalizedLocation || "",
        score: score.toFixed(4),
        activeGithubScore: activeGithubScore
          ? activeGithubScore.toFixed(4)
          : "",
      };
    });

    // Define CSV fields
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

    const outputPath = path.join(__dirname, "filtered_candidates.csv");
    fs.writeFileSync(outputPath, csv);

    console.log(`CSV file saved to ${outputPath}`);
  } catch (error) {
    console.error("An error occurred:", error);
  }
}

main();
