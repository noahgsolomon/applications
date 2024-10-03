import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNotNull } from "drizzle-orm/expressions";
import * as schema from "../../server/db/schemas/users/schema";
import {
  companiesVectorNew,
  schools,
  fieldsOfStudy,
  people,
} from "../../server/db/schemas/users/schema";
import { Pool } from "@neondatabase/serverless";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config({ path: "../../.env" });

// Utility function to chunk array into smaller arrays
function chunk<T>(array: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(array.length / size) }, (_, index) =>
    array.slice(index * size, index * size + size),
  );
}

// Initialize OpenAI with API key
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
});

// Initialize the database connection
const pool = new Pool({ connectionString: process.env.DB_URL });
const db = drizzle(pool, {
  schema,
});

// Function to fetch embeddings for a given text
async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: text,
  });

  if (!response.data || response.data.length === 0) {
    throw new Error("No embedding returned from OpenAI API");
  }

  return response.data[0].embedding;
}

// Function to insert or update company in companiesVectorNew table
async function upsertCompanyEmbedding(personId: string, company: string) {
  try {
    const existingCompany = await db
      .select()
      .from(companiesVectorNew)
      .where(eq(companiesVectorNew.company, company))
      .limit(1);

    if (existingCompany.length > 0) {
      const currentPersonIds = existingCompany[0].personIds || [];
      const updatedPersonIds = Array.from(
        new Set([...currentPersonIds, personId]),
      );

      if (currentPersonIds.length === updatedPersonIds.length) {
        console.log(
          `[upsertCompanyEmbedding] Company "${company}" already exists for person ID: ${personId}`,
        );
        return;
      }

      await db
        .update(companiesVectorNew)
        .set({ personIds: updatedPersonIds })
        .where(eq(companiesVectorNew.company, company));

      console.log(
        `[upsertCompanyEmbedding] Updated company "${company}" with person ID: ${personId}`,
      );
    } else {
      const companyVector = await getEmbedding(company);

      await db
        .insert(companiesVectorNew)
        .values({
          personIds: [personId],
          company,
          vector: companyVector,
        })
        .onConflictDoNothing();

      console.log(
        `[upsertCompanyEmbedding] Inserted new company "${company}" with person ID: ${personId}`,
      );
    }
  } catch (error) {
    console.error(
      `[upsertCompanyEmbedding] Error processing company "${company}" for person ID: ${personId}`,
      error,
    );
  }
}

// Function to insert or update school in schools table
async function upsertSchoolEmbedding(personId: string, school: string) {
  try {
    const existingSchool = await db
      .select()
      .from(schools)
      .where(eq(schools.school, school))
      .limit(1);

    if (existingSchool.length > 0) {
      const currentPersonIds = existingSchool[0].personIds || [];
      const updatedPersonIds = Array.from(
        new Set([...currentPersonIds, personId]),
      );

      if (currentPersonIds.length === updatedPersonIds.length) {
        console.log(
          `[upsertSchoolEmbedding] School "${school}" already exists for person ID: ${personId}`,
        );
        return;
      }

      await db
        .update(schools)
        .set({ personIds: updatedPersonIds })
        .where(eq(schools.school, school));

      console.log(
        `[upsertSchoolEmbedding] Updated school "${school}" with person ID: ${personId}`,
      );
    } else {
      const schoolVector = await getEmbedding(school);

      await db
        .insert(schools)
        .values({
          personIds: [personId],
          school,
          vector: schoolVector,
        })
        .onConflictDoNothing();

      console.log(
        `[upsertSchoolEmbedding] Inserted new school "${school}" with person ID: ${personId}`,
      );
    }
  } catch (error) {
    console.error(
      `[upsertSchoolEmbedding] Error processing school "${school}" for person ID: ${personId}`,
      error,
    );
  }
}

