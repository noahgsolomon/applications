import OpenAI from "openai";
import dotenv from "dotenv";
import * as userSchema from "../server/db/schemas/users/schema";
import { company as companyTable } from "../server/db/schemas/users/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";

dotenv.config({ path: "../.env" });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const connection = neon(process.env.DB_URL!);

const db = drizzle(connection, {
  schema: {
    ...userSchema,
  },
});

export const getTopFeatures = async (query: string) => {
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content: `Your primary task is to identify both the specialties and the technical features that are core to what the company does. Technical features refer to the specific functionalities, capabilities, or technologies central to the company's products or services. For example, for Slack, a technical feature might be "notifications" or "real-time messaging." For GitHub, it could be "version control" or "code collaboration." For Stripe, examples might include "payment processing" or "API integration."

If the input includes specialties but you believe others should be added, include these extra ones in the returned JSON. Additionally, if a company does not provide any specialties and you recognize the company, add relevant ones based on your understanding.

Return a JSON object with two attributes: "specialties" and "technicalFeatures". Ensure the list is comprehensive, focusing particularly on the technical features integral to the company's offerings.`,
      },
      {
        role: "user",
        content: query,
      },
    ],
    response_format: { type: "json_object" },
    model: "gpt-4o-mini",
    temperature: 0,
    max_tokens: 2048,
  });

  const response = JSON.parse(
    completion.choices[0].message.content ??
      "{specialties: [], technicalFeatures: []}",
  );
  return response as { specialties: string[]; technicalFeatures: string[] };
};

const main = async () => {
  const companies = await db.query.company.findMany();

  const updatePromises = companies.map(async (company) => {
    const specialties = company.linkedinData?.specialities ?? [];
    const tagline = company.linkedinData?.tagline ?? "";
    const description = company.linkedinData?.description ?? "";

    console.log(specialties, tagline, description);

    const specialtiesObj = await getTopFeatures(
      `company: ${company.name}, specialties: ${specialties.map((s: string) => s).join(", ")}. tagline: ${tagline}. description: ${description}`,
    );

    await db
      .update(companyTable)
      .set({
        specialties: specialtiesObj.specialties,
        topFeatures: specialtiesObj.technicalFeatures,
      })
      .where(eq(companyTable.id, company.id));
  });

  await Promise.all(updatePromises);
};

main();
