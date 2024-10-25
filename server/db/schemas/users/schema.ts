import { all } from "axios";
import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  json,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
  vector,
} from "drizzle-orm/pg-core";

export const profileQueue = pgTable("profile_queue", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  type: varchar("type", { length: 255 }).notNull(),
  urls: json("urls").$type<string[]>().notNull(),
  progress: integer("progress").default(0),
  message: text("message"),
  response: json("response").$type<any[]>(),
  skills: json("skills").$type<string[]>().default([]),
  jobTitles: json("job_titles").$type<string[]>().default([]),
  error: boolean("error").default(false),
  success: boolean("success").default(false),
  allIdsResponse: json("all_ids_response").$type<any[]>(),
});

export const company = pgTable(
  "company",
  {
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
    companyNameVector: vector("company_name_vector", { dimensions: 1536 }),
    groups: json("groups").$type<string[]>().default([]),
  },
  (table) => ({
    companyNameVectorIndex: index("company_name_vector_index").using(
      "hnsw",
      table.companyNameVector.op("vector_cosine_ops")
    ),
  })
);

export const whopTwitterAccounts = pgTable("whop_twitter_accounts", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  twitterId: varchar("twitter_id", { length: 255 }).notNull().unique(),
  username: varchar("username", { length: 255 }).notNull().unique(),
  twitterData: jsonb("twitter_data").$type<any>(),
  processed: boolean("processed").default(false),
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
    processed: boolean("processed").default(false),
  },
  (t) => ({
    unq: unique().on(t.whopTwitterAccountId, t.username),
    // unq2: unique().on(t.whopTwitterAccountId, t.twitterId),
  })
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
    processed: boolean("processed").default(false),
  },
  (t) => ({
    unq: unique().on(t.whopTwitterAccountId, t.username),
    // unq2: unique().on(t.whopTwitterAccountId, t.twitterId),
  })
);

