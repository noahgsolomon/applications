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
  const maxResults = 250;
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
    queries.push(`site:linkedin.com/in Instagram ${role}`);
    queries.push(`site:linkedin.com/in Tiktok ${role}`);
    queries.push(`site:linkedin.com/in Netflix ${role}`);
    queries.push(`site:linkedin.com/in Uber ${role}`);
    queries.push(`site:linkedin.com/in YouTube ${role}`);
    if (Math.random() < 0.5) {
      const randomCity = cities[Math.floor(Math.random() * cities.length)];
      queries.push(`site:linkedin.com/in Instagram ${role} AND ${randomCity}`);
      queries.push(`site:linkedin.com/in TikTok ${role} AND ${randomCity}`);
      queries.push(`site:linkedin.com/in Netflix ${role} AND ${randomCity}`);
      queries.push(`site:linkedin.com/in Uber ${role} AND ${randomCity}`);
      queries.push(`site:linkedin.com/in YouTube ${role} AND ${randomCity}`);
    }
  });
  return queries;
};

const main = async () => {
  console.log("Main process started.");

  const roles = [
    // Tech roles
    "Software Engineer",
    "Data Scientist",
    "Product Manager",
    "UX Designer",
    "DevOps Engineer",
    "Cloud Architect",
    "Machine Learning Engineer",
    "Mobile Developer",
    "Full Stack Developer",
    "Security Analyst",
    "Data Engineer",
    "QA Engineer",
    "Frontend Developer",
    "Backend Developer",
    "Systems Administrator",
    "Network Engineer",
    "Database Administrator",
    "AI Researcher",
    "Blockchain Developer",
    "AR/VR Developer",

    // Non-tech roles
    "Marketing Manager",
    "Content Creator",
    "HR Specialist",
    "Financial Analyst",
    "Legal Counsel",
    "Business Development",
    "Customer Support",
    "Sales Representative",
    "Public Relations",
    "Operations Manager",
    "Project Manager",
    "Account Executive",
    "Creative Director",
    "Brand Strategist",
    "Social Media Manager",
    "Data Analyst",
    "Product Designer",
    "User Researcher",
    "Community Manager",
    "Talent Acquisition",
    "Compliance Officer",
    "Business Analyst",
    "Executive Assistant",
    "Office Manager",
    "Recruiter",
    "Copywriter",
    "Event Planner",
    "Graphic Designer",
    "Video Editor",
    "Content Strategist",
    "SEO Specialist",
    "Growth Hacker",
    "Product Owner",
    "Scrum Master",
    "Agile Coach",
    "Customer Success Manager",
    "Technical Writer",
    "Localization Specialist",
    "UX Researcher",
    "UI Designer",
    "Information Architect",
    "Data Visualization Specialist",
    "Business Intelligence Analyst",
    "Risk Manager",
    "Supply Chain Manager",
    "Logistics Coordinator",
    "Procurement Specialist",
    "Quality Assurance Manager",
    "Facilities Manager",
    "Human Resources Manager",
    "Training and Development Specialist",
    "Compensation and Benefits Analyst",
    "Internal Communications Specialist",
    "Corporate Communications Manager",
    "Investor Relations Manager",
    "Sustainability Coordinator",
    "Diversity and Inclusion Specialist",
    "Corporate Social Responsibility Manager",
    "Brand Ambassador",
    "Influencer Relations Manager",
    "Partnership Manager",
    "Affiliate Marketing Manager",
    "Email Marketing Specialist",
    "CRM Specialist",
    "Market Research Analyst",
    "Competitive Intelligence Analyst",
    "Product Marketing Manager",
    "Category Manager",
    "Merchandising Manager",
    "Visual Merchandiser",
    "User Acquisition Manager",
    "Retention Specialist",
    "Customer Experience Manager",
    "Customer Insights Analyst",
    "Pricing Analyst",
    "Revenue Manager",
    "Financial Planning and Analysis Manager",
    "Treasury Analyst",
    "Tax Specialist",
    "Auditor",
    "Accounting Manager",
    "Payroll Specialist",
    "Credit Analyst",
    "Fraud Investigator",
    "Underwriter",
    "Actuary",
    "Investment Analyst",
    "Portfolio Manager",
    "Wealth Manager",
    "Financial Advisor",
    "Economist",
    "Data Privacy Officer",
    "Ethics and Compliance Manager",
    "Intellectual Property Specialist",
    "Contract Manager",
    "Paralegal",
    "Government Relations Specialist",
    "Policy Analyst",
    "Regulatory Affairs Specialist",
    "Environmental Health and Safety Manager",
    "Ergonomist",
    "Wellness Coordinator",
    "Benefits Administrator",
    "Employee Relations Specialist",
    "Labor Relations Specialist",
    "Organizational Development Consultant",
    "Change Management Specialist",
    "Performance Management Specialist",
    "Compensation Analyst",
    "HRIS Specialist",
    "Talent Management Specialist",
    "Leadership Development Specialist",
    "Diversity Recruiter",
    "Campus Recruiter",
    "Executive Search Consultant",
    "Employer Branding Specialist",
    "Onboarding Specialist",
    "Learning and Development Manager",
    "Instructional Designer",
    "E-learning Developer",
    "Knowledge Management Specialist",
    "Internal Auditor",
    "Process Improvement Specialist",
    "Six Sigma Black Belt",
    "Lean Management Consultant",
    "Innovation Manager",
    "R&D Manager",
    "Intellectual Property Manager",
    "Technology Transfer Specialist",
    "Grants Manager",
    "Fundraising Specialist",
    "Donor Relations Manager",
    "Volunteer Coordinator",
    "Nonprofit Program Manager",
    "Social Worker",
    "Community Outreach Coordinator",
    "Public Policy Analyst",
    "Government Affairs Specialist",
    "Lobbyist",
    "Political Campaign Manager",
    "Speechwriter",
    "Press Secretary",
    "Media Relations Specialist",
    "Crisis Communications Manager",
    "Spokesperson",
    "Public Information Officer",
    "Digital Marketing Manager",
    "SEM Specialist",
    "PPC Specialist",
    "Display Advertising Specialist",
    "Programmatic Advertising Manager",
    "Marketing Automation Specialist",
    "Marketing Operations Manager",
    "Brand Manager",
    "Product Placement Specialist",
    "Sponsorship Manager",
    "Experiential Marketing Manager",
    "Trade Show Coordinator",
    "Conference Planner",
    "Corporate Event Planner",
    "Wedding Planner",
    "Travel Coordinator",
    "Concierge",
    "Customer Service Representative",
    "Technical Support Specialist",
    "Help Desk Analyst",
    "Call Center Manager",
    "Customer Retention Specialist",
    "Customer Loyalty Program Manager",
    "Voice of the Customer Analyst",
    "User Experience Researcher",
    "Usability Tester",
    "Accessibility Specialist",
    "Information Architect",
    "Content Manager",
    "Editorial Manager",
    "Proofreader",
    "Translator",
    "Interpreter",
    "Subtitler",
    "Closed Captioning Specialist",
    "Audio Description Writer",
    "Podcast Producer",
    "Radio Producer",
    "Music Supervisor",
    "Sound Designer",
    "Foley Artist",
    "Voice Actor",
    "Narrator",
    "Audiobook Producer",
    "Game Designer",
    "Level Designer",
    "Game Producer",
    "Esports Manager",
    "Streaming Content Manager",
    "Live Streaming Producer",
    "Community Guidelines Enforcer",
    "Content Moderator",
    "Trust and Safety Specialist",
    "Online Reputation Manager",
    "Social Listening Analyst",
    "Trend Forecaster",
    "Cool Hunter",
    "Futurist",
    "Scenario Planner",
    "Strategic Foresight Specialist",
  ];

  const cities = [
    "New York",
    "Atlanta",
    "Dallas",
    "Austin",
    "Los Angeles",
    "San Francisco",
    "Seattle",
  ];

  const queries = generateSearchQueries(roles, cities);

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
