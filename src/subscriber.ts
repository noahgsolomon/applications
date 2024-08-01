import { outbound } from "./helper";
import * as userSchema from "../server/db/schemas/users/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";

const connection = neon(process.env.DB_URL!);

const db = drizzle(connection, {
  schema: {
    userSchema,
  },
});

export async function handler(event: any) {
  console.log(event);
  const message = JSON.parse(event.Records[0].body);

  const { pendingOutboundId } = message;

  console.log(`received request with id: ${pendingOutboundId}`);

  const pendingOutbound = await db
    .select()
    .from(userSchema.pendingOutbound)
    .where(eq(userSchema.pendingOutbound.id, pendingOutboundId));

  console.log(pendingOutbound);

  // await outbound(pendingOutbound[0], { db });
}
