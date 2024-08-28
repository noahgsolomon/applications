import dotenv from "dotenv";
import * as userSchema from "../server/db/schemas/users/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { inArray } from "drizzle-orm";
import fs from "fs";

dotenv.config({
  path: "../.env",
});

const connection = neon(process.env.DB_URL!);
const db = drizzle(connection, {
  schema: {
    ...userSchema,
  },
});

async function updateCompanyIds(filePath: string, companyId: string) {
  console.log(`Processing file: ${filePath}`);
  const fileContent = fs.readFileSync(filePath, "utf-8");
  const employees = JSON.parse(fileContent);

  const urls = employees.flatMap((employee: any) => {
    const url = employee.profileUrl;
    if (!url) {
      console.log("Skipping employee with no profileUrl");
      return [];
    }
    return [url, url.endsWith("/") ? url.slice(0, -1) : url + "/"];
  });

  console.log(`Updating companyId for ${urls.length} candidates...`);

  const result = await db
    .update(userSchema.candidates)
    .set({ companyId: companyId })
    .where(inArray(userSchema.candidates.url, urls));

  console.log(`Updated ${result.rowCount} candidates.`);
}

async function main() {
  const filePath = "./companies/ueno.json";
  const companyId = "03c1b280-98f9-42de-ae8b-4c900f12ba9e";

  await updateCompanyIds(filePath, companyId);
}

main().catch(console.error);
