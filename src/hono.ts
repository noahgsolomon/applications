import { Hono } from "hono";
import { handle } from "hono/aws-lambda";
import { outbound } from "./helper";
import * as userSchema from "../server/db/schemas/users/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";

const connection = neon(process.env.DB_URL!);

export const db = drizzle(connection, {
  schema: {
    userSchema,
  },
});

const app = new Hono();

app.get("/", async (c) => {
  return c.json({
    message: "hello world 99",
  });
});

app.post("/outbound", async (c) => {
  const { pendingOutboundId } = await c.req.json<{
    pendingOutboundId: string;
  }>();

  const pendingOutbound = await db
    .select()
    .from(userSchema.pendingOutbound)
    .where(eq(userSchema.pendingOutbound.id, pendingOutboundId));

  await outbound(pendingOutbound[0], { db });

  return c.json({
    message: "Wrote outbound candidates to db sup",
  });
});

export const handler = handle(app);
