import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "../server/db/schemas/users/schema";
import dotenv from "dotenv";
import OpenAI from "openai";
import axios from "axios";
import { eq } from "drizzle-orm";

dotenv.config({ path: "../.env" });

const pool = new Pool({ connectionString: process.env.DB_URL });
const db = drizzle(pool, { schema });

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function getEmbedding(text: string): Promise<number[]> {
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: text,
  });

  if (!response.data.length) {
    throw new Error("No embeddings returned from OpenAI API");
  }

  return response.data[0].embedding;
}

const linkedinCompanyUrls = [
  "https://www.linkedin.com/company/1password/",
  "https://www.linkedin.com/company/airbnb/",
  "https://www.linkedin.com/company/getairchat/",
  "https://www.linkedin.com/company/tryamie/",
  "https://www.linkedin.com/company/any-distance/",
  "https://www.linkedin.com/company/app-store-apple/",
  "https://www.linkedin.com/company/applle-tv/",
  "https://www.linkedin.com/company/the-browser-company/",
  "https://www.linkedin.com/company/artifact-news/",
  "https://www.linkedin.com/company/asana/",
  "https://www.linkedin.com/company/ather-energy/",
  "https://www.linkedin.com/company/getatomsapp/",
  "https://www.linkedin.com/company/babbel-com/",
  "https://www.linkedin.com/company/elevate-labs-llc/",
  "https://www.linkedin.com/company/behance-inc-/",
  "https://www.linkedin.com/company/bevel-health/",
  "https://www.linkedin.com/company/letsblinkit/",
  "https://www.linkedin.com/company/brainly-com/",
  "https://www.linkedin.com/company/breathwrk/",
  "https://www.linkedin.com/company/brilliant-org/",
  "https://www.linkedin.com/company/canva/",
  "https://www.linkedin.com/company/captionsapp/",
  "https://www.linkedin.com/company/openai/",
  "https://www.linkedin.com/company/citymapper/",
  "https://www.linkedin.com/company/thecsms/",
  "https://www.linkedin.com/company/credapp/",
  "https://www.linkedin.com/company/letscreme/",
  "https://www.linkedin.com/company/dice-fm/",
  "https://www.linkedin.com/company/dropsetapp/",
  "https://www.linkedin.com/company/duolingo/",
  "https://www.linkedin.com/company/elevenlabsio/",
  "https://www.linkedin.com/company/endelsound/",
  "https://www.linkedin.com/company/foldmoney/",
  "https://www.linkedin.com/company/freeletics/",
  "https://www.linkedin.com/company/google-assistant/",
  "https://www.linkedin.com/company/google-photos/",
  "https://www.linkedin.com/company/gowalla/",
  "https://www.linkedin.com/company/headspace-meditation-limited/",
  "https://www.linkedin.com/company/hipstamatic/",
  "https://www.linkedin.com/company/how-we-feel/",
  "https://www.linkedin.com/company/instagram/",
  "https://www.linkedin.com/company/jupiter-money/",
  "https://www.linkedin.com/company/kayak/",
  "https://www.linkedin.com/company/klook/",
  "https://www.linkedin.com/company/krakenfx/",
  "https://www.linkedin.com/company/joinladder/",
  "https://www.linkedin.com/company/linearapp/",
  "https://www.linkedin.com/company/luma-hq/",
  "https://www.linkedin.com/company/macrofactor/",
  "https://www.linkedin.com/company/masterclassinc/",
  "https://www.linkedin.com/company/medium-com/",
  "https://www.linkedin.com/company/mileways/",
  "https://www.linkedin.com/company/mondaydotcom/",
  "https://www.linkedin.com/company/monopoly-go-24/",
  "https://www.linkedin.com/company/mymind-inc/",
  "https://www.linkedin.com/company/nammayatri/",
  "https://www.linkedin.com/company/netflix/",
  "https://www.linkedin.com/company/not-boring-co/",
  "https://www.linkedin.com/company/offsuit/",
  "https://www.linkedin.com/company/one-sec-app/",
  "https://www.linkedin.com/company/withopal/",
  "https://www.linkedin.com/company/patreon/",
  "https://www.linkedin.com/company/perplexity-ai/",
  "https://www.linkedin.com/company/phantomwallet/",
  "https://www.linkedin.com/company/pinterest/",
  "https://www.linkedin.com/company/create-with-play/",
  "https://www.linkedin.com/company/producthunt/",
  "https://www.linkedin.com/company/qatar-airways/",
  "https://www.linkedin.com/company/seatgeek/",
  "https://www.linkedin.com/company/shazam-entertainment/",
  "https://www.linkedin.com/company/skratchworld/",
  "https://www.linkedin.com/company/tiny-spec-inc/",
  "https://www.linkedin.com/company/smallcase/",
  "https://www.linkedin.com/company/soundcloud/",
  "https://www.linkedin.com/company/speechifyinc/",
  "https://www.linkedin.com/company/spoildotme/",
  "https://www.linkedin.com/company/spotify/",
  "https://www.linkedin.com/company/spotify-for-podcasters/",
  "https://www.linkedin.com/company/sunlitt/",
  "https://www.linkedin.com/company/superlistapp/",
  "https://www.linkedin.com/company/swiggy-in/",
  "https://www.linkedin.com/company/telegram-messenger/",
  "https://www.linkedin.com/company/tiimo/",
  "https://www.linkedin.com/company/uber-com/",
  "https://www.linkedin.com/company/waterllama/",
  "https://www.linkedin.com/company/waze/",
  "https://www.linkedin.com/company/whoop/",
  "https://www.linkedin.com/company/wiseaccount/",
  "https://www.linkedin.com/company/youtube/",
  "https://www.linkedin.com/company/zomato/",
];

