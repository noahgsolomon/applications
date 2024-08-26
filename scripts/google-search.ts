import axios from "axios";
import dotenv from "dotenv";
// @ts-ignore
import { v4 as uuid } from "uuid";
import * as userSchema from "../server/db/schemas/users/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq, inArray, or } from "drizzle-orm";
import OpenAI from "openai";

dotenv.config({
  path: "../.env",
});

const connection = neon(process.env.DB_URL!);
const db = drizzle(connection, {
  schema: {
    ...userSchema,
  },
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const generateSummary = async (profileData: any) => {
  console.log("Generating summary for profile data...");
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          "You are to take in this person's LinkedIn profile data, and generate a list of their hard skills amount of experience and specification",
      },
      {
        role: "user",
        content: JSON.stringify(profileData),
      },
    ],
    response_format: { type: "text" },
    model: "gpt-4o-mini",
    temperature: 0,
    max_tokens: 2048,
  });
  console.log("Summary generated.");
  return completion.choices[0].message.content;
};

export const googleSearch = async (query: string) => {
  console.log(`Starting Google search with query: ${query}`);
  const apiKey = process.env.GOOGLE_API_KEY!;
  const cseId = process.env.GOOGLE_CSE_ID!;
  const resultsPerPage = 10;
  const maxResults = 100;
  let allLinkedinUrls: string[] = [];

  for (let start = 1; start < maxResults; start += resultsPerPage) {
    const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cseId)}&start=${start}`;

    try {
      const response = await axios.get(url);
      console.log("Search results fetched successfully.");
      const results = response.data.items || [];
      const linkedinUrls = results
        .filter((result: any) => result.link.includes("www.linkedin.com/in"))
        .map((result: any) => result.link);
      allLinkedinUrls = allLinkedinUrls.concat(linkedinUrls);

      if (linkedinUrls.length < resultsPerPage) {
        console.log("Fewer results than expected, stopping search.");
        break;
      }
    } catch (error) {
      console.error("Error fetching search results:", error);
      break;
    }
  }

  console.log(
    `Google search completed. Found ${allLinkedinUrls.length} LinkedIn URLs.`,
  );
  return allLinkedinUrls;
};

const scrapeLinkedInProfile = async (linkedinUrl: string) => {
  console.log(`Scraping LinkedIn profile for URL: ${linkedinUrl}`);
  const options = {
    method: "GET",
    url: `https://api.scrapin.io/enrichment/profile`,
    params: {
      apikey: process.env.SCRAPIN_API_KEY!,
      linkedInUrl: linkedinUrl,
    },
  };

  try {
    const response = await axios.request(options);
    console.log("Profile data fetched successfully.");
    return response.data;
  } catch (error) {
    console.error(`Error fetching LinkedIn profile data: ${error}`);
    return null;
  }
};

const checkCompanyMatch = async (profileData: any) => {
  console.log("Checking for matching company in the database...");
  let companiesWorkedAt = profileData.positions.positionHistory.map(
    (experience: any) => experience.linkedInId as string,
  );
  companiesWorkedAt = companiesWorkedAt.length > 0 ? companiesWorkedAt : [""];

  const storedCompanyWorkedAt = await db.query.company.findFirst({
    where: inArray(userSchema.company.linkedinId, companiesWorkedAt),
  });

  if (storedCompanyWorkedAt) {
    console.log("Matching company found.");
  } else {
    console.log("No matching company found.");
  }

  return storedCompanyWorkedAt;
};

const askCondition = async (condition: string) => {
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          'You are to return a valid parseable JSON object with one attribute "condition" which can either be true or false. All questions users ask will always be able to be answered in a yes or no. An example response would be { "condition": true }',
      },
      {
        role: "user",
        content: condition,
      },
    ],
    response_format: { type: "json_object" },
    model: "gpt-4o-mini",
    temperature: 0,
    max_tokens: 256,
  });

  const result = JSON.parse(
    completion.choices[0].message.content ?? '{ "condition": false }',
  ).condition as boolean;

  return result;
};

const generateMiniSummary = async (profileData: any) => {
  console.log("Generating mini summary...");
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          "You are to take in this person's LinkedIn profile data, and generate a 1-2 sentence summary of their experience",
      },
      {
        role: "user",
        content: JSON.stringify(profileData),
      },
    ],
    response_format: { type: "text" },
    model: "gpt-4o-mini",
    temperature: 0,
    max_tokens: 2048,
  });

  console.log("Mini summary generated.");
  return completion.choices[0].message.content;
};

const gatherTopSkills = async (profileData: any) => {
  console.log("Gathering top skills from profile data...");
  const skills = profileData.skills || [];
  const positions = profileData.positions.positionHistory
    .map((position: any) => position.description)
    .join(" ");

  const profileSummary = {
    skills,
    positions,
  };

  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          "You are to take in this person's LinkedIn profile data and generate a JSON object with three fields: 'tech', 'features', and 'isEngineer'. The 'tech' field should contain a JSON array of strings representing the hard tech skills they are most familiar with. The 'features' field should contain a JSON array of strings representing the top hard features they have worked on the most. The 'isEngineer' field should be a boolean value indicating whether this person is likely an engineer based on their profile.",
      },
      {
        role: "user",
        content: JSON.stringify(profileSummary),
      },
    ],
    response_format: { type: "json_object" },
    model: "gpt-4o-mini",
    max_tokens: 2048,
  });

  const result = JSON.parse(completion.choices[0].message.content ?? "") as {
    tech: string[];
    features: string[];
    isEngineer: boolean;
  };

  console.log("Top skills gathered.");
  return result;
};

