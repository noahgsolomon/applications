import { graphql } from "@octokit/graphql";
import * as dotenv from "dotenv";

dotenv.config({ path: "../.env" });
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

if (!GITHUB_TOKEN) {
  throw new Error("GitHub token is required in .env file");
}

const fetchUserDetails = async (username: string) => {
  const query = `
    query($login: String!) {
      user(login: $login) {
        name
        followers {
          totalCount
        }
        following {
          totalCount
        }
        sponsors {
          totalCount
        }
        sponsorshipsAsSponsor(first: 10) {
          nodes {
            sponsorable {
              ... on User {
                login
              }
              ... on Organization {
                login
              }
            }
          }
        }
        organizations(first: 100) {
          totalCount
          nodes {
            login
            name
            description
            membersWithRole(first: 100) {
              totalCount
              nodes {
                login
                name
              }
            }
          }
        }
        repositories(first: 100, orderBy: {field: STARGAZERS, direction: DESC}, ownerAffiliations: OWNER, isFork: false) {
          totalCount
          nodes {
            name
            stargazerCount
            forkCount
            primaryLanguage {
              name
            }
            description
            collaborators(first: 10) {
              totalCount
              nodes {
                login
              }
            }
            repositoryTopics(first: 10) {
              nodes {
                topic {
                  name
                }
              }
            }
          }
        }
        contributionsCollection {
          contributionYears
          totalCommitContributions
          restrictedContributionsCount
          commitContributionsByRepository(maxRepositories: 100) {
            contributions {
              totalCount
            }
            repository {
              name
              owner {
                login
                ... on Organization {
                  name
                  description
                  membersWithRole {
                    totalCount
                  }
                }
              }
              isPrivate
              stargazerCount
            }
          }
        }
      }
    }
  `;

  try {
    const result = await graphql<{ user: any }>({
      query,
      login: username,
      headers: {
        authorization: `Bearer ${GITHUB_TOKEN}`,
      },
    });

    const user = result.user;

    // Followers to Following Ratio
    const followers = user.followers.totalCount;
    const following = user.following.totalCount;
    const followerToFollowingRatio =
      following === 0 ? followers : (followers / following).toFixed(2);

    console.log(`Name: ${user.name}`);
    console.log(`Followers: ${followers}`);
    console.log(`Following: ${following}`);
    console.log(`Followers to Following Ratio: ${followerToFollowingRatio}`);
    console.log(
      "Contribution Years:",
      user.contributionsCollection.contributionYears,
    );
    console.log(
      "Total Commit Contributions:",
      user.contributionsCollection.totalCommitContributions,
    );
    console.log(
      "Restricted (Private) Contributions:",
      user.contributionsCollection.restrictedContributionsCount,
    );

    let totalStars = 0;
    let totalForks = 0;
    const languagesMap: {
      [language: string]: { repoCount: number; stars: number };
    } = {};
    const contributors: string[] = [];
    const topics: string[] = [];

    // Collect repository data
    user.repositories.nodes.forEach((repo: any) => {
      totalStars += repo.stargazerCount;
      totalForks += repo.forkCount;

      if (repo.primaryLanguage) {
        const language = repo.primaryLanguage.name;
        if (languagesMap[language]) {
          languagesMap[language].repoCount += 1;
          languagesMap[language].stars += repo.stargazerCount;
        } else {
          languagesMap[language] = { repoCount: 1, stars: repo.stargazerCount };
        }
      }

      // Collaborators
      repo.collaborators.nodes.forEach((collaborator: any) => {
        if (!contributors.includes(collaborator.login)) {
          contributors.push(collaborator.login);
        }
      });

      // Repository Topics
      repo.repositoryTopics.nodes.forEach((topic: any) => {
        if (!topics.includes(topic.topic.name)) {
          topics.push(topic.topic.name);
        }
      });
    });

    console.log(`\nTotal Repositories: ${user.repositories.totalCount}`);
    console.log(`Total Stars: ${totalStars}`);
    console.log(`Total Forks: ${totalForks}`);

    console.log("\nMost Popular Technologies Used:");
    const sortedLanguages = Object.entries(languagesMap).sort(
      (a, b) => b[1].repoCount - a[1].repoCount,
    );
    sortedLanguages.forEach(([language, data]) => {
      console.log(
        `${language}: ${data.repoCount} repo(s) (${data.stars} stars)`,
      );
    });

    console.log("\nUnique Contributors:");
    contributors.forEach((contributor) => {
      console.log(`- ${contributor}`);
    });

    console.log("\nUnique Topics:");
    topics.forEach((topic) => {
      console.log(`- ${topic}`);
    });

    console.log("\nContributions to Repositories Not Owned:");
    const externalContributions =
      user.contributionsCollection.commitContributionsByRepository
        .filter((repo: any) => repo.repository.owner.login !== username)
        .sort(
          (a: any, b: any) =>
            b.contributions.totalCount - a.contributions.totalCount,
        );

    externalContributions.forEach((repo: any) => {
      console.log(
        `Repository: ${repo.repository.owner.login}/${repo.repository.name}`,
      );
      console.log(`Commits: ${repo.contributions.totalCount}`);
      console.log(`Stars: ${repo.repository.stargazerCount}`);
      console.log(`Private: ${repo.repository.isPrivate}`);
      if (repo.repository.owner.__typename === "Organization") {
        console.log(`Organization Name: ${repo.repository.owner.name}`);
        console.log(
          `Organization Description: ${repo.repository.owner.description || "N/A"}`,
        );
        console.log(
          `Organization Members: ${repo.repository.owner.membersWithRole.totalCount}`,
        );
      }
      console.log("---");
    });

    console.log(
      `\nTotal External Repositories Contributed To: ${externalContributions.length}`,
    );
    const totalExternalCommits = externalContributions.reduce(
      (sum: number, repo: any) => sum + repo.contributions.totalCount,
      0,
    );
    console.log(`Total External Commits: ${totalExternalCommits}`);

    console.log("\nProjects Sponsored:");
    user.sponsorshipsAsSponsor.nodes.forEach((sponsorship: any) => {
      console.log(`- ${sponsorship.sponsorable.login}`);
    });

    console.log(`\nTotal Sponsors: ${user.sponsors.totalCount}`);

    console.log("\nOrganizations:");
    if (user.organizations.totalCount > 0) {
      user.organizations.nodes.forEach((org: any) => {
        console.log(`- ${org.name} (${org.login})`);
        if (org.description) {
          console.log(`  Description: ${org.description}`);
        }
        console.log(`  Members (${org.membersWithRole.totalCount}):`);
        org.membersWithRole.nodes.forEach((member: any) => {
          console.log(`    - ${member.name || member.login}`);
        });
        console.log();
      });
    } else {
      console.log("User is not a member of any organizations.");
    }
  } catch (error) {
    console.error("Error fetching user details:", error);
  }
};

// Replace 'username' with the GitHub username you want to query
fetchUserDetails("noahgsolomon");
