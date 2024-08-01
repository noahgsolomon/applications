import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  json,
  pgTable,
  real,
  text,
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

export const outbound = pgTable("outbound", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  user_id: varchar("user_id", { length: 255 })
    .notNull()
    .references(() => users.id),
  query: text("query").notNull(),
  job: varchar("job", { length: 255 }).notNull(),
  near_brooklyn: boolean("near_brooklyn").notNull(),
  matched: json("matched").$type<number[]>().default([]),
  company: varchar("company", { length: 255 }).notNull(),
});

export const candidates = pgTable("candidates", {
  id: varchar("id", { length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  summary: text("summary"),
  workedInBigTech: boolean("worked_in_big_tech").default(false),
  workedAtRelevant: boolean("worked_at_relevant").default(false),
  livesNearBrooklyn: boolean("lives_near_brooklyn").default(false),
  workedInPosition: boolean("worked_in_position").default(false),
  url: text("url").unique(),
  similarity: real("similarity"),
  weight: real("weight"),
  linkedinData: json("linkedin_data").$type<any>().default({}),
  outboundId: varchar("outbound_id", { length: 255 }).notNull(),
});

export const outboundRelations = relations(outbound, ({ many }) => ({
  candidates: many(candidates),
}));

export const candidatesRelations = relations(candidates, ({ one }) => ({
  outbound: one(outbound, {
    fields: [candidates.outboundId],
    references: [outbound.id],
  }),
}));
