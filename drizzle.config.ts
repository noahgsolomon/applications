import { type Config } from "drizzle-kit";

export default {
  schema: "./server/db/**/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DB_URL!,
  },
} satisfies Config;
