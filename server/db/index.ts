import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as userSchema from "./schemas/users/schema";

const connection = neon(process.env.DB_URL!);

export const db = drizzle(connection, {
  schema: {
    ...userSchema,
  },
});
