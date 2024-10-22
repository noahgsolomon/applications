import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "../trpc";
import {
  company as companyTable,
  people,
} from "@/server/db/schemas/users/schema";
import OpenAI from "openai";
import { inArray } from "drizzle-orm";
import { InferResultType } from "@/utils/infer";
import { Pinecone } from "@pinecone-database/pinecone";
import { jsonArrayContains } from "@/lib/utils";

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
export const companyRouter = createTRPCRouter({
  findRelevantCompanies: publicProcedure
    .input(z.object({ query: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const companies = await ctx.db.query.company.findMany();

      const companyNames = companies.map((company) => company.name);

      // Step 1: Standardize the input query to technologies, specialties, and features
      const completion = await openai.chat.completions.create({
        messages: [
          {
            role: "system",
            content: `
You will be provided with multiple technology terms and or specialties/features. OR, you will be provided a list of company names. If any company is mentioned, find the company names from the following list: ${companyNames.join(
              ", "
            )}. 
        If no company in this list is in their query or if their query has no mention of a company, then your task is to standardize it into three categories: technologies, specialties, and features.
- Technologies are specific programming languages, frameworks, or tools (e.g., "JavaScript", "Ruby on Rails", "Next.js").
- Specialties describe the type of company or domain (e.g., "Version control", "Web browser", "Open source project hosting").
- Features are technical features being queried, such as "live messaging", "notifications", or "tab management".

If the input is already standardized, return it as is.

Respond only with a JSON object that has four fields: "standardizedTechs", "standardizedSpecialties", and "standardizedFeatures", "companyNames". Each should be an array of standardized terms.
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
        max_tokens: 1024,
      });

      const standardizedResponse = JSON.parse(
        completion.choices[0].message.content ?? "{}"
      );

      console.log(
        "Standardized response:",
        JSON.stringify(standardizedResponse, null, 2)
      );

      const standardizedTechs: string[] =
        standardizedResponse.standardizedTechs?.map((tech: string) =>
          tech.toLowerCase()
        ) ?? [];
      const standardizedSpecialties: string[] = [
        ...standardizedResponse.standardizedFeatures?.map((feature: string) =>
          feature.toLowerCase()
        ),
        ...standardizedResponse.standardizedSpecialties?.map(
          (specialty: string) => specialty.toLowerCase()
        ),
      ];
      const standardizedFeatures: string[] = [
        ...standardizedResponse.standardizedFeatures?.map((feature: string) =>
          feature.toLowerCase()
        ),
        ...standardizedResponse.standardizedSpecialties?.map(
          (specialty: string) => specialty.toLowerCase()
        ),
      ];

      const companiesDB = await ctx.db.query.company.findMany({
        where: inArray(companyTable.name, standardizedResponse.companyNames),
      });

      if (
        companiesDB.length > 0 &&
        standardizedTechs.length === 0 &&
        standardizedSpecialties.length === 0 &&
        standardizedFeatures.length === 0
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

      // Step 2: Query Pinecone to get the most similar technologies, specialties, and features for each standardized term
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

      // Step 3: Fetch all companies from the database without related candidates
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

      // Step 4: Iterate over the companies list and fetch related candidates as needed
      for (const company of companiesList) {
        let score = 0;
        let matchesAllTechs = true;

        // Ensure each technology has a match in the company
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

        // Ensure all specified features have a match if features are not empty
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

        // Ensure all specified specialties have a match if specialties are not empty
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

        // Add company only if it matches all criteria
        if (matchesAllTechs && (matchesAllFeatures || matchesAllSpecialties)) {
          matchingCompanies.push(company);
          companyScores[company.id] = score;
        }
      }

      // Sort matching companies by score
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
    const companies = await ctx.db.query.company.findMany();

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
    return companies;
  }),
});
