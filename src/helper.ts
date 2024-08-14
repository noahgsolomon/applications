import axios from "axios";
import OpenAI from "openai";
import { type db as dbType } from "@/server/db";
import { InferSelectModel, and, eq, inArray } from "drizzle-orm";
import {
  pendingOutbound as pendingOutboundTable,
  pendingCompanyOutbound as pendingCompanyOutboundTable,
  outbound as outboundTable,
  candidates as candidatesTable,
  outboundCandidates as outboundCandidatesTable,
  outboundCandidates,
  outboundCompanies,
  candidates,
} from "@/server/db/schemas/users/schema";
//@ts-ignore
import { v4 as uuid } from "uuid";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const NUM_PROFILES = 10;

const JOB_DESCRIPTION = `
As a Staff Frontend Engineer, you will lead our frontend team, ensuring high performance, low latency, and exceptional user experiences. You will solve frontend challenges, implement comprehensive testing frameworks, and mentor our engineering team.

Key Responsibilities:

Lead frontend projects including a consumer-side marketplace, chat, and live streaming.
Implement unit, end-to-end, and integration tests.
Enhance performance and observability.
Establish dashboards to track performance and errors.
Dictate direction of frontend frameworks and tools.
Qualifications:

Expert with React and Next.js.
Strong understanding of TypeScript.
Experience with other web frameworks (e.g., Angular, Vue.js).
Proven track record of optimizing frontend performance.
Experience setting up and maintaining testing frameworks.
Familiarity with observability tools (e.g., NewRelic).
Proven experience leading and mentoring a team of 10+ engineers.
Strong communication skills for collaborating with design, product, and growth teams.
Nice to Haves:

Experience with Ruby / Rails.
Experience working with high performing SEO websites.
Experience building consumer-facing products with high usability.
Experience building chat applications.
Experience in optimizing web app resource usage.`;

async function getEmbedding(
  text: string,

  pendingOutbound:
    | InferSelectModel<typeof pendingCompanyOutboundTable>
    | InferSelectModel<typeof pendingOutboundTable>,
  { db }: { db: typeof dbType },
): Promise<number[]> {
  await logUpdate(`Getting embedding for text...`, pendingOutbound, { db });
  const response = await openai.embeddings.create({
    model: "text-embedding-ada-002",
    input: text,
  });
  await logUpdate(`Received embedding.`, pendingOutbound, { db });
  return response.data[0].embedding;
}

function cosineSimilarity(
  vec1: number[],
  vec2: number[],

  pendingOutbound:
    | InferSelectModel<typeof pendingCompanyOutboundTable>
    | InferSelectModel<typeof pendingOutboundTable>,
  { db }: { db: typeof dbType },
): number {
  logUpdate(`Calculating cosine similarity...`, pendingOutbound, { db });
  const dotProduct = vec1.reduce((acc, val, i) => acc + val * vec2[i], 0);
  const magnitude1 = Math.sqrt(vec1.reduce((acc, val) => acc + val * val, 0));
  const magnitude2 = Math.sqrt(vec2.reduce((acc, val) => acc + val * val, 0));
  const similarity = dotProduct / (magnitude1 * magnitude2);
  logUpdate(`Cosine similarity calculated.`, pendingOutbound, { db });
  return similarity;
}

