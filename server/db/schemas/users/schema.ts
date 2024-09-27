import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  json,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const users = pgTable("user", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 255 }).notNull(),
  password: text("password").notNull(),
  image: varchar("image", { length: 255 }),
});

export const pendingOutbound = pgTable("pendingOutbound", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  progress: integer("progress").default(0),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id),
  outboundId: varchar("outbound_id", { length: 255 }).notNull(),
  query: text("query").notNull(),
  job: varchar("job", { length: 255 }).notNull(),
  nearBrooklyn: boolean("near_brooklyn").notNull(),
  status: varchar("status", { length: 255 }).notNull(),
  company: varchar("company", { length: 255 }).notNull(),
  booleanSearch: text("boolean_search").notNull(),
  logs: text("logs").notNull(),
});

export const pendingSimilarProfiles = pgTable("pending_similar_profiles", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  type: varchar("type", ["GITHUB", "LINKEDIN"]),
  urls: json("urls").$type<string[]>().notNull(),
  progress: integer("progress").default(0),
  message: text("message"),
  response: json("response").$type<any[]>(),
  error: boolean("error").default(false),
  success: boolean("success").default(false),
});

export const pendingCompanyOutbound = pgTable("pending_company_outbound", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  progress: integer("progress").default(0),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id),
  outboundId: varchar("outbound_id", { length: 255 }).notNull(),
  query: text("query").notNull(),
  job: varchar("job", { length: 255 }).notNull(),
  relevantRoleId: varchar("relevant_role_id", { length: 255 }).references(
    () => relevantRoles.id,
  ),
  skills: json("skills").$type<string[]>().notNull(),
  nearBrooklyn: boolean("near_brooklyn").notNull(),
  searchInternet: boolean("search_internet").notNull(),
  status: varchar("status", { length: 255 }).notNull(),
  companyIds: json("company_ids").$type<string[]>().notNull(),
  booleanSearch: text("boolean_search").notNull(),
  logs: text("logs").notNull(),
});

export const pendingCompanyOutboundRelations = relations(
  pendingCompanyOutbound,
  ({ one }) => ({
    relevantRole: one(relevantRoles, {
      fields: [pendingCompanyOutbound.relevantRoleId],
      references: [relevantRoles.id],
    }),
  }),
);

// id: uuidId,
// job: input.job,
// companyIds: input.companyIds,
// query: input.query,
// progress: 0,
// status: "Starting scrape",
// userId: ctx.user_id,
// outboundId: uuid(),
// nearBrooklyn: input.nearBrooklyn,
// searchInternet: input.searchInternet,
// booleanSearch:
//   input.booleanSearch + (input.nearBrooklyn ? " AND New York" : ""),
// logs: "",

export const typeEnum = pgEnum("type", ["OUTBOUND", "COMPANY"]);

export const outbound = pgTable("outbound", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id),
  query: text("query").notNull(),
  job: varchar("job", { length: 255 }).notNull(),
  nearBrooklyn: boolean("near_brooklyn").notNull(),
  company: varchar("company", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt"),
  type: typeEnum("type").default("OUTBOUND").notNull(),
  relevantRoleId: varchar("relevant_role_id", { length: 255 }).references(
    () => relevantRoles.id,
  ),
  searchInternet: boolean("search_internet").default(true),
  companyIds: json("company_ids").$type<string[]>().default([]),
  recommended: boolean("recommended").default(false),
});

export const candidates = pgTable("candidates", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  summary: text("summary"),
  miniSummary: text("mini_summary"),
  workedInBigTech: boolean("worked_in_big_tech").default(false),
  livesNearBrooklyn: boolean("lives_near_brooklyn").default(false),
  companyId: varchar("company_id", { length: 255 }).references(
    () => company.id,
  ), // not unique until we make the matches (weight similarity and stuff json object)
  companyIds: jsonb("company_ids").$type<string[]>().default([]),
  url: text("url").notNull().unique(),
  linkedinData: json("linkedin_data").$type<any>().default({}),
  cookdData: json("cookd_data").$type<any>().default({}),
  cookdScore: integer("cookd_score").default(0),
  cookdReviewed: boolean("cookd_reviewed").default(false),
  createdAt: timestamp("createdAt"),
  // will be top 5 most present on their profile atm
  topTechnologies: json("top_technologies").$type<string[]>().default([]),
  jobTitles: json("job_titles").$type<string[]>().default([]),
  topFeatures: json("top_features").$type<string[]>().default([]),
  isEngineer: boolean("is_engineer").default(false),
  isSkillAvgInVectorDB: boolean("is_skill_avg_in_vector_db").default(false),
  isJobTitleAvgInVectorDB: boolean("is_job_title_avg_in_vector_db").default(
    false,
  ),
  isFeatureAvgInVectorDB: boolean("is_feature_avg_in_vector_db").default(false),
});

