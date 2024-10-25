import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "../server/db/schemas/users/schema";
import { and, eq, isNotNull, isNull, ne } from "drizzle-orm";
import dotenv from "dotenv";

dotenv.config({ path: "../.env" });

const pool = new Pool({ connectionString: process.env.DB_URL });
const db = drizzle(pool, { schema });

async function updateLinkedinUrls() {
  // Fetch all people where linkedinUrl is null
  const peopleWithoutLinkedinUrl = await db.query.people.findMany({
    where: and(
      isNull(schema.people.linkedinUrl),
      isNotNull(schema.people.linkedinData)
    ),
    columns: {
      id: true,
      linkedinData: true,
    },
  });

  console.log(
    `Found ${peopleWithoutLinkedinUrl.length} people without linkedinUrl`
  );

  for (const person of peopleWithoutLinkedinUrl) {
    const linkedinData = person.linkedinData;

    if (linkedinData && (linkedinData as any).linkedInUrl) {
      const linkedInUrlFromData = (linkedinData as any).linkedInUrl.trim();

      const existingPerson = await db.query.people.findFirst({
        where: and(
          eq(schema.people.linkedinUrl, linkedInUrlFromData),
          ne(schema.people.id, person.id)
        ),
        columns: {
          id: true,
        },
      });

      if (existingPerson) {
        // Delete the current person (with null linkedinUrl)
        await db.delete(schema.people).where(eq(schema.people.id, person.id));
        console.log(`Deleted duplicate person with ID: ${person.id}`);
      } else {
        // Update the current person to set linkedinUrl
        await db
          .update(schema.people)
          .set({ linkedinUrl: linkedInUrlFromData })
          .where(eq(schema.people.id, person.id));
        console.log(`Updated person ID ${person.id} with linkedinUrl.`);
      }
    } else {
      console.log(
        `Person ID ${person.id} has no linkedInUrl in linkedinData. Skipping.`
      );
      //   await db.delete(schema.people).where(eq(schema.people.id, person.id));
    }
  }

  console.log("Finished updating linkedinUrl fields.");
}

updateLinkedinUrls().catch((error) => {
  console.error("Error updating LinkedIn URLs:", error);
});