const googleSearch = async (
  booleanSearch: string,
  apiKey: string,
  cseId: string,

  pendingOutbound:
    | InferSelectModel<typeof pendingCompanyOutboundTable>
    | InferSelectModel<typeof pendingOutboundTable>,
  { db }: { db: typeof dbType },
) => {
  await logUpdate(`Starting Google search...`, pendingOutbound, { db });
  let searchResults: any[] = [];
  let start = 1;
  while (searchResults.length < NUM_PROFILES) {
    await logUpdate(`Fetching results from ${start}...`, pendingOutbound, {
      db,
    });
    const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(`site:${pendingOutbound.nearBrooklyn ? "www.linkedin.com/in" : "www.linkedin.com/in"} ${booleanSearch}`)}&key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cseId)}&start=${encodeURIComponent(start)}`;
    try {
      const response = await axios.get(url);
      const results = response.data.items;
      if (results) {
        results.forEach((result: any) => {
          if (
            result.link.includes(
              `${pendingOutbound.nearBrooklyn ? "www.linkedin.com/in" : "www.linkedin.com/in"}`,
            )
          ) {
            searchResults.push(result);
          }
        });
        if (results.length < 10) {
          await logUpdate(
            `Less than 10 results returned, breaking loop...`,
            pendingOutbound,
            { db },
          );
          break;
        }
      } else {
        await logUpdate(`No results found, breaking loop...`, pendingOutbound, {
          db,
        });
        break;
      }
    } catch (error) {
      await logUpdate(
        `Error fetching search results: ${error}`,
        pendingOutbound,
        { db },
      );
      console.error(`Error fetching search results: ${error}`);
      break;
    }
    start += 10;
  }
  await logUpdate(`Google search completed.`, pendingOutbound, { db });
  return searchResults;
};

const scrapeLinkedInProfile = async (
  linkedinUrl: string,

  pendingOutbound:
    | InferSelectModel<typeof pendingCompanyOutboundTable>
    | InferSelectModel<typeof pendingOutboundTable>,
  { db }: { db: typeof dbType },
) => {
  await logUpdate(
    `Scraping LinkedIn profile: ${linkedinUrl}`,
    pendingOutbound,
    { db },
  );
  const options = {
    method: "GET",
    url: `https://api.scrapin.io/enrichment/profile`,
    params: {
      apikey: process.env.SCRAPIN_API_KEY,
      linkedInUrl: linkedinUrl,
    },
  };

  try {
    const response = await axios.request(options);
    await logUpdate(
      `Profile data retrieved for ${linkedinUrl}`,
      pendingOutbound,
      { db },
    );
    return response.data;
  } catch (error) {
    await logUpdate(
      `Error fetching LinkedIn profile data: ${error}`,
      pendingOutbound,
      { db },
    );
    console.error(`Error fetching LinkedIn profile data: ${error}`);
    return null;
  }
};

const generateMiniSummary = async (
  profileData: any,

  pendingOutbound:
    | InferSelectModel<typeof pendingCompanyOutboundTable>
    | InferSelectModel<typeof pendingOutboundTable>,
  { db }: { db: typeof dbType },
) => {
  await logUpdate(`Generating summary for profile...`, pendingOutbound, { db });
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          "You are to take in this person's LinkedIn profile data, and generate a 1-2 sentence summary of their experience",
      },
      {
        role: "user",
        content: JSON.stringify(profileData),
      },
    ],
    response_format: { type: "text" },
    model: "gpt-4o-mini",
    temperature: 0,
    max_tokens: 2048,
  });

  await logUpdate(`Summary generated.`, pendingOutbound, { db });
  return completion.choices[0].message.content;
};

const generateSummary = async (
  profileData: any,

  pendingOutbound:
    | InferSelectModel<typeof pendingCompanyOutboundTable>
    | InferSelectModel<typeof pendingOutboundTable>,
  { db }: { db: typeof dbType },
) => {
  await logUpdate(`Generating summary for profile...`, pendingOutbound, { db });
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          "You are to take in this person's LinkedIn profile data, and generate a list of their hard skills amount of experience and specification",
      },
      {
        role: "user",
        content: JSON.stringify(profileData),
      },
    ],
    response_format: { type: "text" },
    model: "gpt-4o-mini",
    temperature: 0,
    max_tokens: 2048,
  });

  await logUpdate(`Summary generated.`, pendingOutbound, { db });
  return completion.choices[0].message.content;
};

const askCondition = async (
  condition: string,

  pendingOutbound:
    | InferSelectModel<typeof pendingCompanyOutboundTable>
    | InferSelectModel<typeof pendingOutboundTable>,
  { db }: { db: typeof dbType },
) => {
  const completion = await openai.chat.completions.create({
    messages: [
      {
        role: "system",
        content:
          'You are to return a valid parseable JSON object with one attribute "condition" which can either be true or false. All questions users ask will always be able to be answered in a yes or no. An example response would be { "condition": true}',
      },
      {
        role: "user",
        content: condition,
      },
    ],
    response_format: { type: "json_object" },
    model: "gpt-4o-mini",
    temperature: 0,
    max_tokens: 256,
  });

  await logUpdate(`Condition response received.`, pendingOutbound, { db });
  return JSON.parse(
    completion.choices[0].message.content ?? '{ "condition": false }',
  ).condition as boolean;
};