export const candidatesRelations = relations(candidates, ({ one }) => ({
  company: one(company, {
    fields: [candidates.companyId],
    references: [company.id],
  }),
}));

export const outboundCandidates = pgTable(
  "outbound_candidates",
  {
    id: varchar("id", { length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    candidateId: varchar("candidate_id", { length: 255 })
      .notNull()
      .references(() => candidates.id),
    outboundId: varchar("outbound_id", { length: 255 }).notNull(),
    workedInPosition: boolean("worked_in_position").notNull(),
    workedAtRelevant: boolean("worked_at_relevant").notNull(),
    similarity: real("similarity").notNull(),
    weight: real("weight").notNull(),
    matched: boolean("matched").default(false),
    relevantSkills: json("relevant_skills").$type<string[]>().default([]),
    notRelevantSkills: json("not_relevant_skills")
      .$type<string[]>()
      .default([]),
    relevantRoleId: varchar("relevant_role_id", { length: 255 }).references(
      () => relevantRoles.id,
    ),
  },

  (t) => ({
    outboundCandidateIdx: uniqueIndex("outbound_candidate_idx").on(
      t.candidateId,
      t.outboundId,
    ),
  }),
);

export const outboundCompanies = pgTable(
  "outbound_company_candidates",
  {
    id: varchar("id", { length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    outboundId: varchar("outbound_candidate_id", { length: 255 }).notNull(),
    companyId: varchar("company_id", { length: 255 })
      .notNull()
      .references(() => company.id),
  },
  (t) => ({
    outboundCompanyIdx: uniqueIndex("outbound_company_idx").on(
      t.companyId,
      t.outboundId,
    ),
  }),
);

export const relevantRoles = pgTable("relevantRoles", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  jobTitle: varchar("job_title", { length: 255 }).notNull(),
  jobDescription: text("job_description").notNull(),
});

export const outboundCandidatesRelations = relations(
  outboundCandidates,
  ({ one }) => ({
    outbound: one(outbound, {
      fields: [outboundCandidates.outboundId],
      references: [outbound.id],
    }),
    candidate: one(candidates, {
      fields: [outboundCandidates.candidateId],
      references: [candidates.id],
    }),
  }),
);

export const company = pgTable("company", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  linkedinId: varchar("linkedin_id", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  universalName: varchar("universal_name", { length: 255 }),
  linkedinUrl: text("linkedin_url").notNull(),
  employeeCount: integer("employee_count"),
  websiteUrl: text("website_url"),
  tagline: text("tagline"),
  description: text("description"),
  industry: varchar("industry", { length: 255 }),
  phone: varchar("phone", { length: 255 }),
  specialities: json("specialities").$type<string[]>().default([]),
  headquarter: json("headquarter").$type<{
    city: string;
    country: string;
    postalCode: string;
    geographicArea: string;
    street1: string | null;
    street2: string | null;
  }>(),
  logo: text("logo"),
  foundedOn: json("founded_on").$type<{ year: number }>(),
  linkedinData: json("linkedin_data").$type<any>().default({}),
  // will be top 10 based on the employees most present technologies and features weighted by the employees ordering of these.
  topTechnologies: json("top_technologies").$type<string[]>().default([]),
  topFeatures: json("top_features").$type<string[]>().default([]),
  specialties: json("specialties").$type<string[]>().default([]),
});

export const companyRelations = relations(company, ({ many }) => ({
  candidates: many(candidates),
}));

export const jobs = pgTable("jobs", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  jobTitle: varchar("job_title", { length: 255 }).notNull(),
  jobDescription: text("job_description").notNull(),
  whoYouAre: text("who_you_are").notNull(),
  qualifications: text("qualifications").notNull(),
  jobSlug: varchar("job_slug", { length: 255 }).notNull().unique(),
});

export const githubUsers = pgTable("github_users", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: varchar("name", { length: 255 }),
  login: varchar("login", { length: 255 }).notNull().unique(),
  followers: integer("followers").notNull(),
  following: integer("following").notNull(),
  followerToFollowingRatio: real("follower_to_following_ratio"),
  contributionYears: jsonb("contribution_years").$type<number[]>(),
  totalCommits: integer("total_commit_contributions").notNull(),
  restrictedContributions: integer("restricted_contributions").notNull(),
  totalRepositories: integer("total_repositories").notNull(),
  totalStars: integer("total_stars").notNull(),
  totalForks: integer("total_forks").notNull(),
  languages:
    jsonb("languages").$type<
      Record<string, { repoCount: number; stars: number }>
    >(),
  uniqueTopics: jsonb("unique_topics").$type<string[]>(),
  externalContributions: integer("external_contributions").notNull(),
  totalExternalCommits: integer("total_external_commits").notNull(),
  sponsorsCount: integer("sponsors_count").notNull(),
  sponsoredProjects: jsonb("sponsored_projects").$type<string[]>(),
  organizations: jsonb("organizations").$type<
    Array<{
      name: string;
      login: string;
      description: string;
      membersCount: number;
    }>
  >(),
  location: text("location"),
  normalizedLocation: text("normalized_location"),
  websiteUrl: text("website_url"),
  twitterUsername: text("twitter_username"),
  linkedinUrl: text("linkedin_url"),
  email: text("email"),
  bio: text("bio"),
  createdAt: timestamp("created_at").defaultNow(),
  isNearNYC: boolean("is_near_nyc"),
  twitterFollowerCount: integer("twitter_follower_count"),
  twitterFollowingCount: integer("twitter_following_count"),
  twitterFollowerToFollowingRatio: real("twitter_follower_to_following_ratio"),
  twitterBio: text("twitter_bio"),
  tweets: jsonb("tweets").$type<any[]>(),
  isUpsertedInAllBios: boolean("is_upserted_in_all_bios").default(false),
  isWhopUser: boolean("is_whop_user"),
  isWhopCreator: boolean("is_whop_creator"),
});

export const whopTwitterAccounts = pgTable("whop_twitter_accounts", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  twitterId: varchar("twitter_id", { length: 255 }).notNull().unique(),
  username: varchar("username", { length: 255 }).notNull().unique(),
  twitterData: jsonb("twitter_data").$type<any>(),
});