export const people = pgTable(
  "people",
  {
    id: varchar("id", { length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),

    // Common fields
    name: varchar("name", { length: 255 }),
    email: varchar("email", { length: 255 }),
    image: varchar("image", { length: 255 }),

    // LinkedIn data (from candidates table)
    linkedinUrl: text("linkedin_url"),
    linkedinData: jsonb("linkedin_data"),

    // GitHub data (from githubUsers table)
    githubLogin: varchar("github_login", { length: 255 }),
    githubImage: varchar("github_image", { length: 255 }),
    githubId: varchar("github_id", { length: 255 }),
    githubData: jsonb("github_data"),
    githubBio: text("github_bio"),
    githubCompany: text("github_company"),
    isGithubCompanyChecked: boolean("is_github_company_checked").default(false),
    isEducationChecked: boolean("is_education_checked").default(false),

    // Twitter data (from whopTwitterAccounts, whopTwitterFollowers, whopTwitterFollowing)
    twitterUsername: varchar("twitter_username", { length: 255 }),
    twitterId: varchar("twitter_id", { length: 255 }),
    twitterData: jsonb("twitter_data"),

    // Additional fields from candidates
    summary: text("summary"),
    miniSummary: text("mini_summary"),
    workedInBigTech: boolean("worked_in_big_tech").default(false),
    livesNearBrooklyn: boolean("lives_near_brooklyn").default(false),
    companyIds: jsonb("company_ids").$type<string[]>().default([]),
    cookdData: jsonb("cookd_data").$type<any>().default({}),
    cookdScore: integer("cookd_score").default(0),
    cookdReviewed: boolean("cookd_reviewed").default(false),
    topTechnologies: jsonb("top_technologies").$type<string[]>().default([]),
    jobTitles: jsonb("job_titles").$type<string[]>().default([]),
    topFeatures: jsonb("top_features").$type<string[]>().default([]),
    isEngineer: boolean("is_engineer").default(false),
    createdAt: timestamp("created_at").defaultNow(),

    // Additional fields from githubUsers
    followers: integer("followers"),
    following: integer("following"),
    followerToFollowingRatio: real("follower_to_following_ratio"),
    contributionYears: jsonb("contribution_years").$type<number[]>(),
    totalCommits: integer("total_commits"),
    restrictedContributions: integer("restricted_contributions"),
    totalRepositories: integer("total_repositories"),
    totalStars: integer("total_stars"),
    totalForks: integer("total_forks"),
    githubLanguages:
      jsonb("github_languages").$type<
        Record<string, { repoCount: number; stars: number }>
      >(),
    uniqueTopics: jsonb("unique_topics").$type<string[]>(),
    externalContributions: integer("external_contributions"),
    totalExternalCommits: integer("total_external_commits"),
    sponsorsCount: integer("sponsors_count"),
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
    isNearNyc: boolean("is_near_nyc"),
    twitterFollowerCount: integer("twitter_follower_count"),
    twitterFollowingCount: integer("twitter_following_count"),
    twitterFollowerToFollowingRatio: real(
      "twitter_follower_to_following_ratio"
    ),
    twitterBio: text("twitter_bio"),
    tweets: jsonb("tweets").$type<any[]>(),
    isUpsertedInAllBios: boolean("is_upserted_in_all_bios").default(false),
    isWhopUser: boolean("is_whop_user"),
    isWhopCreator: boolean("is_whop_creator"),
    // Indicate the source tables (for traceability)
    sourceTables: jsonb("source_tables").$type<string[]>().default([]),
    locationVector: vector("location_vector", { dimensions: 1536 }),
    averageSkillVector: vector("average_skill_vector", { dimensions: 1536 }),
    averageSchoolVector: vector("average_school_vector", { dimensions: 1536 }),
    averageCompanyVector: vector("average_company_vector", {
      dimensions: 1536,
    }),
    averageFieldOfStudyVector: vector("average_field_of_study_vector", {
      dimensions: 1536,
    }),
    averageJobTitleVector: vector("average_job_title_vector", {
      dimensions: 1536,
    }),
    whopTwitterFollowersCount: integer("whop_twitter_followers_count").default(
      0
    ),
    whopTwitterFollowingCount: integer("whop_twitter_following_count").default(
      0
    ),
    whopTwitterMutualsCount: integer("whop_twitter_mutuals_count").default(0),
  },
  (table) => ({
    // Adding unique constraints
    githubIdUnique: unique().on(table.githubId),
    linkedinUrlUnique: unique().on(table.linkedinUrl),
    twitterIdUnique: unique().on(table.twitterId),
    locationVectorIndex: index("location_vector_index").using(
      "hnsw",
      table.locationVector.op("vector_cosine_ops")
    ),
    averageSkillVectorIndex: index("average_skill_vector_idx").using(
      "hnsw",
      table.averageSkillVector.op("vector_cosine_ops")
    ),
    averageJobTitleVectorIndex: index("average_job_title_vector_idx").using(
      "hnsw",
      table.averageJobTitleVector.op("vector_cosine_ops")
    ),
  })
);

export const skillsNew = pgTable(
  "skills_new",
  {
    id: serial("id").primaryKey(),
    personIds: jsonb("person_ids").$type<string[]>().default([]),
    skill: varchar("skill", { length: 255 }).notNull().unique(),
    vector: vector("vector", { dimensions: 1536 }).notNull(),
  },
  (table) => ({
    vectorIndex: index("skills_new_vector_index").using(
      "hnsw",
      table.vector.op("vector_cosine_ops")
    ),
  })
);
export const companiesVectorNew = pgTable(
  "companies_vector_new",
  {
    id: serial("id").primaryKey(),
    personIds: jsonb("person_ids").$type<string[]>().default([]),
    company: varchar("company", { length: 255 }).notNull().unique(),
    vector: vector("vector", { dimensions: 1536 }).notNull(),
  },
  (table) => ({
    vectorIndex: index("companies_vector_new_index").using(
      "hnsw",
      table.vector.op("vector_cosine_ops")
    ),
  })
);

export const schools = pgTable(
  "schools",
  {
    id: serial("id").primaryKey(),
    personIds: jsonb("person_ids").$type<string[]>().default([]),
    school: varchar("school", { length: 255 }).notNull().unique(),
    vector: vector("vector", { dimensions: 1536 }).notNull(),
  },
  (table) => ({
    vectorIndex: index("schools_vector_index").using(
      "hnsw",
      table.vector.op("vector_cosine_ops")
    ),
  })
);

export const fieldsOfStudy = pgTable(
  "fields_of_study",
  {
    id: serial("id").primaryKey(),
    personIds: jsonb("person_ids").$type<string[]>().default([]),
    fieldOfStudy: varchar("field_of_study", { length: 255 }).notNull().unique(),
    vector: vector("vector", { dimensions: 1536 }).notNull(),
  },
  (table) => ({
    vectorIndex: index("fields_of_study_vector_index").using(
      "hnsw",
      table.vector.op("vector_cosine_ops")
    ),
  })
);

export const jobTitlesVectorNew = pgTable(
  "job_titles_vector_new",
  {
    id: serial("id").primaryKey(),
    personIds: jsonb("person_ids").$type<string[]>().default([]),
    jobTitle: varchar("job_title", { length: 255 }).notNull().unique(),
    vector: vector("vector", { dimensions: 1536 }).notNull(),
  },
  (table) => ({
    vectorIndex: index("job_titles_vector_new_index").using(
      "hnsw",
      table.vector.op("vector_cosine_ops")
    ),
  })
);

export const locationsVector = pgTable(
  "locations_vector",
  {
    id: serial("id").primaryKey(),
    personIds: jsonb("person_ids").$type<string[]>().default([]),
    location: text("location").notNull().unique(),
    vector: vector("vector", { dimensions: 1536 }).notNull(),
  },
  (table) => ({
    vectorIndex: index("locations_vector_index").using(
      "hnsw",
      table.vector.op("vector_cosine_ops")
    ),
  })
);