// Function to insert or update field of study in fieldsOfStudy table
async function upsertFieldOfStudyEmbedding(
  personId: string,
  fieldOfStudy: string,
) {
  try {
    const existingFieldOfStudy = await db
      .select()
      .from(fieldsOfStudy)
      .where(eq(fieldsOfStudy.fieldOfStudy, fieldOfStudy))
      .limit(1);

    if (existingFieldOfStudy.length > 0) {
      const currentPersonIds = existingFieldOfStudy[0].personIds || [];
      const updatedPersonIds = Array.from(
        new Set([...currentPersonIds, personId]),
      );

      if (currentPersonIds.length === updatedPersonIds.length) {
        console.log(
          `[upsertFieldOfStudyEmbedding] Field of study "${fieldOfStudy}" already exists for person ID: ${personId}`,
        );
        return;
      }

      await db
        .update(fieldsOfStudy)
        .set({ personIds: updatedPersonIds })
        .where(eq(fieldsOfStudy.fieldOfStudy, fieldOfStudy));

      console.log(
        `[upsertFieldOfStudyEmbedding] Updated field of study "${fieldOfStudy}" with person ID: ${personId}`,
      );
    } else {
      const fieldOfStudyVector = await getEmbedding(fieldOfStudy);

      await db
        .insert(fieldsOfStudy)
        .values({
          personIds: [personId],
          fieldOfStudy,
          vector: fieldOfStudyVector,
        })
        .onConflictDoNothing();

      console.log(
        `[upsertFieldOfStudyEmbedding] Given a location, return the uppercase state name if it's a US location, or the uppercase country name if it's outside the US. If it's a city, return the state (for US) or country it's in. If unsure or the location is invalid, return "UNKNOWN".
Examples:
- New York City -> NEW YORK
- New York -> NEW YORK
- London -> UNITED KINGDOM
- California -> CALIFORNIA
- Tokyo -> JAPAN
- Paris, France -> FRANCE
- Sydney -> AUSTRALIA
- 90210 -> CALIFORNIA
- Earth -> UNKNOWNInserted new field of study "${fieldOfStudy}" with person ID: ${personId}`,
      );
    }
  } catch (error) {
    console.error(
      `[upsertFieldOfStudyEmbedding] Error processing field of study "${fieldOfStudy}" for person ID: ${personId}`,
      error,
    );
  }
}

// Main function to process LinkedIn data
async function processLinkedInData() {
  console.log("[processLinkedInData] Starting processing...");

  try {
    // Fetch all people with LinkedIn data
    const allPeople = await db
      .select()
      .from(people)
      .where(isNotNull(people.linkedinData));

    console.log(
      `[processLinkedInData] Found ${allPeople.length} people with LinkedIn data.`,
    );

    if (allPeople.length === 0) {
      console.log("[processLinkedInData] No people found to process.");
      return;
    }

    // Split people into batches of 100
    const batches = chunk(allPeople, 100);

    // Process each batch
    for (let i = 0; i < batches.length; i++) {
      console.log(
        `[processLinkedInData] Processing batch ${i + 1} of ${batches.length}`,
      );
      const batch = batches[i];

      // Process each person in the batch concurrently
      await Promise.all(
        batch.map(async (person) => {
          const { id: personId, linkedinData } = person;

          // Extract companies from LinkedIn data
          const companies = (
            (linkedinData as any).positions?.positionHistory || []
          )
            .map((job: any) => job.companyName)
            .filter(Boolean);

          // Extract schools and fields of study from LinkedIn data
          const educationHistory =
            (linkedinData as any).schools?.educationHistory || [];
          const schoolsList = educationHistory
            .map((school: any) => school.schoolName)
            .filter(Boolean);
          const fieldsOfStudyList = educationHistory
            .map((school: any) => school.fieldOfStudy)
            .filter(Boolean);

          // Insert or update company embeddings
          await Promise.all(
            companies.map((company: any) =>
              upsertCompanyEmbedding(personId, company),
            ),
          );

          // Insert or update school embeddings
          await Promise.all(
            schoolsList.map((school: any) =>
              upsertSchoolEmbedding(personId, school),
            ),
          );

          // Insert or update field of study embeddings
          await Promise.all(
            fieldsOfStudyList.map((fieldOfStudy: any) =>
              upsertFieldOfStudyEmbedding(personId, fieldOfStudy),
            ),
          );
        }),
      );

      console.log(`[processLinkedInData] Completed processing batch ${i + 1}`);
    }

    console.log("[processLinkedInData] Processing completed for all batches.");
  } catch (error) {
    console.error("[processLinkedInData] Error during processing:", error);
  }
}

// Execute the main function
processLinkedInData()
  .then(() => {
    console.log("[processLinkedInData] Script finished successfully.");
    process.exit(0);
  })
  .catch((error) => {
    console.error("[processLinkedInData] Error during processing:", error);
    process.exit(1);
  });
