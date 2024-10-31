import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";
import {
  company as companyTable,
  people,
  vcInvestorsVectors,
} from "@/server/db/schemas/users/schema";
import OpenAI from "openai";
import { cosineDistance, eq, inArray, isNotNull } from "drizzle-orm";
import { InferResultType } from "@/utils/infer";
import { Pinecone } from "@pinecone-database/pinecone";
import { jsonArrayContains, jsonArrayContainsAny } from "@/lib/utils";
import { gt, sql } from "drizzle-orm";

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

async function getEmbeddingPgVector(text: string) {
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
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

async function querySimilarFeatures(feature: string) {
  try {
    console.log(`Getting embedding for feature: ${feature}`);
    const featureEmbedding = await getEmbedding(feature);
    console.log(`Got embedding for feature: ${feature}`);

    const queryResponse = await index.namespace("company-features").query({
      topK: 400,
      vector: featureEmbedding,
      includeMetadata: true,
      includeValues: false,
    });

    const similarFeatures = queryResponse.matches
      .filter((match) => (match.score ?? 0) > 0.6)
      .map((match) => ({
        feature: match.metadata?.feature as string,
        score: match.score ?? 0,
        companyId: match.metadata?.companyId as string,
      }));

    return similarFeatures;
  } catch (error) {
    console.error("Error querying similar features:", error);
    return [];
  }
}

async function querySimilarSpecialties(specialty: string) {
  try {
    console.log(`Getting embedding for specialty: ${specialty}`);
    const specialtyEmbedding = await getEmbedding(specialty);
    console.log(`Got embedding for specialty: ${specialty}`);

    const queryResponse = await index.namespace("company-specialties").query({
      topK: 400,
      vector: specialtyEmbedding,
      includeMetadata: true,
      includeValues: false,
    });

    const similarSpecialties = queryResponse.matches
      .filter((match) => (match.score ?? 0) > 0.6)
      .map((match) => ({
        specialty: match.metadata?.specialty as string,
        score: match.score ?? 0,
        companyId: match.metadata?.companyId as string,
      }));

    return similarSpecialties;
  } catch (error) {
    console.error("Error querying similar specialties:", error);
    return [];
  }
}

async function querySimilarVcInvestors(vcInvestor: string, db: any) {
  try {
    console.log(`Getting embedding for VC investor: ${vcInvestor}`);
    const vcEmbedding = await getEmbeddingPgVector(vcInvestor);
    console.log(`Got embedding for VC investor: ${vcInvestor}`);

    const similarity = sql<number>`1 - (${cosineDistance(
      vcInvestorsVectors.vector,
      vcEmbedding
    )})`;

    const similarVcInvestors = await db
      .select({
        vcInvestor: vcInvestorsVectors.vcInvestor,
        companyIds: vcInvestorsVectors.companyIds,
        similarity,
      })
      .from(vcInvestorsVectors)
      .where(gt(similarity, 0.8))
      .orderBy(similarity)
      .limit(200);

    return similarVcInvestors.map((result: any) => ({
      vcInvestor: result.vcInvestor,
      score: result.similarity,
      companyIds: result.companyIds,
    }));
  } catch (error) {
    console.error("Error querying similar VC investors:", error);
    return [];
  }
}

export const companyRouter = createTRPCRouter({
  findRelevantCompanies: publicProcedure
    .input(z.object({ query: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const companies = await ctx.db.query.company.findMany();
      const companyNames = companies.map((company) => company.name);

      const completion = await openai.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `You are a helpful assistant that processes search queries about companies and VC investors.
You will be provided with multiple technology terms and or specialties/features, OR you will be provided a list of company names OR VC investor names. If any company is mentioned, find the company names from the following list: ${companyNames.join(
              ", "
            )}. 

If no company in this list is in their query or if their query has no mention of a company, then your task is to standardize it into four categories: technologies, specialties, features, and vcInvestors.

- Technologies are specific programming languages, frameworks, or tools (e.g., "JavaScript", "Ruby on Rails", "Next.js").
- Specialties describe the type of company or domain (e.g., "Version control", "Web browser", "Open source project hosting").
- Features are technical features being queried, such as "live messaging", "notifications", or "tab management".
- VC Investors are venture capital firms or investment companies (e.g., "Andreessen Horowitz", "Sequoia Capital", "Y Combinator").

If the input is already standardized, return it as is.

Return your response in this exact JSON format:
{
  "standardizedTechs": [],
  "standardizedSpecialties": [],
  "standardizedFeatures": [],
  "standardizedVcInvestors": [],
  "companyNames": []
}

Make sure to only include relevant terms in each category and leave arrays empty if no relevant terms are found.`,
          },
          {
            role: "user",
            content: input.query,
          },
        ],
        model: "gpt-4",
        temperature: 0,
        max_tokens: 1024,
      });

      let standardizedResponse;
      try {
        standardizedResponse = JSON.parse(
          completion.choices[0].message.content ?? "{}"
        );
      } catch (error) {
        console.error("Error parsing GPT response:", error);
        console.log("Raw response:", completion.choices[0].message.content);
        standardizedResponse = {
          standardizedTechs: [],
          standardizedSpecialties: [],
          standardizedFeatures: [],
          standardizedVcInvestors: [],
          companyNames: [],
        };
      }

      console.log(
        "Standardized response:",
        JSON.stringify(standardizedResponse, null, 2)
      );

      const standardizedTechs: string[] =
        standardizedResponse.standardizedTechs?.map((tech: string) =>
          tech.toLowerCase()
        ) ?? [];
      const standardizedSpecialties: string[] =
        standardizedResponse.standardizedSpecialties?.map((specialty: string) =>
          specialty.toLowerCase()
        ) ?? [];
      const standardizedFeatures: string[] =
        standardizedResponse.standardizedFeatures?.map((feature: string) =>
          feature.toLowerCase()
        ) ?? [];
      const standardizedVcInvestors: string[] =
        standardizedResponse.standardizedVcInvestors?.map((vc: string) =>
          vc.toLowerCase()
        ) ?? [];

      const allVcInvestorsToSearch = await Promise.all(
        standardizedVcInvestors.map(
          async (vc) => await querySimilarVcInvestors(vc, ctx.db)
        )
      );

      console.log(
        "All VC investors to search:",
        JSON.stringify(allVcInvestorsToSearch, null, 2)
      );

      const vcCompanyIds = new Set<string>();
      allVcInvestorsToSearch.forEach((vcGroup: any) => {
        vcGroup.forEach(({ companyIds }: any) => {
          companyIds.forEach((id: string) => {
            console.log(`vcCompanyIds: ${id}`);
            vcCompanyIds.add(id);
          });
        });
      });

      console.log(
        `all vc investors to search: ${JSON.stringify(
          Array.from(vcCompanyIds),
          null,
          2
        )}`
      );

      const vcdCompanies = await ctx.db.query.company.findMany({
        where: inArray(companyTable.id, Array.from(vcCompanyIds)),
      });

      const companiesDB = await ctx.db.query.company.findMany({
        where: inArray(companyTable.name, [
          ...standardizedResponse.companyNames,
          ...vcdCompanies.map((c) => c.name),
        ]),
      });

      if (
        companiesDB.length > 0 &&
        standardizedTechs.length === 0 &&
        standardizedSpecialties.length === 0 &&
        standardizedFeatures.length === 0 &&
        standardizedVcInvestors.length === 0
      ) {
        return {
          valid: true,
          companies: companiesDB.map((company) => ({
            id: company.id,
            name: company.name,
            linkedinUrl: company.linkedinUrl,
            logo: company.logo,
          })),
          filters: [],
        };
      }

      console.log(
        "Standardized technologies:",
        JSON.stringify(standardizedTechs, null, 2)
      );

      const allTechnologiesToSearch: {
        score: number;
        technology: string;
      }[][] = await Promise.all(
        standardizedTechs.map(
          async (tech) => await querySimilarTechnologies(tech)
        )
      );

      console.log(
        allTechnologiesToSearch.map((s) => s.map((t) => t.technology))
      );

      const allFeaturesToSearch: {
        score: number;
        feature: string;
      }[][] = await Promise.all(
        standardizedFeatures.map(
          async (feature) => await querySimilarFeatures(feature)
        )
      );

      const allSpecialtiesToSearch: {
        score: number;
        specialty: string;
      }[][] = await Promise.all(
        standardizedSpecialties.map(
          async (specialty) => await querySimilarSpecialties(specialty)
        )
      );

      const companiesList = await ctx.db.query.company.findMany();

      const matchingCompanies: InferResultType<"company">[] = [];

      const companyScores: Record<string, number> = {};

      console.log(
        `allTechnologiesToSearch: ${allTechnologiesToSearch.map((s) =>
          s.map((t) => t.technology)
        )}`
      );
      console.log(
        `allFeaturesToSearch: ${JSON.stringify(allFeaturesToSearch, null, 2)}`
      );
      console.log(
        `allSpecialtiesToSearch: ${JSON.stringify(
          allSpecialtiesToSearch,
          null,
          2
        )}`
      );

      for (const company of companiesList) {
        console.log(`company: ${company.name}`);
        let score = 0;
        let matchesAllTechs = true;
        let matchesVcInvestors =
          standardizedVcInvestors.length === 0 || vcCompanyIds.has(company.id);

        for (const similarTechnologies of allTechnologiesToSearch) {
          const hasMatchingTechnology = similarTechnologies.some(
            ({ technology, score: techScore }) =>
              company.topTechnologies?.includes(technology)
          );

          if (!hasMatchingTechnology) {
            matchesAllTechs = false;
            break;
          } else {
            similarTechnologies
              .filter(({ technology }) =>
                company.topTechnologies?.includes(technology)
              )
              .map((res) => (score += res.score)) ?? 0;
          }
        }

        let matchesAllFeatures = true;
        if (standardizedFeatures.length > 0) {
          let hasHadMatchingFeature = false;
          for (const similarFeatures of allFeaturesToSearch) {
            const hasMatchingFeature = similarFeatures.some(({ feature }) =>
              company.topFeatures?.includes(feature)
            );

            if (hasMatchingFeature) {
              hasHadMatchingFeature = true;
              similarFeatures
                .filter(({ feature }) => company.topFeatures?.includes(feature))
                .map((res) => (score += res.score)) ?? 0;
            }
          }
          if (!hasHadMatchingFeature) {
            matchesAllFeatures = false;
          }
        }

        let matchesAllSpecialties = true;
        if (standardizedSpecialties.length > 0) {
          let hasHadMatchingSpecialty = false;
          for (const similarSpecialties of allSpecialtiesToSearch) {
            const hasMatchingSpecialty = similarSpecialties.some(
              ({ specialty }) => company.specialties?.includes(specialty)
            );

            if (hasMatchingSpecialty) {
              hasHadMatchingSpecialty = true;
              similarSpecialties
                .filter(({ specialty }) =>
                  company.specialties?.includes(specialty)
                )
                .map((res) => (score += res.score)) ?? 0;
            }
          }
          if (!hasHadMatchingSpecialty) {
            matchesAllSpecialties = false;
          }
        }

        console.log(`matched vcInvestors: ${matchesVcInvestors}`);

        if (
          matchesAllTechs &&
          matchesVcInvestors &&
          (matchesAllFeatures || matchesAllSpecialties)
        ) {
          matchingCompanies.push(company);
          companyScores[company.id] = score;

          if (vcCompanyIds.has(company.id)) {
            companyScores[company.id] += 1;
          }
        }
      }

      matchingCompanies.sort(
        (a, b) => companyScores[b.id] - companyScores[a.id]
      );

      console.log(
        "Matching companies:",
        matchingCompanies.map((c) => c.name + ` ${companyScores[c.id]}`)
      );

      return {
        valid: matchingCompanies.length > 0,
        companies: matchingCompanies.map((company) => ({
          id: company.id,
          name: company.name,
          linkedinUrl: company.linkedinUrl,
          logo: company.logo,
        })),
        filters: [
          ...standardizedTechs,
          ...Array.from(
            new Set([...standardizedFeatures, ...standardizedSpecialties])
          ),
        ],
      };
    }),

  companyFilter: publicProcedure
    .input(z.object({ query: z.string() }))
    .mutation(async ({ ctx, input }) => {
      console.log("Starting companyFilter mutation");
      console.log("Input received:", input);

      try {
        // Fetch all company names from the database
        const companies = await ctx.db.query.company.findMany({
          columns: {
            name: true,
          },
        });

        const companyNames = companies.map((company) => company.name);

        const firstCompletion = await openai.chat.completions.create({
          messages: [
            {
              role: "system",
              content: `
Given the search query, find the company names from the following list: ${companyNames.join(
                ", "
              )}.

Also, extract the job title, an array of skills, location, and the minimum GitHub stars count mentioned in the query.

- For the **skills**, normalize them because they might be slang (e.g., "rails" should be "Ruby on Rails"). Any technology mentioned can be considered a skill.
- For the **location**, extract any location mentioned in the query.
- For the **minGithubStars**, extract any minimum GitHub stars count mentioned.

Given a location, return the uppercase state name if it's a US location, or the uppercase country name if it's outside the US. If it's a city, return the state (for US) or country it's in. If unsure or the location is invalid, return "".
Examples:
- New York City -> NEW YORK
- New York -> NEW YORK
- London -> UNITED KINGDOM
- California -> CALIFORNIA
- Tokyo -> JAPAN
- Paris, France -> FRANCE
- Sydney -> AUSTRALIA
- 90210 -> CALIFORNIA


Return the result as a JSON object with the following structure:
{
  "companyNames": string[],
  "otherCompanyNames": string[],
  "job": string,
  "skills": string[],
  "location": string,
  "minGithubStars": number,
  "schools": string[],
  "fieldsOfStudy": string[]
}.

If no company they mentioned is in the list, return an empty array for "companyNames". For the companies mentioned not in the list, put those in "otherCompanyNames".
`,
            },
            {
              role: "user",
              content: input.query,
            },
          ],
          response_format: { type: "json_object" },
          model: "gpt-4o",
          temperature: 0,
          max_tokens: 512,
        });

        // Parse the responses
        const response = JSON.parse(
          firstCompletion.choices[0].message.content ??
            `{
            "valid": false,
            "message": "No response",
            "companyNames": [],
            "otherCompanyNames": [],
            "job": "",
            "skills": [],
            "location": "",
            "minGithubStars": 0,
            "schools": [],
            "fieldsOfStudy": [],
            "Or": false
          }`
        );

        let responseCompanyNames =
          response.companyNames.length > 0
            ? response.companyNames
            : companyNames;

        // Fetch companies from the database based on the extracted company names
        const companiesDB = await ctx.db.query.company.findMany({
          where: inArray(companyTable.name, responseCompanyNames),
          columns: {
            id: true,
            name: true,
            linkedinUrl: true,
            logo: true,
          },
        });

        if (!companiesDB || companiesDB.length === 0) {
          console.error(
            "No companies found or an error occurred during the DB query."
          );
          return {
            valid: true,
            message: "",
            companies: [],
            otherCompanyNames: response.otherCompanyNames,
            job: response.job,
            skills: response.skills,
            location: response.location,
            minGithubStars: response.minGithubStars,
            schools: response.schools,
            fieldsOfStudy: response.fieldsOfStudy,
            query: input.query,
          };
        }

        console.log("Returning final response.");
        return {
          valid: true,
          message: "Company found.",
          companies: companiesDB,
          otherCompanyNames: response.otherCompanyNames,
          job: response.job,
          skills: response.skills,
          location: response.location,
          minGithubStars: response.minGithubStars,
          schools: response.schools,
          fieldsOfStudy: response.fieldsOfStudy,
          query: input.query,
        };
      } catch (error) {
        console.error("Error during mutation:", error);
        throw new Error("An error occurred during the mutation.");
      }
    }),
  allActiveCompanies: publicProcedure.query(async ({ ctx }) => {
    const companies = await ctx.db.query.company.findMany({
      columns: {
        id: true,
        name: true,
        linkedinUrl: true,
        logo: true,
      },
    });

    return companies.map((company) => ({
      id: company.id,
      name: company.name,
      linkedinUrl: company.linkedinUrl,
      logo: company.logo,
    }));
  }),
  all60fpsDesignCompanies: publicProcedure.query(async ({ ctx }) => {
    const companies = await ctx.db.query.company.findMany({
      where: jsonArrayContains(companyTable.groups, ["60fps.design"]),
    });
    return companies.map((company) => ({
      id: company.id,
      name: company.name,
      linkedinUrl: company.linkedinUrl,
      logo: company.logo,
    }));
  }),
  allAppleDesignAwardCompanies: publicProcedure.query(async ({ ctx }) => {
    const companies = await ctx.db.query.company.findMany({
      where: jsonArrayContainsAny(companyTable.groups, ["apple-design-award"]),
    });
    return companies.map((company) => ({
      id: company.id,
      name: company.name,
      linkedinUrl: company.linkedinUrl,
      logo: company.logo,
    }));
  }),
  allVcInvestorsToSearch: publicProcedure.query(async ({ ctx }) => {
    const vcInvestors = await ctx.db.query.company.findMany({
      where: eq(companyTable.isVcInvestor, true),
    });
    return vcInvestors.map((vc) => ({
      id: vc.id,
      name: vc.name,
      linkedinUrl: vc.linkedinUrl,
      logo: vc.logo,
    }));
  }),
  allVcInvestorCompaniesToSearch: publicProcedure.query(async ({ ctx }) => {
    const vcInvestorCompanies = await ctx.db.query.company.findMany({
      where: isNotNull(companyTable.vcInvestors),
    });
    return vcInvestorCompanies.map((vc) => ({
      id: vc.id,
      name: vc.name,
      linkedinUrl: vc.linkedinUrl,
      logo: vc.logo,
    }));
  }),
});
