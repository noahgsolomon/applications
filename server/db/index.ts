import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as userSchema from "./schemas/users/schema";

const pool = new Pool({ connectionString: process.env.DB_URL });
export const db = drizzle(pool, {
  schema: {
    ...userSchema,
  },
});