const insertCandidate = async (profileData: any, companyId?: string) => {
  const existingCandidate = await db.query.candidates.findFirst({
    where: eq(userSchema.candidates.url, profileData.linkedInUrl),
  });
  if (existingCandidate) {
    console.log(
      `Candidate already exists in the database: ${profileData.linkedInUrl}`,
    );
    return;
  }
  console.log("Inserting candidate into the database...");
  const miniSummary = await generateMiniSummary(profileData);
  const { tech, features, isEngineer } = await gatherTopSkills(profileData);

  console.log("Checking additional conditions for candidate...");
  const workedInBigTech = await askCondition(
    `Has this person worked in big tech? ${JSON.stringify(
      profileData.positions.positionHistory.map(
        (experience: any) => experience.companyName,
      ),
      null,
      2,
    )} ${profileData.summary} ${profileData.headline}`,
  );

  const livesNearBrooklyn = await askCondition(
    `Does this person live within 50 miles of Brooklyn, New York, USA? Their location: ${profileData.location ?? "unknown location"} ${
      profileData.positions.positionHistory.length > 0
        ? `or ${JSON.stringify(profileData.positions.positionHistory[0], null, 2)}`
        : ""
    }`,
  );

  const summary = await generateSummary(profileData);

  const candidateId = uuid();
  await db.insert(userSchema.candidates).values({
    id: candidateId,
    url: profileData.linkedInUrl as string,
    linkedinData: profileData,
    companyId: companyId ?? undefined,
    miniSummary,
    summary,
    topTechnologies: tech,
    topFeatures: features,
    isEngineer,
    workedInBigTech,
    livesNearBrooklyn,
    createdAt: new Date(),
  });

  console.log(
    `Candidate ${profileData.firstName} ${profileData.lastName} inserted into the database. Candidate ID: ${candidateId}`,
  );
  return candidateId;
};

export const processUrls = async (urls: string[]) => {
  console.log(`Processing batch of ${urls.length} URLs...`);

  const normalizeUrl = (url: string) => {
    return url.endsWith("/") ? url.slice(0, -1) : url;
  };

  const promises = urls.map(async (url) => {
    console.log(`Processing URL: ${url}`);
    const normalizedUrl = normalizeUrl(url);

    const existingCandidate = await db.query.candidates.findFirst({
      where: or(
        eq(userSchema.candidates.url, normalizedUrl),
        eq(userSchema.candidates.url, `${normalizedUrl}/`),
      ),
    });
    if (existingCandidate) {
      console.log(`Candidate already exists in the database: ${url}`);
      return;
    }

    const profileData = await scrapeLinkedInProfile(url);

    if (profileData && profileData.success) {
      console.log(`Profile data successfully scraped for URL: ${url}`);
      const name =
        profileData.person.firstName + " " + profileData.person.lastName;
      const companyMatch = await checkCompanyMatch(profileData.person);

      if (companyMatch) {
        console.log(
          `Candidate ${name} has worked at a stored company: ${companyMatch.name}.`,
        );
        await insertCandidate(profileData.person, companyMatch.id);
      } else {
        console.log(`Candidate ${name} has no matching company.`);
        await insertCandidate(profileData.person, undefined);
      }
    } else {
      console.log(`Failed to scrape profile data for URL: ${url}`);
    }
  });

  await Promise.all(promises);
  console.log(
    `Batch processing complete. Waiting 2 seconds before proceeding to the next batch...`,
  );
};

const generateSearchQueries = (roles: string[], cities: string[]): string[] => {
  const queries: string[] = [];
  roles.forEach((role) => {
    cities.forEach((city) => {
      queries.push(`site:linkedin.com/in Stripe ${role} AND ${city}`);
    });
  });
  return queries;
};

