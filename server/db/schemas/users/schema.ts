import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  integer,
  json,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
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
  url: text("url").notNull().unique(),
  linkedinData: json("linkedin_data").$type<any>().default({}),
  createdAt: timestamp("createdAt"),
  // will be top 5 most present on their profile atm
  topTechnologies: json("top_technologies").$type<string[]>().default([]),
  topFeatures: json("top_features").$type<string[]>().default([]),
  isEngineer: boolean("is_engineer").default(false),
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
});

export const companyRelations = relations(company, ({ many }) => ({
  candidates: many(candidates),
}));
