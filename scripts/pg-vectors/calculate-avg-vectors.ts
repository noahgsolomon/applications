import * as schema from "../../server/db/schemas/users/schema";
import dotenv from "dotenv";
import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { and, eq, isNull } from "drizzle-orm";
dotenv.config({ path: "../../.env" });

const pool = new Pool({ connectionString: process.env.DB_URL });
export const db = drizzle(pool, {
  schema,
});

function computeAverageEmbedding(embeddings: number[][]): number[] {
  const vectorLength = embeddings[0].length;
  const sumVector = new Array(vectorLength).fill(0);

  embeddings.forEach((embedding) => {
    for (let i = 0; i < vectorLength; i++) {
      sumVector[i] += embedding[i];
    }
  });

  return sumVector.map((val) => val / embeddings.length);
}

async function updatePersonEmbeddings(personId: string, updates: any) {
  await db
    .update(schema.people)
    .set(updates)
    .where(eq(schema.people.id, personId));
}

async function computeAndStoreAverageEmbeddingsForAllUsers() {
  console.log("Starting to fetch all data...");
  // Fetch all data at the beginning
  const [
    allUsers,
    allSkills,
    allCompanies,
    allSchools,
    allFieldsOfStudy,
    allJobTitles,
    allLocations,
  ] = await Promise.all([
    db
      .select({ id: schema.people.id })
      .from(schema.people)
      .where(
        and(
          isNull(schema.people.averageSkillVector),
          isNull(schema.people.averageSchoolVector),
          isNull(schema.people.averageFieldOfStudyVector),
          isNull(schema.people.averageJobTitleVector),
          isNull(schema.people.locationVector),
          isNull(schema.people.averageCompanyVector)
        )
      ),
    db.select().from(schema.skillsNew),
    db.select().from(schema.companiesVectorNew),
    db.select().from(schema.schools),
    db.select().from(schema.fieldsOfStudy),
    db.select().from(schema.jobTitlesVectorNew),
    db.select().from(schema.locationsVector),
  ]);
  console.log("All data fetched successfully.");

  console.log(allCompanies.length);

  console.log(`Processing ${allUsers.length} users...`);
  for (let i = 0; i < allUsers.length; i++) {
    const user = allUsers[i];
    try {
      console.log(`Processing user ${i + 1} of ${allUsers.length}: ${user.id}`);
      const personId = user.id;
      const updates: any = {};

      // Skills
      const userSkills = allSkills.filter(
        (skill) => skill.personIds && skill.personIds.includes(personId)
      );
      const skillEmbeddings = userSkills.map((skill) => skill.vector);
      if (skillEmbeddings.length > 0) {
        updates.averageSkillVector = computeAverageEmbedding(skillEmbeddings);
      }

      // Companies
      const userCompanies = allCompanies.filter(
        (company) => company.personIds && company.personIds.includes(personId)
      );
      const companyEmbeddings = userCompanies.map((company) => company.vector);
      if (companyEmbeddings.length > 0) {
        updates.averageCompanyVector =
          computeAverageEmbedding(companyEmbeddings);
      }

      // Schools
      const userSchools = allSchools.filter(
        (school) => school.personIds && school.personIds.includes(personId)
      );
      const schoolEmbeddings = userSchools.map((school) => school.vector);
      if (schoolEmbeddings.length > 0) {
        updates.averageSchoolVector = computeAverageEmbedding(schoolEmbeddings);
      }

      // Fields of Study
      const userFieldsOfStudy = allFieldsOfStudy.filter(
        (field) => field.personIds && field.personIds.includes(personId)
      );
      const fieldOfStudyEmbeddings = userFieldsOfStudy.map(
        (field) => field.vector
      );
      if (fieldOfStudyEmbeddings.length > 0) {
        updates.averageFieldOfStudyVector = computeAverageEmbedding(
          fieldOfStudyEmbeddings
        );
      }

      // Job Titles
      const userJobTitles = allJobTitles.filter(
        (jobTitle) =>
          jobTitle.personIds && jobTitle.personIds.includes(personId)
      );
      const jobTitleEmbeddings = userJobTitles.map(
        (jobTitle) => jobTitle.vector
      );
      if (jobTitleEmbeddings.length > 0) {
        updates.averageJobTitleVector =
          computeAverageEmbedding(jobTitleEmbeddings);
      }

      // Location
      const userLocations = allLocations.filter(
        (location) =>
          location.personIds && location.personIds.includes(personId)
      );
      const locationEmbeddings = userLocations.map(
        (location) => location.vector
      );
      if (locationEmbeddings.length > 0) {
        updates.locationVector = computeAverageEmbedding(locationEmbeddings);
      }

      // Update the person's record
      if (Object.keys(updates).length > 0) {
        await updatePersonEmbeddings(personId, updates);
        console.log(`Updated embeddings for user: ${personId}`);
      } else {
        console.log(`No embeddings to update for user: ${personId}`);
      }
    } catch (error) {
      console.error(`Error updating embeddings for user ${user.id}:`, error);
    }
  }
  console.log("Finished processing all users.");
}

// Execute the function
console.log("Starting the embedding update process...");
computeAndStoreAverageEmbeddingsForAllUsers()
  .then(() => {
    console.log("All user embeddings updated successfully.");
  })
  .catch((error) => {
    console.error("Error updating user embeddings:", error);
  })
  .finally(() => {
    console.log("Embedding update process completed.");
  });