const processLinkedInProfile = async (
  linkedinUrl: string,
  index: number,
  searchQuery: string,
  position: string,
  outboundId: string,

  pendingOutbound:
    | InferSelectModel<typeof pendingCompanyOutboundTable>
    | InferSelectModel<typeof pendingOutboundTable>,
  { db }: { db: typeof dbType },
) => {
  await logUpdate(
    `Processing LinkedIn profile #${index}: ${linkedinUrl}`,
    pendingOutbound,
    { db },
  );
  const profileData = await scrapeLinkedInProfile(
    linkedinUrl,
    pendingOutbound,
    { db },
  );

  if (profileData && profileData.success) {
    const personData = profileData.person;
    const summary = await generateSummary(personData, pendingOutbound, { db });
    const miniSummary = await generateMiniSummary(personData, pendingOutbound, {
      db,
    });
    const workedInBigTech = await askCondition(
      `Has this person worked in big tech?  ${JSON.stringify(
        personData.positions.positionHistory.map(
          (experience: any) => experience,
        ),
        null,
        2,
      )} ${personData.summary} ${personData.headline}`,
      pendingOutbound,
      { db },
    );

    const company = searchQuery.split(" ")[0];

    const workedAtRelevant = await askCondition(
      `Has this person worked at ${company}? ${JSON.stringify(
        personData.positions.positionHistory.map(
          (experience: any) => experience,
        ),
        null,
        2,
      )} ${personData.summary} ${personData.headline}`,
      pendingOutbound,
      { db },
    );

    const workedInPosition = await askCondition(
      `Does this person have experience as ${position} or something pretty similar? ${JSON.stringify(
        personData.positions.positionHistory.map(
          (experience: any) => experience,
        ),
        null,
        2,
      )} ${personData.summary} ${personData.headline}`,
      pendingOutbound,
      { db },
    );

    const livesNearBrooklyn = await askCondition(
      `Does this person live within 50 miles of Brookyln New York USA? Their location: ${personData.location ?? "unknown location"} ${personData.positions.positionHistory.length > 0 ? `or ${JSON.stringify(personData.positions.positionHistory[0], null, 2)}` : ""}`,
      pendingOutbound,
      { db },
    );

    const userUuid = uuid();
    // Insert candidate into candidates table
    await db.insert(candidatesTable).values({
      id: userUuid,
      summary,
      miniSummary,
      workedInBigTech,
      livesNearBrooklyn,
      url: linkedinUrl,
      linkedinData: personData,
      createdAt: new Date(),
    });

    const userSummary = {
      id: userUuid,
      summary,
      miniSummary,
      workedInBigTech,
      workedAtRelevant,
      livesNearBrooklyn,
      workedInPosition,
      url: linkedinUrl,
      linkedinData: personData,
    };

    // Insert into outboundCandidates table
    await db.insert(outboundCandidatesTable).values({
      id: uuid(),
      candidateId: userUuid,
      outboundId,
      workedInPosition,
      workedAtRelevant,
      similarity: 0,
      weight: 0,
      matched: false,
    });

    // Update progress in the pendingOutbound table

    await logUpdate(`LinkedIn profile #${index} processed.`, pendingOutbound, {
      db,
    });
    return userSummary;
  }

  await logUpdate(
    `LinkedIn profile #${index} failed to process.`,
    pendingOutbound,
    { db },
  );
  return null;
};

