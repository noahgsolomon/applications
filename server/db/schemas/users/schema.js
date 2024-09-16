"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.githubUsers =
  exports.companyRelations =
  exports.company =
  exports.outboundCandidatesRelations =
  exports.relevantRoles =
  exports.outboundCompanies =
  exports.outboundCandidates =
  exports.candidatesRelations =
  exports.candidates =
  exports.outbound =
  exports.typeEnum =
  exports.pendingCompanyOutboundRelations =
  exports.pendingCompanyOutbound =
  exports.pendingOutbound =
  exports.users =
    void 0;
var drizzle_orm_1 = require("drizzle-orm");
var pg_core_1 = require("drizzle-orm/pg-core");
exports.users = (0, pg_core_1.pgTable)("user", {
  id: (0, pg_core_1.varchar)("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(function () {
      return crypto.randomUUID();
    }),
  name: (0, pg_core_1.varchar)("name", { length: 255 }),
  email: (0, pg_core_1.varchar)("email", { length: 255 }).notNull(),
  password: (0, pg_core_1.text)("password").notNull(),
  image: (0, pg_core_1.varchar)("image", { length: 255 }),
});
exports.pendingOutbound = (0, pg_core_1.pgTable)("pendingOutbound", {
  id: (0, pg_core_1.varchar)("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(function () {
      return crypto.randomUUID();
    }),
  progress: (0, pg_core_1.integer)("progress").default(0),
  userId: (0, pg_core_1.varchar)("user_id", { length: 255 })
    .notNull()
    .references(function () {
      return exports.users.id;
    }),
  outboundId: (0, pg_core_1.varchar)("outbound_id", { length: 255 }).notNull(),
  query: (0, pg_core_1.text)("query").notNull(),
  job: (0, pg_core_1.varchar)("job", { length: 255 }).notNull(),
  nearBrooklyn: (0, pg_core_1.boolean)("near_brooklyn").notNull(),
  status: (0, pg_core_1.varchar)("status", { length: 255 }).notNull(),
  company: (0, pg_core_1.varchar)("company", { length: 255 }).notNull(),
  booleanSearch: (0, pg_core_1.text)("boolean_search").notNull(),
  logs: (0, pg_core_1.text)("logs").notNull(),
});
exports.pendingCompanyOutbound = (0, pg_core_1.pgTable)(
  "pending_company_outbound",
  {
    id: (0, pg_core_1.varchar)("id", { length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(function () {
        return crypto.randomUUID();
      }),
    progress: (0, pg_core_1.integer)("progress").default(0),
    userId: (0, pg_core_1.varchar)("user_id", { length: 255 })
      .notNull()
      .references(function () {
        return exports.users.id;
      }),
    outboundId: (0, pg_core_1.varchar)("outbound_id", {
      length: 255,
    }).notNull(),
    query: (0, pg_core_1.text)("query").notNull(),
    job: (0, pg_core_1.varchar)("job", { length: 255 }).notNull(),
    relevantRoleId: (0, pg_core_1.varchar)("relevant_role_id", {
      length: 255,
    }).references(function () {
      return exports.relevantRoles.id;
    }),
    skills: (0, pg_core_1.json)("skills").$type().notNull(),
    nearBrooklyn: (0, pg_core_1.boolean)("near_brooklyn").notNull(),
    searchInternet: (0, pg_core_1.boolean)("search_internet").notNull(),
    status: (0, pg_core_1.varchar)("status", { length: 255 }).notNull(),
    companyIds: (0, pg_core_1.json)("company_ids").$type().notNull(),
    booleanSearch: (0, pg_core_1.text)("boolean_search").notNull(),
    logs: (0, pg_core_1.text)("logs").notNull(),
  },
);
exports.pendingCompanyOutboundRelations = (0, drizzle_orm_1.relations)(
  exports.pendingCompanyOutbound,
  function (_a) {
    var one = _a.one;
    return {
      relevantRole: one(exports.relevantRoles, {
        fields: [exports.pendingCompanyOutbound.relevantRoleId],
        references: [exports.relevantRoles.id],
      }),
    };
  },
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
exports.typeEnum = (0, pg_core_1.pgEnum)("type", ["OUTBOUND", "COMPANY"]);
exports.outbound = (0, pg_core_1.pgTable)("outbound", {
  id: (0, pg_core_1.varchar)("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(function () {
      return crypto.randomUUID();
    }),
  userId: (0, pg_core_1.varchar)("user_id", { length: 255 })
    .notNull()
    .references(function () {
      return exports.users.id;
    }),
  query: (0, pg_core_1.text)("query").notNull(),
  job: (0, pg_core_1.varchar)("job", { length: 255 }).notNull(),
  nearBrooklyn: (0, pg_core_1.boolean)("near_brooklyn").notNull(),
  company: (0, pg_core_1.varchar)("company", { length: 255 }).notNull(),
  createdAt: (0, pg_core_1.timestamp)("createdAt"),
  type: (0, exports.typeEnum)("type").default("OUTBOUND").notNull(),
  relevantRoleId: (0, pg_core_1.varchar)("relevant_role_id", {
    length: 255,
  }).references(function () {
    return exports.relevantRoles.id;
  }),
  searchInternet: (0, pg_core_1.boolean)("search_internet").default(true),
  companyIds: (0, pg_core_1.json)("company_ids").$type().default([]),
  recommended: (0, pg_core_1.boolean)("recommended").default(false),
});
exports.candidates = (0, pg_core_1.pgTable)("candidates", {
  id: (0, pg_core_1.varchar)("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(function () {
      return crypto.randomUUID();
    }),
  summary: (0, pg_core_1.text)("summary"),
  miniSummary: (0, pg_core_1.text)("mini_summary"),
  workedInBigTech: (0, pg_core_1.boolean)("worked_in_big_tech").default(false),
  livesNearBrooklyn: (0, pg_core_1.boolean)("lives_near_brooklyn").default(
    false,
  ),
  companyId: (0, pg_core_1.varchar)("company_id", { length: 255 }).references(
    function () {
      return exports.company.id;
    },
  ), // not unique until we make the matches (weight similarity and stuff json object)
  companyIds: (0, pg_core_1.jsonb)("company_ids").$type().default([]),
  url: (0, pg_core_1.text)("url").notNull().unique(),
  linkedinData: (0, pg_core_1.json)("linkedin_data").$type().default({}),
  cookdData: (0, pg_core_1.json)("cookd_data").$type().default({}),
  cookdScore: (0, pg_core_1.integer)("cookd_score").default(0),
  cookdReviewed: (0, pg_core_1.boolean)("cookd_reviewed").default(false),
  createdAt: (0, pg_core_1.timestamp)("createdAt"),
  // will be top 5 most present on their profile atm
  topTechnologies: (0, pg_core_1.json)("top_technologies").$type().default([]),
  jobTitles: (0, pg_core_1.json)("job_titles").$type().default([]),
  topFeatures: (0, pg_core_1.json)("top_features").$type().default([]),
  isEngineer: (0, pg_core_1.boolean)("is_engineer").default(false),
  isSkillAvgInVectorDB: (0, pg_core_1.boolean)(
    "is_skill_avg_in_vector_db",
  ).default(false),
  isJobTitleAvgInVectorDB: (0, pg_core_1.boolean)(
    "is_job_title_avg_in_vector_db",
  ).default(false),
  isFeatureAvgInVectorDB: (0, pg_core_1.boolean)(
    "is_feature_avg_in_vector_db",
  ).default(false),
});
exports.candidatesRelations = (0, drizzle_orm_1.relations)(
  exports.candidates,
  function (_a) {
    var one = _a.one;
    return {
      company: one(exports.company, {
        fields: [exports.candidates.companyId],
        references: [exports.company.id],
      }),
    };
  },
);
exports.outboundCandidates = (0, pg_core_1.pgTable)(
  "outbound_candidates",
  {
    id: (0, pg_core_1.varchar)("id", { length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(function () {
        return crypto.randomUUID();
      }),
    candidateId: (0, pg_core_1.varchar)("candidate_id", { length: 255 })
      .notNull()
      .references(function () {
        return exports.candidates.id;
      }),
    outboundId: (0, pg_core_1.varchar)("outbound_id", {
      length: 255,
    }).notNull(),
    workedInPosition: (0, pg_core_1.boolean)("worked_in_position").notNull(),
    workedAtRelevant: (0, pg_core_1.boolean)("worked_at_relevant").notNull(),
    similarity: (0, pg_core_1.real)("similarity").notNull(),
    weight: (0, pg_core_1.real)("weight").notNull(),
    matched: (0, pg_core_1.boolean)("matched").default(false),
    relevantSkills: (0, pg_core_1.json)("relevant_skills").$type().default([]),
    notRelevantSkills: (0, pg_core_1.json)("not_relevant_skills")
      .$type()
      .default([]),
    relevantRoleId: (0, pg_core_1.varchar)("relevant_role_id", {
      length: 255,
    }).references(function () {
      return exports.relevantRoles.id;
    }),
  },
  function (t) {
    return {
      outboundCandidateIdx: (0, pg_core_1.uniqueIndex)(
        "outbound_candidate_idx",
      ).on(t.candidateId, t.outboundId),
    };
  },
);
exports.outboundCompanies = (0, pg_core_1.pgTable)(
  "outbound_company_candidates",
  {
    id: (0, pg_core_1.varchar)("id", { length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(function () {
        return crypto.randomUUID();
      }),
    outboundId: (0, pg_core_1.varchar)("outbound_candidate_id", {
      length: 255,
    }).notNull(),
    companyId: (0, pg_core_1.varchar)("company_id", { length: 255 })
      .notNull()
      .references(function () {
        return exports.company.id;
      }),
  },
  function (t) {
    return {
      outboundCompanyIdx: (0, pg_core_1.uniqueIndex)("outbound_company_idx").on(
        t.companyId,
        t.outboundId,
      ),
    };
  },
);
exports.relevantRoles = (0, pg_core_1.pgTable)("relevantRoles", {
  id: (0, pg_core_1.varchar)("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(function () {
      return crypto.randomUUID();
    }),
  jobTitle: (0, pg_core_1.varchar)("job_title", { length: 255 }).notNull(),
  jobDescription: (0, pg_core_1.text)("job_description").notNull(),
});
exports.outboundCandidatesRelations = (0, drizzle_orm_1.relations)(
  exports.outboundCandidates,
  function (_a) {
    var one = _a.one;
    return {
      outbound: one(exports.outbound, {
        fields: [exports.outboundCandidates.outboundId],
        references: [exports.outbound.id],
      }),
      candidate: one(exports.candidates, {
        fields: [exports.outboundCandidates.candidateId],
        references: [exports.candidates.id],
      }),
    };
  },
);
exports.company = (0, pg_core_1.pgTable)("company", {
  id: (0, pg_core_1.varchar)("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(function () {
      return crypto.randomUUID();
    }),
  linkedinId: (0, pg_core_1.varchar)("linkedin_id", { length: 255 })
    .notNull()
    .unique(),
  name: (0, pg_core_1.varchar)("name", { length: 255 }).notNull(),
  universalName: (0, pg_core_1.varchar)("universal_name", { length: 255 }),
  linkedinUrl: (0, pg_core_1.text)("linkedin_url").notNull(),
  employeeCount: (0, pg_core_1.integer)("employee_count"),
  websiteUrl: (0, pg_core_1.text)("website_url"),
  tagline: (0, pg_core_1.text)("tagline"),
  description: (0, pg_core_1.text)("description"),
  industry: (0, pg_core_1.varchar)("industry", { length: 255 }),
  phone: (0, pg_core_1.varchar)("phone", { length: 255 }),
  specialities: (0, pg_core_1.json)("specialities").$type().default([]),
  headquarter: (0, pg_core_1.json)("headquarter").$type(),
  logo: (0, pg_core_1.text)("logo"),
  foundedOn: (0, pg_core_1.json)("founded_on").$type(),
  linkedinData: (0, pg_core_1.json)("linkedin_data").$type().default({}),
  // will be top 10 based on the employees most present technologies and features weighted by the employees ordering of these.
  topTechnologies: (0, pg_core_1.json)("top_technologies").$type().default([]),
  topFeatures: (0, pg_core_1.json)("top_features").$type().default([]),
  specialties: (0, pg_core_1.json)("specialties").$type().default([]),
});
exports.companyRelations = (0, drizzle_orm_1.relations)(
  exports.company,
  function (_a) {
    var many = _a.many;
    return {
      candidates: many(exports.candidates),
    };
  },
);
exports.githubUsers = (0, pg_core_1.pgTable)("github_users", {
  id: (0, pg_core_1.varchar)("id", { length: 255 }).primaryKey(),
  name: (0, pg_core_1.varchar)("name", { length: 255 }),
  login: (0, pg_core_1.varchar)("login", { length: 255 }).notNull().unique(),
  followers: (0, pg_core_1.integer)("followers").notNull(),
  following: (0, pg_core_1.integer)("following").notNull(),
  followerToFollowingRatio: (0, pg_core_1.real)("follower_to_following_ratio"),
  contributionYears: (0, pg_core_1.jsonb)("contribution_years").$type(),
  totalCommits: (0, pg_core_1.integer)("total_commit_contributions").notNull(),
  restrictedContributions: (0, pg_core_1.integer)(
    "restricted_contributions",
  ).notNull(),
  totalRepositories: (0, pg_core_1.integer)("total_repositories").notNull(),
  totalStars: (0, pg_core_1.integer)("total_stars").notNull(),
  totalForks: (0, pg_core_1.integer)("total_forks").notNull(),
  languages: (0, pg_core_1.jsonb)("languages").$type(),
  uniqueTopics: (0, pg_core_1.jsonb)("unique_topics").$type(),
  externalContributions: (0, pg_core_1.integer)(
    "external_contributions",
  ).notNull(),
  totalExternalCommits: (0, pg_core_1.integer)(
    "total_external_commits",
  ).notNull(),
  sponsorsCount: (0, pg_core_1.integer)("sponsors_count").notNull(),
  sponsoredProjects: (0, pg_core_1.jsonb)("sponsored_projects").$type(),
  organizations: (0, pg_core_1.jsonb)("organizations").$type(),
  location: (0, pg_core_1.text)("location"),
  websiteUrl: (0, pg_core_1.text)("website_url"),
  twitterUsername: (0, pg_core_1.text)("twitter_username"),
  email: (0, pg_core_1.text)("email"),
  bio: (0, pg_core_1.text)("bio"),
  createdAt: (0, pg_core_1.timestamp)("created_at").defaultNow(),
  isNearNYC: (0, pg_core_1.boolean)("is_near_nyc"),
});
