import axios from "axios";
import * as userSchema from "../server/db/schemas/users/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import dotenv from "dotenv";

dotenv.config({
  path: "../.env",
});

const connection = neon(process.env.DB_URL!);

const db = drizzle(connection, {
  schema: {
    ...userSchema,
  },
});

const scrapeCompanyProfile = async (linkedinUrl: string) => {
  const options = {
    method: "GET",
    url: "https://api.scrapin.io/enrichment/company",
    params: {
      apikey: process.env.SCRAPIN_API_KEY,
      linkedInUrl: linkedinUrl,
    },
  };

  try {
    const response = await axios.request(options);
    return response.data;
  } catch (error) {
    console.error(`Error fetching company profile data: ${error}`);
    return null;
  }
};

const processCompanyProfile = async (linkedinUrl: string) => {
  const companyData = await scrapeCompanyProfile(linkedinUrl);

  if (companyData && companyData.success) {
    const { company } = companyData;
    await db.insert(userSchema.company).values({
      linkedinId: company.linkedInId,
      name: company.name,
      universalName: company.universalName,
      linkedinUrl: company.linkedInUrl,
      employeeCount: company.employeeCount,
      websiteUrl: company.websiteUrl,
      tagline: company.tagline,
      description: company.description,
      industry: company.industry,
      phone: company.phone,
      specialities: company.specialities,
      headquarter: company.headquarter,
      logo: company.logo,
      foundedOn: company.foundedOn,
      linkedinData: company,
    });
    console.log(`Company profile for ${company.name} inserted successfully.`);
  } else {
    console.error(`Failed to process company profile for URL: ${linkedinUrl}`);
  }
};