const logUpdate = async (
  message: string,
  pendingOutbound:
    | InferSelectModel<typeof pendingCompanyOutboundTable>
    | InferSelectModel<typeof pendingOutboundTable>,
  { db }: { db: typeof dbType },
) => {
  const pendingOutboundRecord = await db
    .select()
    .from(pendingOutboundTable)
    .where(eq(pendingOutboundTable.outboundId, pendingOutbound.outboundId))
    .then((results) => results[0]);

  const updatedLogs = (pendingOutboundRecord?.logs ?? "") + `\n\n\n${message}`;
  await db
    .update(pendingOutboundTable)
    .set({ logs: updatedLogs })
    .where(eq(pendingOutboundTable.outboundId, pendingOutbound.outboundId));
};

export const outbound = async (
  pendingOutbound: InferSelectModel<typeof pendingOutboundTable>,
  { db }: { db: typeof dbType },
) => {
  const {
    query: searchQuery,
    job: position,
    nearBrooklyn,
    outboundId,
    company,
    booleanSearch,
  } = pendingOutbound;

  await logUpdate(`Starting main function...`, pendingOutbound, { db });

  await db
    .update(pendingOutboundTable)
    .set({
      progress: 2,
      status: `Parsed Queue Message`,
    })
    .where(eq(pendingOutboundTable.outboundId, outboundId));

  const apiKey = process.env.GOOGLE_API_KEY!;
  const cseId = process.env.GOOGLE_CSE_ID!;

  await logUpdate(`Performing Google search...`, pendingOutbound, { db });

  await db
    .update(pendingOutboundTable)
    .set({
      progress: 5,
      status: `Performing Google Search`,
    })
    .where(eq(pendingOutboundTable.outboundId, outboundId));

  const googleResults = await googleSearch(
    booleanSearch,
    apiKey,
    cseId,
    pendingOutbound,
    { db },
  );

  const linkedinUrls = googleResults.map((result) => result.link) as string[];
  const existingCandidates = await db.query.candidates.findMany({
    where: inArray(candidatesTable.url, linkedinUrls),
  });
  const existingLinkedinUrls = existingCandidates.map(
    (candidate) => candidate.url,
  );

  console.log("existingLinkedinUrls", existingLinkedinUrls);
  console.log(
    "existingCandidates",
    existingCandidates.map((c) => c.id),
  );

  await logUpdate(`Google search completed.`, pendingOutbound, { db });

  await logUpdate(`Processing LinkedIn profiles...`, pendingOutbound, { db });

  await db
    .update(pendingOutboundTable)
    .set({
      progress: 35,
      status: `Processing LinkedIn profiles...`,
    })
    .where(eq(pendingOutboundTable.outboundId, outboundId));

  let profiles: any[] = [];
  const nonExistentLinkedinUrls = linkedinUrls.filter(
    (url) => !existingLinkedinUrls.includes(url),
  );

  // Process new profiles
  for (let i = 0; i < nonExistentLinkedinUrls.length; i += 10) {
    const batch = nonExistentLinkedinUrls
      .slice(i, i + 10)
      .map((url, index) =>
        processLinkedInProfile(
          url,
          i + index,
          searchQuery,
          position,
          outboundId,
          pendingOutbound,
          { db },
        ),
      );

    const batchProfiles = await Promise.all(batch);
    profiles = profiles.concat(batchProfiles);

    await logUpdate(`Waiting for 5 seconds...`, pendingOutbound, { db });
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  // Process existing candidates
  for (let i = 0; i < existingCandidates.length; i++) {
    const company = searchQuery.split(" ")[0];
    const workedAtRelevant = await askCondition(
      `Has this person worked at ${company}? ${JSON.stringify(
        existingCandidates[i].linkedinData.positions.positionHistory.map(
          (experience: any) => experience.companyName,
        ),
        null,
        2,
      )}`,
      pendingOutbound,
      { db },
    );

    const workedInPosition = await askCondition(
      `Does this person have experience as ${position} or something pretty similar? ${JSON.stringify(
        existingCandidates[i].linkedinData.positions.positionHistory.map(
          (experience: any) => experience.companyName,
        ),
        null,
        2,
      )} ${existingCandidates[i].linkedinData.summary} ${existingCandidates[i].linkedinData.headline}`,
      pendingOutbound,
      { db },
    );

    await db.insert(outboundCandidatesTable).values({
      id: uuid(),
      candidateId: existingCandidates[i].id,
      outboundId,
      workedInPosition,
      workedAtRelevant,
      similarity: 0,
      weight: 0,
      matched: false,
    });

    profiles.push({
      id: existingCandidates[i].id,
      summary: existingCandidates[i].summary,
      miniSummary: existingCandidates[i].miniSummary,
      workedInBigTech: existingCandidates[i].workedInBigTech,
      workedAtRelevant,
      livesNearBrooklyn: existingCandidates[i].livesNearBrooklyn,
      workedInPosition,
      url: existingCandidates[i].url,
      linkedinData: existingCandidates[i].linkedinData,
    });
  }

  profiles = profiles.filter((profile) => profile !== null);

  await db.update(pendingOutboundTable).set({
    progress: 65,
    status: `Getting job description embedding...`,
  });

  await logUpdate(`LinkedIn profiles processed.`, pendingOutbound, { db });

  await logUpdate(`Getting job description embedding...`, pendingOutbound, {
    db,
  });

  const jobDescriptionEmbedding = await getEmbedding(
    JOB_DESCRIPTION,
    pendingOutbound,
    { db },
  );

  await db.update(pendingOutboundTable).set({
    progress: 85,
    status: `Evaluating and sorting profiles...`,
  });

  await logUpdate(`Evaluating and sorting profiles...`, pendingOutbound, {
    db,
  });

  const finalists = [];
  const matchedEngineers = [];

  console.log("profiles", profiles.length);

  for (const profile of profiles) {
    const profileEmbedding = await getEmbedding(
      profile.summary ?? "",
      pendingOutbound,
      { db },
    );

    const similarity = cosineSimilarity(
      jobDescriptionEmbedding,
      profileEmbedding,
      pendingOutbound,
      { db },
    );

    const weight =
      0.35 * similarity +
      0.15 * Number(profile.workedInPosition) +
      0.35 * Number(profile.workedAtRelevant) +
      0.15 * Number(profile.workedInBigTech) +
      0.35 * Number(profile.livesNearBrooklyn);

    // Update outboundCandidates with similarity and weight
    await db
      .update(outboundCandidatesTable)
      .set({ similarity, weight })
      .where(
        and(
          eq(outboundCandidatesTable.candidateId, profile.id),
          eq(outboundCandidatesTable.outboundId, outboundId),
        ),
      );

    if (profile.workedAtRelevant && profile.workedInPosition) {
      if (nearBrooklyn) {
        if (profile.livesNearBrooklyn) {
          matchedEngineers.push({ ...profile, similarity, weight });
        }
      } else {
        matchedEngineers.push({ ...profile, similarity, weight });
      }
    }

    finalists.push({ ...profile, similarity, weight });
  }

  finalists.sort((a, b) => b.weight - a.weight);

  matchedEngineers.sort((a, b) => b.weight - a.weight);

  await logUpdate(`Finalists evaluated and sorted.`, pendingOutbound, { db });

  // Update status and progress in the pendingOutbound table
  await db
    .update(pendingOutboundTable)
    .set({ progress: 100, status: "COMPLETED" })
    .where(eq(pendingOutboundTable.outboundId, outboundId));

  // Insert row in the outbound table
  await db.insert(outboundTable).values({
    id: pendingOutbound.outboundId,
    userId: pendingOutbound.userId,
    query: searchQuery,
    job: position,
    nearBrooklyn: nearBrooklyn,
    company: company,
    createdAt: new Date(),
  });

  for (const matchedEngineer of matchedEngineers) {
    await db
      .update(outboundCandidatesTable)
      .set({ matched: true })
      .where(
        and(
          eq(outboundCandidatesTable.candidateId, matchedEngineer.id),
          eq(outboundCandidatesTable.outboundId, outboundId),
        ),
      );
  }

  await logUpdate(`Finalists written to outbound table.`, pendingOutbound, {
    db,
  });
};

export const company = async (
  pendingCompanyOutbound: InferSelectModel<typeof pendingCompanyOutboundTable>,
  { db }: { db: typeof dbType },
) => {
  const {
    query: searchQuery,
    job: position,
    nearBrooklyn,
    outboundId,
    companyIds,
    searchInternet,
    skills,
    relevantRoleId,
  } = pendingCompanyOutbound;

  // Initial process log
  console.log(
    `Starting the candidate search process for outboundId: ${outboundId}`,
  );

  await db
    .update(pendingCompanyOutboundTable)
    .set({ progress: 2, status: `Initialized process` })
    .where(eq(pendingCompanyOutboundTable.outboundId, outboundId));

  console.log(`Parsed Queue Message for outboundId: ${outboundId}`);

  let companyCandidates: InferSelectModel<typeof candidates>[] = [];

  for (const companyId of companyIds) {
    const candidatesForCompany = await db.query.candidates.findMany({
      where: and(
        eq(candidatesTable.companyId, companyId),
        eq(candidatesTable.isEngineer, true),
      ),
      limit: 500,
    });

    companyCandidates = companyCandidates.concat(candidatesForCompany);
  }

  console.log(`Parsed company candidates for companyIds: ${companyIds}`);

  await db
    .update(pendingCompanyOutboundTable)
    .set({ progress: 10, status: `Parsed company candidates` })
    .where(eq(pendingCompanyOutboundTable.outboundId, outboundId));

  let profiles: any[] = [];

  const processCandidates = async () => {
    console.log(
      `Processing up to 250 company candidates for outboundId: ${outboundId}`,
    );

    await Promise.all(
      companyCandidates.slice(0, 250).map(async (candidate) => {
        console.log(`Evaluating candidate with id: ${candidate.id}`);

        const relevantSkills = [];
        const notRelevantSkills = [];

        for (const skill of skills) {
          const hasRelevantSkill = await askCondition(
            `Does this person have experience with ${skill}? ${JSON.stringify(
              candidate.linkedinData.positions.positionHistory.map(
                (experience: any) => experience,
              ),
              null,
              2,
            )} ${candidate.summary} ${candidate.linkedinData.headline}`,
            pendingCompanyOutbound,
            { db },
          );

          if (hasRelevantSkill) {
            relevantSkills.push(skill);
            console.log(
              `Candidate ${candidate.id} has relevant skill: ${skill}`,
            );
          } else {
            notRelevantSkills.push(skill);
            console.log(
              `Candidate ${candidate.id} does NOT have relevant skill: ${skill}`,
            );
          }
        }

        const workedInPosition = await askCondition(
          `Does this person have experience as ${position}? ${JSON.stringify(
            candidate.linkedinData.positions.positionHistory.map(
              (experience: any) => experience.companyName,
            ),
            null,
            2,
          )} ${candidate.linkedinData.summary} ${candidate.linkedinData.headline}`,
          pendingCompanyOutbound,
          { db },
        );

        console.log(
          `Candidate ${candidate.id} worked in position ${position}: ${workedInPosition}`,
        );

        await db.insert(outboundCandidatesTable).values({
          id: uuid(),
          candidateId: candidate.id,
          outboundId,
          workedInPosition,
          workedAtRelevant: false,
          relevantSkills,
          notRelevantSkills,
          similarity: 0,
          weight: 0,
          matched: false,
        });

        profiles.push({
          id: candidate.id,
          summary: candidate.summary,
          miniSummary: candidate.miniSummary,
          workedInBigTech: candidate.workedInBigTech,
          workedAtRelevant: false,
          relevantSkills,
          notRelevantSkills,
          livesNearBrooklyn: candidate.livesNearBrooklyn,
          workedInPosition,
          url: candidate.url,
          linkedinData: candidate.linkedinData,
        });

        console.log(
          `Candidate ${candidate.id} processed and added to profiles`,
        );
      }),
    );

    console.log(
      `Completed processing candidates for outboundId: ${outboundId}`,
    );

    return profiles;
  };

  profiles = await processCandidates();
  profiles = profiles.filter((profile) => profile !== null);

  console.log(`Filtered profiles, count: ${profiles.length}`);

  await db
    .update(pendingCompanyOutboundTable)
    .set({ progress: 30, status: `Skills evaluated for all candidates` })
    .where(eq(pendingCompanyOutboundTable.outboundId, outboundId));

  const jobDescriptionEmbedding = await getEmbedding(
    JOB_DESCRIPTION,
    pendingCompanyOutbound,
    { db },
  );

  console.log(`Job description embedding processed`);

  await db
    .update(pendingCompanyOutboundTable)
    .set({ progress: 50, status: `Job description embedding processed` })
    .where(eq(pendingCompanyOutboundTable.outboundId, outboundId));

  const finalists = [];
  const matchedEngineers = [];

  console.log(`Starting similarity and weight calculations for profiles`);

  for (const profile of profiles) {
    const profileEmbedding = await getEmbedding(
      profile.summary ?? "",
      pendingCompanyOutbound,
      { db },
    );

    const similarity = cosineSimilarity(
      jobDescriptionEmbedding,
      profileEmbedding,
      pendingCompanyOutbound,
      { db },
    );

    const weight =
      0.1 * similarity +
      0.15 * Number(profile.workedInPosition) +
      0.3 * Number(profile.relevantSkills.length / skills.length) +
      0.15 * Number(profile.workedInBigTech) +
      0.3 * Number(profile.livesNearBrooklyn);

    await db
      .update(outboundCandidatesTable)
      .set({ similarity, weight })
      .where(
        and(
          eq(outboundCandidatesTable.candidateId, profile.id),
          eq(outboundCandidatesTable.outboundId, outboundId),
        ),
      );

    console.log(
      `Calculated similarity and weight for candidate ${profile.id}: similarity = ${similarity}, weight = ${weight}`,
    );

    if (profile.workedInPosition) {
      if (nearBrooklyn) {
        if (profile.livesNearBrooklyn) {
          matchedEngineers.push({ ...profile, similarity, weight });
          console.log(
            `Candidate ${profile.id} matched and added to matchedEngineers`,
          );
        }
      } else {
        matchedEngineers.push({ ...profile, similarity, weight });
        console.log(
          `Candidate ${profile.id} matched and added to matchedEngineers`,
        );
      }
    }

    finalists.push({ ...profile, similarity, weight });
  }

  await db
    .update(pendingCompanyOutboundTable)
    .set({ progress: 70, status: `Similarity and weight calculated` })
    .where(eq(pendingCompanyOutboundTable.outboundId, outboundId));

  console.log(`Similarity and weight calculations completed`);

  finalists.sort((a, b) => b.weight - a.weight);
  matchedEngineers.sort((a, b) => b.weight - a.weight);

  console.log(`Finalists and matched engineers sorted`);

  await db
    .update(pendingCompanyOutboundTable)
    .set({ progress: 90, status: "Finalists sorted" })
    .where(eq(pendingCompanyOutboundTable.outboundId, outboundId));

  await db
    .update(pendingCompanyOutboundTable)
    .set({ progress: 100, status: "COMPLETED" })
    .where(eq(pendingCompanyOutboundTable.outboundId, outboundId));

  await db.insert(outboundTable).values({
    id: pendingCompanyOutbound.outboundId,
    userId: pendingCompanyOutbound.userId,
    query: searchQuery,
    job: position,
    nearBrooklyn,
    company: "",
    companyIds,
    createdAt: new Date(),
    searchInternet,
    relevantRoleId,
    type: "COMPANY",
  });

  console.log(`Inserted outbound record for outboundId: ${outboundId}`);

  for (const companyId of companyIds) {
    await db.insert(outboundCompanies).values({
      companyId,
      outboundId,
    });

    console.log(`Inserted outboundCompany record for companyId: ${companyId}`);
  }

  for (const matchedEngineer of matchedEngineers) {
    await db
      .update(outboundCandidatesTable)
      .set({ matched: true })
      .where(
        and(
          eq(outboundCandidatesTable.candidateId, matchedEngineer.id),
          eq(outboundCandidatesTable.outboundId, outboundId),
        ),
      );

    console.log(
      `Updated matched status for candidateId: ${matchedEngineer.id}`,
    );
  }

  console.log(
    `Finalists written to outbound table for outboundId: ${outboundId}`,
  );
};
