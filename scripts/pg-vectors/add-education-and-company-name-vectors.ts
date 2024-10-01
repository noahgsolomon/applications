import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import { eq, isNotNull, or } from "drizzle-orm/expressions";
import {
  people,
  companiesVector,
  education,
} from "../../server/db/schemas/users/schema";
import dotenv from "dotenv";
import OpenAI from "openai";

// Load environment variables
dotenv.config({ path: "../../.env" });

// Initialize OpenAI with API key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// Initialize the database connection
const pool = new Pool({ connectionString: process.env.DB_URL });
const db = drizzle(pool, {
  schema: { people, companiesVector, education },
});

// Function to fetch embeddings for a given text
async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });

  if (!response.data || response.data.length === 0) {
    throw new Error("No embedding returned from OpenAI API");
  }

  return response.data[0].embedding;
}

// Function to extract structured data from bio using OpenAI
async function extractStructuredData(bio: string) {
  const prompt = `
    Extract information from the following bio. Return an object in the format:
    {
      companies: string[],
      education: { schoolName: string, fieldOfStudy: string }[]
    }
    Ensure the array 'companies' is empty if no companies are mentioned. Each 'education' entry must have a non-null 'schoolName' or 'fieldOfStudy'. If none are mentioned, return an empty array for 'education'.

    Bio: "${bio}"
  `;

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
  });

  try {
    const structuredData = JSON.parse(response.choices[0].message.content!);
    return structuredData;
  } catch (error) {
    console.error("[extractStructuredData] Failed to parse response:", error);
    return { companies: [], education: [] };
  }
}

// Function to insert company embeddings into the companiesVector table
async function insertCompanyEmbedding(personId: string, company: string) {
  try {
    const companyVector = await getEmbedding(company);
    await db
      .insert(companiesVector)
      .values({
        personId,
        company,
        vector: companyVector,
      })
      .onConflictDoNothing();
    console.log(
      `[insertCompanyEmbedding] Inserted company "${company}" for person ID: ${personId}`,
    );
  } catch (error) {
    console.error(
      `[insertCompanyEmbedding] Failed to insert company "${company}" for person ID: ${personId}`,
      error,
    );
  }
}

// Function to insert education embeddings into the education table
async function insertEducationEmbedding(
  personId: string,
  school: string,
  fieldOfStudy?: string,
) {
  try {
    const schoolVector = await getEmbedding(school);
    const fieldOfStudyVector = fieldOfStudy
      ? await getEmbedding(fieldOfStudy)
      : null;

    await db
      .insert(education)
      .values({
        personId,
        school,
        schoolVector,
        fieldOfStudy,
        fieldOfStudyVector,
      })
      .onConflictDoNothing();

    console.log(
      `[insertEducationEmbedding] Inserted school "${school}" for person ID: ${personId}`,
    );
  } catch (error) {
    console.error(
      `[insertEducationEmbedding] Failed to insert school "${school}" for person ID: ${personId}`,
      error,
    );
  }
}

// Main function to process LinkedIn data and insert embeddings
async function processLinkedInAndBiosData() {
  console.log("[processLinkedInAndBiosData] Starting processing...");

  // Fetch people with LinkedIn data or Twitter/GitHub bios
  const peopleWithLinkedInDataOrBios = await db
    .select()
    .from(people)
    .where(
      or(
        isNotNull(people.linkedinData),
        isNotNull(people.twitterBio),
        isNotNull(people.githubBio),
      ),
    );

  console.log(
    `[processLinkedInAndBiosData] Found ${peopleWithLinkedInDataOrBios.length} people with data.`,
  );

  for (const person of peopleWithLinkedInDataOrBios) {
    const { id: personId, linkedinData, twitterBio, githubData } = person;
    let companies: string[] = [];
    if (person.githubCompany) {
      companies.push(person.githubCompany);
    }
    if (person.organizations) {
      for (const org of person.organizations) {
        companies.push(org.name);
      }
    }
    let education: { schoolName: string; fieldOfStudy: string }[] = [];

    // Extract companies and education from LinkedIn data
    if ((linkedinData as any)?.positions?.positionHistory) {
      for (const position of (linkedinData as any).positions.positionHistory) {
        const companyName = position.companyName;
        if (companyName) {
          companies.push(companyName);
        }
      }
    }

    if ((linkedinData as any)?.schools?.educationHistory) {
      for (const school of (linkedinData as any).schools.educationHistory) {
        const schoolName = school.schoolName;
        const fieldOfStudy = school.fieldOfStudy;
        if (schoolName || fieldOfStudy) {
          education.push({ schoolName, fieldOfStudy });
        }
      }
    }

    // Extract companies and education from Twitter bio
    if (twitterBio) {
      const twitterData = await extractStructuredData(twitterBio);
      companies = companies.concat(twitterData.companies);
      education = education.concat(twitterData.education);
    }

    // Extract companies and education from GitHub bio
    if ((githubData as any)?.bio) {
      const githubBio = (githubData as any).bio;
      const githubDataExtracted = await extractStructuredData(githubBio);
      companies = companies.concat(githubDataExtracted.companies);
      education = education.concat(githubDataExtracted.education);
    }

    // Insert company embeddings
    for (const company of companies) {
      await insertCompanyEmbedding(personId, company);
    }

    // Insert education embeddings
    for (const edu of education) {
      if (edu.schoolName) {
        await insertEducationEmbedding(
          personId,
          edu.schoolName,
          edu.fieldOfStudy,
        );
      }
    }
  }

  console.log("[processLinkedInAndBiosData] Processing completed.");
}

// Execute the main function
processLinkedInAndBiosData()
  .then(() => {
    console.log("[processLinkedInAndBiosData] Script finished successfully.");
    process.exit(0);
  })
  .catch((error) => {
    console.error(
      "[processLinkedInAndBiosData] Error during processing:",
      error,
    );
    process.exit(1);
  });