// already included: browser company, vercel
const companies = [
  // "https://www.linkedin.com/company/tiktok",
  // "https://www.linkedin.com/company/airbnb",
  // "https://www.linkedin.com/company/lyft",
  // "https://www.linkedin.com/company/uber",
  // "https://www.linkedin.com/company/saturn",
  // "https://www.linkedin.com/company/linear",
  // "https://www.linkedin.com/company/cash-app",
  // "https://www.linkedin.com/company/match-group",
  // "https://www.linkedin.com/company/apple",
  // "https://www.linkedin.com/company/discord",
  // "https://www.linkedin.com/company/x-corp",
  // "https://www.linkedin.com/company/calendly",
  // "https://www.linkedin.com/company/addglow",
  // "https://www.linkedin.com/company/circle-internet-financial/",
  // "https://www.linkedin.com/company/locals-creator/",
  // "https://www.linkedin.com/company/hivebrite",
  // "https://www.linkedin.com/company/frondcom",
  // "https://www.linkedin.com/company/skillshare-com/",
  // "https://www.linkedin.com/company/sellfy",
  // "https://www.linkedin.com/company/payhip",
  // "https://www.linkedin.com/company/samcart-llc/",
  // "https://www.linkedin.com/company/shopify",
  // "https://www.linkedin.com/company/etsy",
  // "https://www.linkedin.com/company/beacons",
  // "https://www.linkedin.com/company/outseta",
  // "https://www.linkedin.com/company/uscreen-tv/",
  // "https://www.linkedin.com/company/substack",
  // "https://www.linkedin.com/company/stripe",
  // "https://www.linkedin.com/company/webflow-inc-/",
  // "https://www.linkedin.com/company/squarespace",
  // "https://www.linkedin.com/company/wix-com/",
  // "https://www.linkedin.com/company/instagram",
  // "https://www.linkedin.com/company/snap-inc-co/",
  // "https://www.linkedin.com/company/twitch-tv/",
  // "https://www.linkedin.com/company/whatsapp./",
  // "https://www.linkedin.com/company/dropbox",
  // "https://www.linkedin.com/company/facebook",
  // "https://www.linkedin.com/company/meta",
  // "https://www.linkedin.com/company/ramp",
  // "https://www.linkedin.com/company/splinetool/",
  // "https://www.linkedin.com/company/deel",
  // "https://www.linkedin.com/company/tumblr",
  // "https://www.linkedin.com/company/pinterest",
  // "https://www.linkedin.com/company/skype",
  // "https://www.linkedin.com/company/zoom",
  // "https://www.linkedin.com/company/quora",
  // "https://www.linkedin.com/company/clubhouse-app/",
  // "https://www.linkedin.com/company/roblox",
  // "https://www.linkedin.com/company/valve-corporation",
  // "https://www.linkedin.com/company/duolingo",
  // "https://www.linkedin.com/company/robinhood",
  // "https://www.linkedin.com/company/doordash",
  // "https://www.linkedin.com/company/instacart",
  // "https://www.linkedin.com/company/joinblock/",
  // "https://www.linkedin.com/company/tinder-incorporated/",
  // "https://www.linkedin.com/company/linkedin",
  // "https://www.linkedin.com/company/tiktokshop/",
  // "https://www.linkedin.com/company/carta--/",
  // "https://www.linkedin.com/company/brexhq/",
  // "https://www.linkedin.com/company/gustohq/",
  // "https://www.linkedin.com/company/tailwind-labs/",
  // "https://www.linkedin.com/company/slack",
  // "https://www.linkedin.com/company/github",
  // "https://www.linkedin.com/company/notionhq/",
  // "https://www.linkedin.com/company/asana",
  // "https://www.linkedin.com/company/twilio-inc-/",
  // "https://www.linkedin.com/company/craftdocs/",
  // "https://www.linkedin.com/company/teamwechat/",
  // "https://www.linkedin.com/company/wechat-pay",
  // "https://www.linkedin.com/company/trello",
  // "https://www.linkedin.com/company/textshq/",
  // "https://www.linkedin.com/company/netlify",
  // "https://www.linkedin.com/company/netflix",
  // "https://www.linkedin.com/company/riot-games",
  // "https://www.linkedin.com/company/farcaster",
  // "https://www.linkedin.com/company/supabase",
  // "https://www.linkedin.com/company/lichess/",
  // "https://www.linkedin.com/company/chess.com",
  // "https://www.linkedin.com/company/withopal/",
  // "https://www.linkedin.com/company/sunlitt",
  // "https://www.linkedin.com/company/cosmicvibrations/",
  // "https://www.linkedin.com/company/getatomsapp/",
  // "https://www.linkedin.com/company/copilotplatforms/",
  // "https://www.linkedin.com/company/w1d1",
  // "https://www.linkedin.com/company/luma-ai",
  // "https://www.linkedin.com/company/partiful",
  // "https://www.linkedin.com/company/shazam-entertainment/",
  // "https://www.linkedin.com/company/splice-com/",
  // "https://www.linkedin.com/company/captionsapp/",
  // "https://www.linkedin.com/company/pytorch-lightning/",
  // "https://www.linkedin.com/company/clickup-app/",
  // "https://www.linkedin.com/company/fastly",
  // "https://www.linkedin.com/company/youtube",
  // "https://www.linkedin.com/company/candydigital/",
  // "https://www.linkedin.com/company/dapper-labs",
  // "https://www.linkedin.com/company/opensea-io/",
  // "https://www.linkedin.com/company/rarible",
  // "https://www.linkedin.com/company/binance",
  // "https://www.linkedin.com/company/magic-eden",
  // "https://www.linkedin.com/company/consensys-software-inc/",
  "https://www.linkedin.com/company/gitlab-com/",
  "https://www.linkedin.com/products/atlassian-bitbucket/",
  "https://www.linkedin.com/company/figma/",
  "https://www.linkedin.com/company/mirohq/",
  "https://www.linkedin.com/company/airtable/",
  "https://www.linkedin.com/company/mondaydotcom/",
  "https://www.linkedin.com/products/atlassian-jira/",
  "https://www.linkedin.com/company/zapier/",
  "https://www.linkedin.com/company/invisionapp/",
  "https://www.linkedin.com/company/typeform-/",
  "https://www.linkedin.com/company/mixpanel-inc-/",
  "https://www.linkedin.com/company/amplitude-analytics/",
  "https://www.linkedin.com/company/heap-inc-/",
  "https://www.linkedin.com/company/datadog/",
  "https://www.linkedin.com/company/new-relic-inc-/",
  "https://www.linkedin.com/company/intuit/",
  "https://www.linkedin.com/company/hubspot/",
  "https://www.linkedin.com/company/pipedrive/",
  "https://www.linkedin.com/company/salesforce/",
  "https://www.linkedin.com/company/zendesk/",
  "https://www.linkedin.com/company/intercom/",
  "https://www.linkedin.com/company/tiny-spec-inc/",
  "https://www.linkedin.com/company/repl-it/",
  "https://www.linkedin.com/company/dribbble/",
  "https://www.linkedin.com/company/behance-inc-/",
  "https://www.linkedin.com/company/producthunt/",
  "https://www.linkedin.com/company/angellist/",
  "https://www.linkedin.com/company/crunchbase/",
  "https://www.linkedin.com/company/joinsquare/",
  "https://www.linkedin.com/company/plaid-/",
];

async function main() {
  for (let i = 0; i < companies.length; i += 10) {
    const batch = companies
      .slice(i, i + 10)
      .map((company) => processCompanyProfile(company));

    await Promise.all(batch);

    await new Promise((resolve) => setTimeout(resolve, 10000));
  }

  // await processCompanyProfile(
  //   "https://www.linkedin.com/company/saturntechnologies/",
  // );
}

main().catch((error) => console.error(error));

// questionable: ['fourth wall', 'disco', 'aime', 'paper', 'axie infinity', 'looks rare', 'solana labs']