export const whopTwitterFollowers = pgTable(
  "whop_twitter_followers",
  {
    id: varchar("id", { length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    twitterId: varchar("twitter_id", { length: 255 }).notNull(),
    whopTwitterAccountId: varchar("whop_twitter_account_id", { length: 255 })
      .notNull()
      .references(() => whopTwitterAccounts.twitterId),
    username: varchar("username", { length: 255 }).notNull(),
    twitterData: jsonb("twitter_data").$type<any>(),
  },
  (t) => ({
    unq: unique().on(t.whopTwitterAccountId, t.username),
    unq2: unique().on(t.whopTwitterAccountId, t.twitterId),
  }),
);

export const whopTwitterFollowing = pgTable(
  "whop_twitter_following",
  {
    id: varchar("id", { length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    twitterId: varchar("twitter_id", { length: 255 }).notNull(),
    whopTwitterAccountId: varchar("whop_twitter_account_id", { length: 255 })
      .notNull()
      .references(() => whopTwitterAccounts.twitterId),
    username: varchar("username", { length: 255 }).notNull(),
    twitterData: jsonb("twitter_data").$type<any>(),
  },
  (t) => ({
    unq: unique().on(t.whopTwitterAccountId, t.username),
    unq2: unique().on(t.whopTwitterAccountId, t.twitterId),
  }),
);
