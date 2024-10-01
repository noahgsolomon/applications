import { drizzle } from "drizzle-orm/neon-serverless";
import { Pool } from "@neondatabase/serverless";
import { and, eq, isNotNull, or } from "drizzle-orm/expressions";
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

// Utility function to chunk an array into smaller arrays of a specified size
function chunkArray<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

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
    Extract information from the following bio. Return an object in the JSON format:
    {
      companies: string[],
      education: { schoolName: string, fieldOfStudy: string }[]
    }
    Ensure the array 'companies' is empty if no companies are mentioned. Each 'education' entry must have a non-null 'schoolName' or 'fieldOfStudy'. If none are mentioned, return an empty array for 'education'. Remember, ALWAYS return in valid JSON format. Example output if (more likely than not), their bio does not contain companies or education:
{
companies: [],
education: []
}

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
    temperature: 0,
    response_format: { type: "json_object" },
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

  try {
    // Step 1: Fetch all people with LinkedIn data or Twitter/GitHub bios
    const allPeople = await db
      .select()
      .from(people)
      .where(
        and(
          or(
            isNotNull(people.linkedinData),
            isNotNull(people.twitterBio),
            isNotNull(people.githubBio),
            isNotNull(people.githubCompany),
            isNotNull(people.organizations),
          ),
          eq(people.isEducationChecked, false),
        ),
      );

    console.log(
      `[processLinkedInAndBiosData] Found ${allPeople.length} people with data.`,
    );

    if (allPeople.length === 0) {
      console.log("[processLinkedInAndBiosData] No people found to process.");
      return;
    }

    // Step 2: Chunk the people into manageable batches (e.g., 1000 per batch)
    const batchSize = 1000;
    const batches = chunkArray(allPeople, batchSize);

    console.log(
      `[processLinkedInAndBiosData] Processing ${batches.length} batches of up to ${batchSize} people each.`,
    );

    // Step 3: Process each batch sequentially
    for (const [batchIndex, batch] of batches.entries()) {
      console.log(
        `[processLinkedInAndBiosData] Processing batch ${batchIndex + 1} of ${batches.length}...`,
      );

      // Process all people in the current batch concurrently
      await Promise.all(
        batch.map(async (person) => {
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
          let educationData: { schoolName: string; fieldOfStudy: string }[] =
            [];

          // Extract companies and education from LinkedIn data
          if ((linkedinData as any)?.positions?.positionHistory) {
            for (const position of (linkedinData as any).positions
              .positionHistory) {
              const companyName = position.companyName;
              if (companyName) {
                companies.push(companyName);
              }
            }
          }

          if ((linkedinData as any)?.schools?.educationHistory) {
            for (const school of (linkedinData as any).schools
              .educationHistory) {
              const schoolName = school.schoolName;
              const fieldOfStudy = school.fieldOfStudy;
              if (schoolName || fieldOfStudy) {
                educationData.push({ schoolName, fieldOfStudy });
              }
            }
          }

          let bio = "";
          if (twitterBio) bio += twitterBio + " ";
          if (githubData && (githubData as any).bio) {
            bio += (githubData as any).bio;
          }

          // Extract companies and education from Twitter/GitHub bio
          if (bio.trim() !== "") {
            const data = await extractStructuredData(bio);
            companies = companies.concat(data.companies);
            educationData = educationData.concat(data.education);
          }

          // Remove duplicate companies
          companies = Array.from(new Set(companies));

          // Insert company embeddings
          for (const company of companies) {
            await insertCompanyEmbedding(personId, company);
          }

          // Insert education embeddings
          for (const edu of educationData) {
            if (edu.schoolName) {
              await insertEducationEmbedding(
                personId,
                edu.schoolName,
                edu.fieldOfStudy,
              );
            }
          }

          await db
            .update(people)
            .set({ isEducationChecked: true })
            .where(eq(people.id, personId));

          console.log(
            `[insertEducationEmbedding] Updated person ID: ${personId} to set isEducationChecked to true`,
          );
        }),
      );

      console.log(
        `[processLinkedInAndBiosData] Completed batch ${batchIndex + 1} of ${batches.length}.`,
      );
    }

    console.log("[processLinkedInAndBiosData] Processing completed.");
  } catch (error) {
    console.error(
      "[processLinkedInAndBiosData] Error during processing:",
      error,
    );
  }
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