const main = async () => {
  console.log("Main process started.");

  // Generate the queries
  const queries = [
    // Uber
    // "site:linkedin.com/in Uber Frontend Engineer AND Chicago",
    // "site:linkedin.com/in Uber Backend Engineer AND Boston",
    // "site:linkedin.com/in Uber Software Developer AND Los Angeles",
    // "site:linkedin.com/in Uber Mobile Engineer AND Miami",
    // "site:linkedin.com/in Uber Data Scientist AND Denver",
    // "site:linkedin.com/in Uber Full Stack Engineer AND Houston",
    // "site:linkedin.com/in Uber Machine Learning Engineer AND Toronto",
    // "site:linkedin.com/in Uber AI Engineer AND Vancouver",
    // "site:linkedin.com/in Uber QA Automation Engineer AND Seattle",
    // "site:linkedin.com/in Uber Software Engineer AND Berlin",
    // "site:linkedin.com/in Uber Platform Engineer AND Paris",
    // "site:linkedin.com/in Uber Data Engineer AND Madrid",
    // "site:linkedin.com/in Uber Product Engineer AND Milan",
    // "site:linkedin.com/in Uber Tech Lead AND Barcelona",
    // "site:linkedin.com/in Uber Engineering Manager AND Sydney",
    // "site:linkedin.com/in Uber Infrastructure Specialist AND Los Angeles",
    // "site:linkedin.com/in Uber DevOps Specialist AND Atlanta",
    // "site:linkedin.com/in Uber Cloud Engineer AND Boston",
    // "site:linkedin.com/in Uber Network Security Engineer AND New York",
    // "site:linkedin.com/in Uber Database Specialist AND Toronto",
    // "site:linkedin.com/in Uber IT Security Engineer AND Dublin",
    // "site:linkedin.com/in Uber Systems Engineer AND Zurich",
    // "site:linkedin.com/in Uber Cloud Infrastructure Engineer AND Dubai",
    // "site:linkedin.com/in Uber SRE Specialist AND Hong Kong",
    // "site:linkedin.com/in Uber IT Manager AND Berlin",
    // "site:linkedin.com/in Uber Network Administrator AND Tokyo",
    // "site:linkedin.com/in Uber Systems Administrator AND Amsterdam",
    // "site:linkedin.com/in Uber Security Analyst AND San Francisco",
    // "site:linkedin.com/in Uber IT Consultant AND London",
    // "site:linkedin.com/in Uber Systems Architect AND Melbourne",
    // "site:linkedin.com/in Uber Python Developer",
    // "site:linkedin.com/in Uber Java Developer",
    // "site:linkedin.com/in Uber JavaScript Developer",
    // "site:linkedin.com/in Uber TypeScript Developer",
    // "site:linkedin.com/in Uber Ruby on Rails Developer",
    // "site:linkedin.com/in Uber Go Developer",
    // "site:linkedin.com/in Uber C++ Developer",
    // "site:linkedin.com/in Uber C# Developer",
    // "site:linkedin.com/in Uber iOS Developer",
    // "site:linkedin.com/in Uber Android Developer",
    // "site:linkedin.com/in Uber UX Designer",
    // "site:linkedin.com/in Uber UI Developer",
    // "site:linkedin.com/in Uber Frontend Architect",
    // "site:linkedin.com/in Uber Backend Architect",
    // "site:linkedin.com/in Uber Technical Program Manager",
    // "site:linkedin.com/in Uber Cybersecurity",
    // "site:linkedin.com/in Uber Cloud Security",
    // "site:linkedin.com/in Uber Network Design",
    // "site:linkedin.com/in Uber DevOps Automation",
    // "site:linkedin.com/in Uber Infrastructure Monitoring",
    // "site:linkedin.com/in Uber Cloud Native Infrastructure",
    // "site:linkedin.com/in Uber Kubernetes Expert",
    // "site:linkedin.com/in Uber AWS Cloud Specialist",
    // "site:linkedin.com/in Uber Google Cloud Engineer",
    // "site:linkedin.com/in Uber Azure Cloud Engineer",
    // "site:linkedin.com/in Uber IT Systems Management",
    // "site:linkedin.com/in Uber IT Infrastructure Development",
    // "site:linkedin.com/in Uber Cloud Operations",
    // "site:linkedin.com/in Uber Cloud Migration Specialist",
    // "site:linkedin.com/in Uber IT Compliance",
    // "site:linkedin.com/in Uber Software Architect AND Paris",
    // "site:linkedin.com/in Uber Cloud Consultant AND Sydney",
    // "site:linkedin.com/in Uber IT Director AND Munich",
    // "site:linkedin.com/in Uber Data Analyst AND Singapore",
    // "site:linkedin.com/in Uber Site Reliability Engineer AND Seattle",
    // "site:linkedin.com/in Uber DevOps Manager AND Boston",
    // "site:linkedin.com/in Uber Infrastructure Developer AND London",
    // "site:linkedin.com/in Uber Cloud Engineer AND San Francisco",
    // "site:linkedin.com/in Uber Security Specialist AND New York",
    // "site:linkedin.com/in Uber Infrastructure Technician AND Chicago",
    // "site:linkedin.com/in Uber Operations Manager AND Tokyo",
    // "site:linkedin.com/in Uber Systems Support AND Los Angeles",
    // "site:linkedin.com/in Uber Network Specialist AND Dubai",
    // "site:linkedin.com/in Uber Infrastructure Manager AND Madrid",
    // "site:linkedin.com/in Uber Cloud Specialist AND Amsterdam",
    // "site:linkedin.com/in Uber Software Engineering",
    // "site:linkedin.com/in Uber IT Operations",
    // "site:linkedin.com/in Uber Cloud Development",
    // "site:linkedin.com/in Uber Security Operations",
    // "site:linkedin.com/in Uber Infrastructure Development",
    // "site:linkedin.com/in Uber Network Operations",
    // "site:linkedin.com/in Uber IT Infrastructure",
    // "site:linkedin.com/in Uber Data Center Operations",
    // "site:linkedin.com/in Uber Server Management",
    // "site:linkedin.com/in Uber Virtualization Expert",
    // "site:linkedin.com/in Uber Disaster Recovery Specialist",
    // "site:linkedin.com/in Uber System Backup Expert",
    // "site:linkedin.com/in Uber Automation Specialist",
    // "site:linkedin.com/in Uber Cloud Optimization",
    // "site:linkedin.com/in Uber High Performance Computing",
    //
    // // DoorDash
    // "site:linkedin.com/in DoorDash Frontend Engineer AND Chicago",
    // "site:linkedin.com/in DoorDash Backend Engineer AND Boston",
    // "site:linkedin.com/in DoorDash Software Developer AND Los Angeles",
    // "site:linkedin.com/in DoorDash Mobile Engineer AND Miami",
    // "site:linkedin.com/in DoorDash Data Scientist AND Denver",
    // "site:linkedin.com/in DoorDash Full Stack Engineer AND Houston",
    // "site:linkedin.com/in DoorDash Machine Learning Engineer AND Toronto",
    // "site:linkedin.com/in DoorDash AI Engineer AND Vancouver",
    // "site:linkedin.com/in DoorDash QA Automation Engineer AND Seattle",
    // "site:linkedin.com/in DoorDash Software Engineer AND Berlin",
    // "site:linkedin.com/in DoorDash Platform Engineer AND Paris",
    // "site:linkedin.com/in DoorDash Data Engineer AND Madrid",
    // "site:linkedin.com/in DoorDash Product Engineer AND Milan",
    // "site:linkedin.com/in DoorDash Tech Lead AND Barcelona",
    // "site:linkedin.com/in DoorDash Engineering Manager AND Sydney",
    // "site:linkedin.com/in DoorDash Infrastructure Specialist AND Los Angeles",
    // "site:linkedin.com/in DoorDash DevOps Specialist AND Atlanta",
    // "site:linkedin.com/in DoorDash Cloud Engineer AND Boston",
    // "site:linkedin.com/in DoorDash Network Security Engineer AND New York",
    // "site:linkedin.com/in DoorDash Database Specialist AND Toronto",
    // "site:linkedin.com/in DoorDash IT Security Engineer AND Dublin",
    // "site:linkedin.com/in DoorDash Systems Engineer AND Zurich",
    // "site:linkedin.com/in DoorDash Cloud Infrastructure Engineer AND Dubai",
    // "site:linkedin.com/in DoorDash SRE Specialist AND Hong Kong",
    // "site:linkedin.com/in DoorDash IT Manager AND Berlin",
    // "site:linkedin.com/in DoorDash Network Administrator AND Tokyo",
    // "site:linkedin.com/in DoorDash Systems Administrator AND Amsterdam",
    // "site:linkedin.com/in DoorDash Security Analyst AND San Francisco",
    // "site:linkedin.com/in DoorDash IT Consultant AND London",
    // "site:linkedin.com/in DoorDash Systems Architect AND Melbourne",
    // "site:linkedin.com/in DoorDash Python Developer",
    // "site:linkedin.com/in DoorDash Java Developer",
    // "site:linkedin.com/in DoorDash JavaScript Developer",
    // "site:linkedin.com/in DoorDash TypeScript Developer",
    // "site:linkedin.com/in DoorDash Ruby on Rails Developer",
    // "site:linkedin.com/in DoorDash Go Developer",
    // "site:linkedin.com/in DoorDash C++ Developer",
    // "site:linkedin.com/in DoorDash C# Developer",
    // "site:linkedin.com/in DoorDash iOS Developer",
    // "site:linkedin.com/in DoorDash Android Developer",
    // "site:linkedin.com/in DoorDash UX Designer",
    // "site:linkedin.com/in DoorDash UI Developer",
    // "site:linkedin.com/in DoorDash Frontend Architect",
    // "site:linkedin.com/in DoorDash Backend Architect",
    // "site:linkedin.com/in DoorDash Technical Program Manager",
    // "site:linkedin.com/in DoorDash Cybersecurity",
    // "site:linkedin.com/in DoorDash Cloud Security",
    // "site:linkedin.com/in DoorDash Network Design",
    // "site:linkedin.com/in DoorDash DevOps Automation",
    // "site:linkedin.com/in DoorDash Infrastructure Monitoring",
    // "site:linkedin.com/in DoorDash Cloud Native Infrastructure",
    // "site:linkedin.com/in DoorDash Kubernetes Expert",
    // "site:linkedin.com/in DoorDash AWS Cloud Specialist",
    // "site:linkedin.com/in DoorDash Google Cloud Engineer",
    // "site:linkedin.com/in DoorDash Azure Cloud Engineer",
    // "site:linkedin.com/in DoorDash IT Systems Management",
    // "site:linkedin.com/in DoorDash IT Infrastructure Development",
    // "site:linkedin.com/in DoorDash Cloud Operations",
    // "site:linkedin.com/in DoorDash Cloud Migration Specialist",
    // "site:linkedin.com/in DoorDash IT Compliance",
    // "site:linkedin.com/in DoorDash Software Architect AND Paris",
    // "site:linkedin.com/in DoorDash Cloud Consultant AND Sydney",
    // "site:linkedin.com/in DoorDash IT Director AND Munich",
    // "site:linkedin.com/in DoorDash Data Analyst AND Singapore",
    // "site:linkedin.com/in DoorDash Site Reliability Engineer AND Seattle",
    // "site:linkedin.com/in DoorDash DevOps Manager AND Boston",
    // "site:linkedin.com/in DoorDash Infrastructure Developer AND London",
    // "site:linkedin.com/in DoorDash Cloud Engineer AND San Francisco",
    // "site:linkedin.com/in DoorDash Security Specialist AND New York",
    // "site:linkedin.com/in DoorDash Infrastructure Technician AND Chicago",
    // "site:linkedin.com/in DoorDash Operations Manager AND Tokyo",
    // "site:linkedin.com/in DoorDash Systems Support AND Los Angeles",
    // "site:linkedin.com/in DoorDash Network Specialist AND Dubai",
    // "site:linkedin.com/in DoorDash Infrastructure Manager AND Madrid",
    // "site:linkedin.com/in DoorDash Cloud Specialist AND Amsterdam",
    // "site:linkedin.com/in DoorDash Software Engineering",
    // "site:linkedin.com/in DoorDash IT Operations",
    // "site:linkedin.com/in DoorDash Cloud Development",
    // "site:linkedin.com/in DoorDash Security Operations",
    // "site:linkedin.com/in DoorDash Infrastructure Development",
    // "site:linkedin.com/in DoorDash Network Operations",
    // "site:linkedin.com/in DoorDash IT Infrastructure",
    // "site:linkedin.com/in DoorDash Data Center Operations",
    // "site:linkedin.com/in DoorDash Server Management",
    // "site:linkedin.com/in DoorDash Virtualization Expert",
    // "site:linkedin.com/in DoorDash Disaster Recovery Specialist",
    // "site:linkedin.com/in DoorDash System Backup Expert",
    // "site:linkedin.com/in DoorDash Automation Specialist",
    // "site:linkedin.com/in DoorDash Cloud Optimization",
    // "site:linkedin.com/in DoorDash High Performance Computing",
    //
    // // Facebook
    // "site:linkedin.com/in Facebook Frontend Engineer AND Chicago",
    // "site:linkedin.com/in Facebook Backend Engineer AND Boston",
    // "site:linkedin.com/in Facebook Software Developer AND Los Angeles",
    // "site:linkedin.com/in Facebook Mobile Engineer AND Miami",
    // "site:linkedin.com/in Facebook Data Scientist AND Denver",
    // "site:linkedin.com/in Facebook Full Stack Engineer AND Houston",
    // "site:linkedin.com/in Facebook Machine Learning Engineer AND Toronto",
    // "site:linkedin.com/in Facebook AI Engineer AND Vancouver",
    // "site:linkedin.com/in Facebook QA Automation Engineer AND Seattle",
    // "site:linkedin.com/in Facebook Software Engineer AND Berlin",
    // "site:linkedin.com/in Facebook Platform Engineer AND Paris",
    // "site:linkedin.com/in Facebook Data Engineer AND Madrid",
    // "site:linkedin.com/in Facebook Product Engineer AND Milan",
    // "site:linkedin.com/in Facebook Tech Lead AND Barcelona",
    // "site:linkedin.com/in Facebook Engineering Manager AND Sydney",
    // "site:linkedin.com/in Facebook Infrastructure Specialist AND Los Angeles",
    // "site:linkedin.com/in Facebook DevOps Specialist AND Atlanta",
    // "site:linkedin.com/in Facebook Cloud Engineer AND Boston",
    // "site:linkedin.com/in Facebook Network Security Engineer AND New York",
    // "site:linkedin.com/in Facebook Database Specialist AND Toronto",
    // "site:linkedin.com/in Facebook IT Security Engineer AND Dublin",
    // "site:linkedin.com/in Facebook Systems Engineer AND Zurich",
    // "site:linkedin.com/in Facebook Cloud Infrastructure Engineer AND Dubai",
    // "site:linkedin.com/in Facebook SRE Specialist AND Hong Kong",
    // "site:linkedin.com/in Facebook IT Manager AND Berlin",
    // "site:linkedin.com/in Facebook Network Administrator AND Tokyo",
    // "site:linkedin.com/in Facebook Systems Administrator AND Amsterdam",
    // "site:linkedin.com/in Facebook Security Analyst AND San Francisco",
    // "site:linkedin.com/in Facebook IT Consultant AND London",
    // "site:linkedin.com/in Facebook Systems Architect AND Melbourne",
    // "site:linkedin.com/in Facebook Python Developer",
    // "site:linkedin.com/in Facebook Java Developer",
    // "site:linkedin.com/in Facebook JavaScript Developer",
    // "site:linkedin.com/in Facebook TypeScript Developer",
    // "site:linkedin.com/in Facebook Ruby on Rails Developer",
    // "site:linkedin.com/in Facebook Go Developer",
    // "site:linkedin.com/in Facebook C++ Developer",
    // "site:linkedin.com/in Facebook C# Developer",
    // "site:linkedin.com/in Facebook iOS Developer",
    // "site:linkedin.com/in Facebook Android Developer",
    // "site:linkedin.com/in Facebook UX Designer",
    // "site:linkedin.com/in Facebook UI Developer",
    // "site:linkedin.com/in Facebook Frontend Architect",
    // "site:linkedin.com/in Facebook Backend Architect",
    // "site:linkedin.com/in Facebook Technical Program Manager",
    // "site:linkedin.com/in Facebook Cybersecurity",
    // "site:linkedin.com/in Facebook Cloud Security",
    // "site:linkedin.com/in Facebook Network Design",
    // "site:linkedin.com/in Facebook DevOps Automation",
    // "site:linkedin.com/in Facebook Infrastructure Monitoring",
    // "site:linkedin.com/in Facebook Cloud Native Infrastructure",
    // "site:linkedin.com/in Facebook Kubernetes Expert",
    // "site:linkedin.com/in Facebook AWS Cloud Specialist",
    // "site:linkedin.com/in Facebook Google Cloud Engineer",
    // "site:linkedin.com/in Facebook Azure Cloud Engineer",
    // "site:linkedin.com/in Facebook IT Systems Management",
    // "site:linkedin.com/in Facebook IT Infrastructure Development",
    // "site:linkedin.com/in Facebook Cloud Operations",
    // "site:linkedin.com/in Facebook Cloud Migration Specialist",
    // "site:linkedin.com/in Facebook IT Compliance",
    // "site:linkedin.com/in Facebook Software Architect AND Paris",
    // "site:linkedin.com/in Facebook Cloud Consultant AND Sydney",
    // "site:linkedin.com/in Facebook IT Director AND Munich",
    // "site:linkedin.com/in Facebook Data Analyst AND Singapore",
    // "site:linkedin.com/in Facebook Site Reliability Engineer AND Seattle",
    // "site:linkedin.com/in Facebook DevOps Manager AND Boston",
    // "site:linkedin.com/in Facebook Infrastructure Developer AND London",
    // "site:linkedin.com/in Facebook Cloud Engineer AND San Francisco",
    // "site:linkedin.com/in Facebook Security Specialist AND New York",
    // "site:linkedin.com/in Facebook Infrastructure Technician AND Chicago",
    // "site:linkedin.com/in Facebook Operations Manager AND Tokyo",
    // "site:linkedin.com/in Facebook Systems Support AND Los Angeles",
    // "site:linkedin.com/in Facebook Network Specialist AND Dubai",
    // "site:linkedin.com/in Facebook Infrastructure Manager AND Madrid",
    // "site:linkedin.com/in Facebook Cloud Specialist AND Amsterdam",
    // "site:linkedin.com/in Facebook Software Engineering",
    // "site:linkedin.com/in Facebook IT Operations",
    // "site:linkedin.com/in Facebook Cloud Development",
    // "site:linkedin.com/in Facebook Security Operations",
    // "site:linkedin.com/in Facebook Infrastructure Development",
    // "site:linkedin.com/in Facebook Network Operations",
    // "site:linkedin.com/in Facebook IT Infrastructure",
    // "site:linkedin.com/in Facebook Data Center Operations",
    // "site:linkedin.com/in Facebook Server Management",
    // "site:linkedin.com/in Facebook Virtualization Expert",
    // "site:linkedin.com/in Facebook Disaster Recovery Specialist",
    // "site:linkedin.com/in Facebook System Backup Expert",
    // "site:linkedin.com/in Facebook Automation Specialist",
    // "site:linkedin.com/in Facebook Cloud Optimization",
    // "site:linkedin.com/in Facebook High Performance Computing",
    //
    // // Instagram
    // "site:linkedin.com/in Instagram Frontend Engineer AND Chicago",
    // "site:linkedin.com/in Instagram Backend Engineer AND Boston",
    // "site:linkedin.com/in Instagram Software Developer AND Los Angeles",
    // "site:linkedin.com/in Instagram Mobile Engineer AND Miami",
    // "site:linkedin.com/in Instagram Data Scientist AND Denver",
    // "site:linkedin.com/in Instagram Full Stack Engineer AND Houston",
    // "site:linkedin.com/in Instagram Machine Learning Engineer AND Toronto",
    // "site:linkedin.com/in Instagram AI Engineer AND Vancouver",
    // "site:linkedin.com/in Instagram QA Automation Engineer AND Seattle",
    // "site:linkedin.com/in Instagram Software Engineer AND Berlin",
    // "site:linkedin.com/in Instagram Platform Engineer AND Paris",
    // "site:linkedin.com/in Instagram Data Engineer AND Madrid",
    // "site:linkedin.com/in Instagram Product Engineer AND Milan",
    // "site:linkedin.com/in Instagram Tech Lead AND Barcelona",
    // "site:linkedin.com/in Instagram Engineering Manager AND Sydney",
    // "site:linkedin.com/in Instagram Infrastructure Specialist AND Los Angeles",
    // "site:linkedin.com/in Instagram DevOps Specialist AND Atlanta",
    // "site:linkedin.com/in Instagram Cloud Engineer AND Boston",
    // "site:linkedin.com/in Instagram Network Security Engineer AND New York",
    // "site:linkedin.com/in Instagram Database Specialist AND Toronto",
    // "site:linkedin.com/in Instagram IT Security Engineer AND Dublin",
    // "site:linkedin.com/in Instagram Systems Engineer AND Zurich",
    // "site:linkedin.com/in Instagram Cloud Infrastructure Engineer AND Dubai",
    // "site:linkedin.com/in Instagram SRE Specialist AND Hong Kong",
    // "site:linkedin.com/in Instagram IT Manager AND Berlin",
    // "site:linkedin.com/in Instagram Network Administrator AND Tokyo",
    // "site:linkedin.com/in Instagram Systems Administrator AND Amsterdam",
    // "site:linkedin.com/in Instagram Security Analyst AND San Francisco",
    // "site:linkedin.com/in Instagram IT Consultant AND London",
    // "site:linkedin.com/in Instagram Systems Architect AND Melbourne",
    // "site:linkedin.com/in Instagram Python Developer",
    // "site:linkedin.com/in Instagram Java Developer",
    // "site:linkedin.com/in Instagram JavaScript Developer",
    // "site:linkedin.com/in Instagram TypeScript Developer",
    // "site:linkedin.com/in Instagram Ruby on Rails Developer",
    // "site:linkedin.com/in Instagram Go Developer",
    // "site:linkedin.com/in Instagram C++ Developer",
    // "site:linkedin.com/in Instagram C# Developer",
    // "site:linkedin.com/in Instagram iOS Developer",
    // "site:linkedin.com/in Instagram Android Developer",
    // "site:linkedin.com/in Instagram UX Designer",
    // "site:linkedin.com/in Instagram UI Developer",
    // "site:linkedin.com/in Instagram Frontend Architect",
    // "site:linkedin.com/in Instagram Backend Architect",
    // "site:linkedin.com/in Instagram Technical Program Manager",
    // "site:linkedin.com/in Instagram Cybersecurity",
    // "site:linkedin.com/in Instagram Cloud Security",
    // "site:linkedin.com/in Instagram Network Design",
    // "site:linkedin.com/in Instagram DevOps Automation",
    // "site:linkedin.com/in Instagram Infrastructure Monitoring",
    // "site:linkedin.com/in Instagram Cloud Native Infrastructure",
    // "site:linkedin.com/in Instagram Kubernetes Expert",
    // "site:linkedin.com/in Instagram AWS Cloud Specialist",
    // "site:linkedin.com/in Instagram Google Cloud Engineer",
    // "site:linkedin.com/in Instagram Azure Cloud Engineer",
    // "site:linkedin.com/in Instagram IT Systems Management",
    // "site:linkedin.com/in Instagram IT Infrastructure Development",
    // "site:linkedin.com/in Instagram Cloud Operations",
    // "site:linkedin.com/in Instagram Cloud Migration Specialist",
    // "site:linkedin.com/in Instagram IT Compliance",
    // "site:linkedin.com/in Instagram Software Architect AND Paris",
    // "site:linkedin.com/in Instagram Cloud Consultant AND Sydney",
    // "site:linkedin.com/in Instagram IT Director AND Munich",
    // "site:linkedin.com/in Instagram Data Analyst AND Singapore",
    // "site:linkedin.com/in Instagram Site Reliability Engineer AND Seattle",
    // "site:linkedin.com/in Instagram DevOps Manager AND Boston",
    // "site:linkedin.com/in Instagram Infrastructure Developer AND London",
    // "site:linkedin.com/in Instagram Cloud Engineer AND San Francisco",
    // "site:linkedin.com/in Instagram Security Specialist AND New York",
    // "site:linkedin.com/in Instagram Infrastructure Technician AND Chicago",
    // "site:linkedin.com/in Instagram Operations Manager AND Tokyo",
    // "site:linkedin.com/in Instagram Systems Support AND Los Angeles",
    // "site:linkedin.com/in Instagram Network Specialist AND Dubai",
    // "site:linkedin.com/in Instagram Infrastructure Manager AND Madrid",
    // "site:linkedin.com/in Instagram Cloud Specialist AND Amsterdam",
    // "site:linkedin.com/in Instagram Software Engineering",
    // "site:linkedin.com/in Instagram IT Operations",
    // "site:linkedin.com/in Instagram Cloud Development",
    // "site:linkedin.com/in Instagram Security Operations",
    // "site:linkedin.com/in Instagram Infrastructure Development",
    // "site:linkedin.com/in Instagram Network Operations",
    // "site:linkedin.com/in Instagram IT Infrastructure",
    // "site:linkedin.com/in Instagram Data Center Operations",
    // "site:linkedin.com/in Instagram Server Management",
    // "site:linkedin.com/in Instagram Virtualization Expert",
    // "site:linkedin.com/in Instagram Disaster Recovery Specialist",
    // "site:linkedin.com/in Instagram System Backup Expert",
    // "site:linkedin.com/in Instagram Automation Specialist",
    // "site:linkedin.com/in Instagram Cloud Optimization",
    // "site:linkedin.com/in Instagram High Performance Computing",
    //
    // // Dropbox
    // "site:linkedin.com/in Dropbox Frontend Engineer AND Chicago",
    // "site:linkedin.com/in Dropbox Backend Engineer AND Boston",
    // "site:linkedin.com/in Dropbox Software Developer AND Los Angeles",
    // "site:linkedin.com/in Dropbox Mobile Engineer AND Miami",
    // "site:linkedin.com/in Dropbox Data Scientist AND Denver",
    // "site:linkedin.com/in Dropbox Full Stack Engineer AND Houston",
    // "site:linkedin.com/in Dropbox Machine Learning Engineer AND Toronto",
    // "site:linkedin.com/in Dropbox AI Engineer AND Vancouver",
    // "site:linkedin.com/in Dropbox QA Automation Engineer AND Seattle",
    // "site:linkedin.com/in Dropbox Software Engineer AND Berlin",
    // "site:linkedin.com/in Dropbox Platform Engineer AND Paris",
    // "site:linkedin.com/in Dropbox Data Engineer AND Madrid",
    // "site:linkedin.com/in Dropbox Product Engineer AND Milan",
    // "site:linkedin.com/in Dropbox Tech Lead AND Barcelona",
    // "site:linkedin.com/in Dropbox Engineering Manager AND Sydney",
    // "site:linkedin.com/in Dropbox Infrastructure Specialist AND Los Angeles",
    // "site:linkedin.com/in Dropbox DevOps Specialist AND Atlanta",
    // "site:linkedin.com/in Dropbox Cloud Engineer AND Boston",
    // "site:linkedin.com/in Dropbox Network Security Engineer AND New York",
    // "site:linkedin.com/in Dropbox Database Specialist AND Toronto",
    // "site:linkedin.com/in Dropbox IT Security Engineer AND Dublin",
    // "site:linkedin.com/in Dropbox Systems Engineer AND Zurich",
    // "site:linkedin.com/in Dropbox Cloud Infrastructure Engineer AND Dubai",
    // "site:linkedin.com/in Dropbox SRE Specialist AND Hong Kong",
    // "site:linkedin.com/in Dropbox IT Manager AND Berlin",
    // "site:linkedin.com/in Dropbox Network Administrator AND Tokyo",
    // "site:linkedin.com/in Dropbox Systems Administrator AND Amsterdam",
    // "site:linkedin.com/in Dropbox Security Analyst AND San Francisco",
    // "site:linkedin.com/in Dropbox IT Consultant AND London",
    // "site:linkedin.com/in Dropbox Systems Architect AND Melbourne",
    // "site:linkedin.com/in Dropbox Python Developer",
    // "site:linkedin.com/in Dropbox Java Developer",
    // "site:linkedin.com/in Dropbox JavaScript Developer",
    // "site:linkedin.com/in Dropbox TypeScript Developer",
    // "site:linkedin.com/in Dropbox Ruby on Rails Developer",
    // "site:linkedin.com/in Dropbox Go Developer",
    // "site:linkedin.com/in Dropbox C++ Developer",
    // "site:linkedin.com/in Dropbox C# Developer",
    // "site:linkedin.com/in Dropbox iOS Developer",
    // "site:linkedin.com/in Dropbox Android Developer",
    "site:linkedin.com/in Dropbox UX Designer",
    "site:linkedin.com/in Dropbox UI Developer",
    "site:linkedin.com/in Dropbox Frontend Architect",
    "site:linkedin.com/in Dropbox Backend Architect",
    "site:linkedin.com/in Dropbox Technical Program Manager",
    "site:linkedin.com/in Dropbox Cybersecurity",
    "site:linkedin.com/in Dropbox Cloud Security",
    "site:linkedin.com/in Dropbox Network Design",
    "site:linkedin.com/in Dropbox DevOps Automation",
    "site:linkedin.com/in Dropbox Infrastructure Monitoring",
    "site:linkedin.com/in Dropbox Cloud Native Infrastructure",
    "site:linkedin.com/in Dropbox Kubernetes Expert",
    "site:linkedin.com/in Dropbox AWS Cloud Specialist",
    "site:linkedin.com/in Dropbox Google Cloud Engineer",
    "site:linkedin.com/in Dropbox Azure Cloud Engineer",
    "site:linkedin.com/in Dropbox IT Systems Management",
    "site:linkedin.com/in Dropbox IT Infrastructure Development",
    "site:linkedin.com/in Dropbox Cloud Operations",
    "site:linkedin.com/in Dropbox Cloud Migration Specialist",
    "site:linkedin.com/in Dropbox IT Compliance",
    "site:linkedin.com/in Dropbox Software Architect AND Paris",
    "site:linkedin.com/in Dropbox Cloud Consultant AND Sydney",
    "site:linkedin.com/in Dropbox IT Director AND Munich",
    "site:linkedin.com/in Dropbox Data Analyst AND Singapore",
    "site:linkedin.com/in Dropbox Site Reliability Engineer AND Seattle",
    "site:linkedin.com/in Dropbox DevOps Manager AND Boston",
    "site:linkedin.com/in Dropbox Infrastructure Developer AND London",
    "site:linkedin.com/in Dropbox Cloud Engineer AND San Francisco",
    "site:linkedin.com/in Dropbox Security Specialist AND New York",
    "site:linkedin.com/in Dropbox Infrastructure Technician AND Chicago",
    "site:linkedin.com/in Dropbox Operations Manager AND Tokyo",
    "site:linkedin.com/in Dropbox Systems Support AND Los Angeles",
    "site:linkedin.com/in Dropbox Network Specialist AND Dubai",
    "site:linkedin.com/in Dropbox Infrastructure Manager AND Madrid",
    "site:linkedin.com/in Dropbox Cloud Specialist AND Amsterdam",
    "site:linkedin.com/in Dropbox Software Engineering",
    "site:linkedin.com/in Dropbox IT Operations",
    "site:linkedin.com/in Dropbox Cloud Development",
    "site:linkedin.com/in Dropbox Security Operations",
    "site:linkedin.com/in Dropbox Infrastructure Development",
    "site:linkedin.com/in Dropbox Network Operations",
    "site:linkedin.com/in Dropbox IT Infrastructure",
    "site:linkedin.com/in Dropbox Data Center Operations",
    "site:linkedin.com/in Dropbox Server Management",
    "site:linkedin.com/in Dropbox Virtualization Expert",
    "site:linkedin.com/in Dropbox Disaster Recovery Specialist",
    "site:linkedin.com/in Dropbox System Backup Expert",
    "site:linkedin.com/in Dropbox Automation Specialist",
    "site:linkedin.com/in Dropbox Cloud Optimization",
    "site:linkedin.com/in Dropbox High Performance Computing",

    // TikTok
    "site:linkedin.com/in TikTok Frontend Engineer AND Chicago",
    "site:linkedin.com/in TikTok Backend Engineer AND Boston",
    "site:linkedin.com/in TikTok Software Developer AND Los Angeles",
    "site:linkedin.com/in TikTok Mobile Engineer AND Miami",
    "site:linkedin.com/in TikTok Data Scientist AND Denver",
    "site:linkedin.com/in TikTok Full Stack Engineer AND Houston",
    "site:linkedin.com/in TikTok Machine Learning Engineer AND Toronto",
    "site:linkedin.com/in TikTok AI Engineer AND Vancouver",
    "site:linkedin.com/in TikTok QA Automation Engineer AND Seattle",
    "site:linkedin.com/in TikTok Software Engineer AND Berlin",
    "site:linkedin.com/in TikTok Platform Engineer AND Paris",
    "site:linkedin.com/in TikTok Data Engineer AND Madrid",
    "site:linkedin.com/in TikTok Product Engineer AND Milan",
    "site:linkedin.com/in TikTok Tech Lead AND Barcelona",
    "site:linkedin.com/in TikTok Engineering Manager AND Sydney",
    "site:linkedin.com/in TikTok Infrastructure Specialist AND Los Angeles",
    "site:linkedin.com/in TikTok DevOps Specialist AND Atlanta",
    "site:linkedin.com/in TikTok Cloud Engineer AND Boston",
    "site:linkedin.com/in TikTok Network Security Engineer AND New York",
    "site:linkedin.com/in TikTok Database Specialist AND Toronto",
    "site:linkedin.com/in TikTok IT Security Engineer AND Dublin",
    "site:linkedin.com/in TikTok Systems Engineer AND Zurich",
    "site:linkedin.com/in TikTok Cloud Infrastructure Engineer AND Dubai",
    "site:linkedin.com/in TikTok SRE Specialist AND Hong Kong",
    "site:linkedin.com/in TikTok IT Manager AND Berlin",
    "site:linkedin.com/in TikTok Network Administrator AND Tokyo",
    "site:linkedin.com/in TikTok Systems Administrator AND Amsterdam",
    "site:linkedin.com/in TikTok Security Analyst AND San Francisco",
    "site:linkedin.com/in TikTok IT Consultant AND London",
    "site:linkedin.com/in TikTok Systems Architect AND Melbourne",
    "site:linkedin.com/in TikTok Python Developer",
    "site:linkedin.com/in TikTok Java Developer",
    "site:linkedin.com/in TikTok JavaScript Developer",
    "site:linkedin.com/in TikTok TypeScript Developer",
    "site:linkedin.com/in TikTok Ruby on Rails Developer",
    "site:linkedin.com/in TikTok Go Developer",
    "site:linkedin.com/in TikTok C++ Developer",
    "site:linkedin.com/in TikTok C# Developer",
    "site:linkedin.com/in TikTok iOS Developer",
    "site:linkedin.com/in TikTok Android Developer",
    "site:linkedin.com/in TikTok UX Designer",
    "site:linkedin.com/in TikTok UI Developer",
    "site:linkedin.com/in TikTok Frontend Architect",
    "site:linkedin.com/in TikTok Backend Architect",
    "site:linkedin.com/in TikTok Technical Program Manager",
    "site:linkedin.com/in TikTok Cybersecurity",
    "site:linkedin.com/in TikTok Cloud Security",
    "site:linkedin.com/in TikTok Network Design",
    "site:linkedin.com/in TikTok DevOps Automation",
    "site:linkedin.com/in TikTok Infrastructure Monitoring",
    "site:linkedin.com/in TikTok Cloud Native Infrastructure",
    "site:linkedin.com/in TikTok Kubernetes Expert",
    "site:linkedin.com/in TikTok AWS Cloud Specialist",
    "site:linkedin.com/in TikTok Google Cloud Engineer",
    "site:linkedin.com/in TikTok Azure Cloud Engineer",
    "site:linkedin.com/in TikTok IT Systems Management",
    "site:linkedin.com/in TikTok IT Infrastructure Development",
    "site:linkedin.com/in TikTok Cloud Operations",
    "site:linkedin.com/in TikTok Cloud Migration Specialist",
    "site:linkedin.com/in TikTok IT Compliance",
    "site:linkedin.com/in TikTok Software Architect AND Paris",
    "site:linkedin.com/in TikTok Cloud Consultant AND Sydney",
    "site:linkedin.com/in TikTok IT Director AND Munich",
    "site:linkedin.com/in TikTok Data Analyst AND Singapore",
    "site:linkedin.com/in TikTok Site Reliability Engineer AND Seattle",
    "site:linkedin.com/in TikTok DevOps Manager AND Boston",
    "site:linkedin.com/in TikTok Infrastructure Developer AND London",
    "site:linkedin.com/in TikTok Cloud Engineer AND San Francisco",
    "site:linkedin.com/in TikTok Security Specialist AND New York",
    "site:linkedin.com/in TikTok Infrastructure Technician AND Chicago",
    "site:linkedin.com/in TikTok Operations Manager AND Tokyo",
    "site:linkedin.com/in TikTok Systems Support AND Los Angeles",
    "site:linkedin.com/in TikTok Network Specialist AND Dubai",
    "site:linkedin.com/in TikTok Infrastructure Manager AND Madrid",
    "site:linkedin.com/in TikTok Cloud Specialist AND Amsterdam",
    "site:linkedin.com/in TikTok Software Engineering",
    "site:linkedin.com/in TikTok IT Operations",
    "site:linkedin.com/in TikTok Cloud Development",
    "site:linkedin.com/in TikTok Security Operations",
    "site:linkedin.com/in TikTok Infrastructure Development",
    "site:linkedin.com/in TikTok Network Operations",
    "site:linkedin.com/in TikTok IT Infrastructure",
    "site:linkedin.com/in TikTok Data Center Operations",
    "site:linkedin.com/in TikTok Server Management",
    "site:linkedin.com/in TikTok Virtualization Expert",
    "site:linkedin.com/in TikTok Disaster Recovery Specialist",
    "site:linkedin.com/in TikTok System Backup Expert",
    "site:linkedin.com/in TikTok Automation Specialist",
    "site:linkedin.com/in TikTok Cloud Optimization",
    "site:linkedin.com/in TikTok High Performance Computing",
  ];

  for (const query of queries.slice(0, 200)) {
    const urls = await googleSearch(query);
    console.log(
      `Number of URLs returned that contain www.linkedin.com/in: ${urls.length}`,
    );

    for (let i = 0; i < urls.length; i += 10) {
      const batch = urls.slice(i, i + 10);
      await processUrls(batch);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  console.log("Main process completed.");
};

main();