async function scrapeLinkedInCompany(linkedinCompanyUrl: string) {
  console.log(`Scraping LinkedIn company for URL: ${linkedinCompanyUrl}`);
  const options = {
    method: "GET",
    url: `https://api.scrapin.io/enrichment/company`,
    params: {
      apikey: process.env.SCRAPIN_API_KEY!,
      linkedInUrl: linkedinCompanyUrl,
    },
  };

  try {
    const response = await axios.request(options);
    console.log("Company data fetched successfully.");
    return response.data;
  } catch (error) {
    console.error(
      `Error fetching LinkedIn company data for ${linkedinCompanyUrl}:`,
      error
    );
    return null;
  }
}

async function addCompanies() {
  for (const linkedinUrl of linkedinCompanyUrls) {
    try {
      const companyDataRes = await scrapeLinkedInCompany(linkedinUrl);
      if (!companyDataRes) {
        console.error(`No data returned for ${linkedinUrl}`);
        continue;
      }

      const companyData = companyDataRes.company;

      console.log(companyData);

      // Extract required fields from companyData
      const companyName = companyData.name ?? "";
      const linkedinId = companyData.linkedInId ?? "";

      if (!companyName || !linkedinId) {
        console.error(`Missing essential data for company from ${linkedinUrl}`);
        continue;
      }

      // Check if the company already exists
      const existingCompany = await db.query.company.findFirst({
        where: eq(schema.company.linkedinId, linkedinId),
        columns: {
          id: true,
        },
      });

      if (existingCompany) {
        console.log(
          `Company with LinkedIn ID ${linkedinId} exists. Updating vector and groups.`
        );

        const companyNameVector = await getEmbedding(companyName);

        await db
          .update(schema.company)
          .set({
            companyNameVector: companyNameVector,
            groups: ["60fps.design"],
          })
          .where(eq(schema.company.linkedinId, linkedinId));

        console.log(`Updated company: ${companyName}`);
        continue;
      }

      // Compute the companyNameVector
      const companyNameVector = await getEmbedding(companyName);

      // Prepare company data for insertion
      const newCompanyData = {
        linkedinId: linkedinId,
        name: companyName,
        universalName: companyData.universalName || null,
        linkedinUrl: linkedinUrl,
        employeeCount: companyData.employeeCount || null,
        websiteUrl: companyData.websiteUrl || null,
        tagline: companyData.tagline || null,
        description: companyData.description || null,
        industry: companyData.industry || null,
        phone: companyData.phone || null,
        specialities: companyData.specialities || [],
        headquarter: companyData.headquarter || null,
        logo: companyData.logo || null,
        foundedOn: companyData.foundedOn || null,
        linkedinData: companyData,
        topTechnologies: companyData.topTechnologies || [],
        topFeatures: companyData.topFeatures || [],
        specialties: companyData.specialties || [],
        companyNameVector: companyNameVector,
        groups: ["60fps.design"],
      };

      // Insert the company into the database
      await db.insert(schema.company).values(newCompanyData);

      console.log(`Inserted company: ${companyName}`);
    } catch (error) {
      console.error(`Error processing company URL ${linkedinUrl}:`, error);
    }
  }

  console.log("Finished adding companies.");
}

async function main() {
  await addCompanies();
  await pool.end();
}

main().catch((error) => {
  console.error("Error in main:", error);
});
