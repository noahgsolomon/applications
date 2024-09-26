import { Octokit } from "@octokit/rest";
import * as dotenv from "dotenv";

dotenv.config();

interface GitHubUser {
  login: string;
  name: string | null;
  email: string | null;
  location: string | null;
  bio: string | null;
}

class GitHubAPI {
  private octokit: Octokit;

  constructor() {
    this.octokit = new Octokit();
  }

  async searchCommitsByEmail(email: string): Promise<string[]> {
    const usernames = new Set<string>();

    const searchCommits = async (page: number): Promise<void> => {
      try {
        const result = await this.octokit.rest.search.commits({
          q: `author-email:${email}`,
          per_page: 10,
          page,
        });

        result.data.items.forEach((item) => {
          if (item.author?.login) {
            usernames.add(item.author.login);
          }
        });

        if (result.data.items.length === 100) {
          await searchCommits(page + 1);
        }
      } catch (error: any) {
        console.error(
          `Error searching commits on page ${page}:`,
          error.message,
        );
        if (error.status === 401) {
          console.error(
            "Authentication failed. Please check your GitHub token.",
          );
        }
        throw error;
      }
    };

    await searchCommits(1);
    return Array.from(usernames);
  }

  async getUserDetails(username: string): Promise<GitHubUser | null> {
    try {
      const result = await this.octokit.rest.users.getByUsername({ username });
      return {
        login: result.data.login,
        name: result.data.name,
        email: result.data.email,
        location: result.data.location,
        bio: result.data.bio,
      };
    } catch (error: any) {
      console.error(
        `Error fetching details for user ${username}:`,
        error.message,
      );
      return null;
    }
  }
}

async function findGitHubUsersByEmail(email: string): Promise<GitHubUser[]> {
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubToken) {
    throw new Error("GitHub token is not set in the environment variables");
  }

  const api = new GitHubAPI();
  let usernames: string[] = [];
  try {
    usernames = await api.searchCommitsByEmail(email);
  } catch (error) {
    console.error(
      "Failed to search commits by email. Proceeding with an empty list of usernames.",
    );
  }

  const users: GitHubUser[] = [];

  for (const username of usernames) {
    const userDetails = await api.getUserDetails(username);
    if (userDetails) {
      users.push(userDetails);
    }
  }

  return users;
}

async function validateGitHubToken(token: string): Promise<boolean> {
  const octokit = new Octokit({ auth: token });
  try {
    const { data } = await octokit.rest.users.getAuthenticated();
    console.log("Token is valid. Authenticated as:", data.login);
    return true;
  } catch (error: any) {
    console.error("Token validation failed:", error.message);
    return false;
  }
}

async function main() {
  try {
    const githubToken = process.env.GITHUB_TOKEN;
    console.log(
      "GitHub Token (first 10 characters):",
      githubToken ? githubToken.substring(0, 10) + "..." : "Not set",
    );

    if (!githubToken) {
      throw new Error("GitHub token is not set in the environment variables");
    }
    //
    // const isTokenValid = await validateGitHubToken(githubToken);
    // if (!isTokenValid) {
    //   throw new Error(
    //     "Invalid GitHub token. Please check your token and try again.",
    //   );
    // }

    // Your existing code to search for email goes here
    const email = "noahsolomon2003@gmail.com";
    const users = await findGitHubUsersByEmail(email);
    console.log(`GitHub users associated with ${email}:`, users);
  } catch (error: any) {
    console.error("An error occurred in the main function:", error.message);
  }
}

main();
