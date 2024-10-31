import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "../server/db/schemas/users/schema";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";

dotenv.config({ path: "../.env" });

const pool = new Pool({ connectionString: process.env.DB_URL });
const db = drizzle(pool, { schema });

// VC investments mapping
const vcInvestments = {
  "Andreessen Horowitz (a16z)": [
    "1Password",
    "Airbnb",
    "Asana",
    "Carta",
    "Clubhouse",
    "Coinbase",
    "Dapper Labs",
    "GitHub",
    "Instagram",
    "Instacart",
    "Lyft",
    "Medium",
    "OpenAI",
    "OpenSea",
    "Pinterest",
    "Quora",
    "Rarible",
    "Reddit",
    "Robinhood",
    "Slack",
    "Stripe",
    "Substack",
    "Twitter",
  ],
  "Sequoia Capital": [
    "Airbnb",
    "DoorDash",
    "Dropbox",
    "GitHub",
    "Instacart",
    "LinkedIn",
    "Reddit",
    "Square",
    "Stripe",
    "WhatsApp",
    "YouTube",
    "Zoom",
  ],
  "Benchmark Capital": ["Uber", "Twitter", "Dropbox"],
  "Accel Partners": ["Dropbox", "Facebook", "Slack", "Spotify"],
  "Kleiner Perkins": ["Google", "Slack", "Twitter", "Uber"],
  "GV (formerly Google Ventures)": [
    "GitLab",
    "Medium",
    "Robinhood",
    "Slack",
    "Uber",
  ],
  "Greylock Partners": ["Airbnb", "Dropbox", "Facebook", "LinkedIn"],
  "Lightspeed Venture Partners": [],
  "Bessemer Venture Partners": ["LinkedIn", "Pinterest"],
  "Union Square Ventures": ["Duolingo", "Etsy", "Tumblr", "Twitter"],
  "Index Ventures": ["Discord", "Dropbox", "Etsy", "Slack"],
  "Insight Partners": ["Twitter"],
  "New Enterprise Associates (NEA)": ["Duolingo", "MasterClass", "Robinhood"],
  "IVP (Institutional Venture Partners)": ["Slack", "Supercell", "Twitter"],
  "General Catalyst": ["Airbnb", "Stripe"],
  "Redpoint Ventures": ["Netflix", "Stripe", "Twilio"],
  "Battery Ventures": [],
  "Balderton Capital": ["Citymapper"],
  "First Round Capital": ["Notion", "Square", "Uber"],
  "Foundry Group": [],
  "Menlo Ventures": ["Uber"],
  "Norwest Venture Partners": ["Pinterest", "Spotify", "Uber"],
  "Sapphire Ventures": ["LinkedIn", "Square"],
  "SoftBank Vision Fund": ["DoorDash", "Slack", "TikTok", "Uber"],
  "Tiger Global Management": ["Facebook", "LinkedIn", "Spotify"],
  "Y Combinator": [
    "Airbnb",
    "Brex",
    "Coinbase",
    "DoorDash",
    "Dropbox",
    "Gusto",
    "Instacart",
    "Reddit",
    "Stripe",
    "Twitch",
  ],
};

async function updateCompanyVcInvestors() {
  try {
    // Get all companies from the database
    const companies = await db.query.company.findMany();

    // Create reverse mapping of company to VCs
    const companyToVCs = new Map<string, string[]>();

    // Build the reverse mapping
    Object.entries(vcInvestments).forEach(([vc, companies]) => {
      companies.forEach((company) => {
        const vcList = companyToVCs.get(company) || [];
        vcList.push(vc);
        companyToVCs.set(company, vcList);
      });
    });

    // Update each company with their VCs
    for (const company of companies) {
      const companyName = company.name;
      const vcList = companyToVCs.get(companyName) || [];

      if (vcList.length > 0) {
        console.log(`Updating ${companyName} with VCs:`, vcList);

        await db
          .update(schema.company)
          .set({
            vcInvestors: vcList,
          })
          .where(eq(schema.company.id, company.id));

        console.log(`Updated ${companyName} successfully`);
      }
    }

    console.log("Finished updating companies with VC investors");
  } catch (error) {
    console.error("Error updating companies with VC investors:", error);
  } finally {
    await pool.end();
  }
}

// Run the update
updateCompanyVcInvestors().catch(console.error);
