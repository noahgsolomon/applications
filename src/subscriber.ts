import { outbound, company } from "./helper";
import * as userSchema from "../server/db/schemas/users/schema";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";

const connection = neon(process.env.DB_URL!);

const db = drizzle(connection, {
  schema: {
    ...userSchema,
  },
});

export async function handler(event: any) {
  console.log(event);
  const message = JSON.parse(event.Records[0].body);
  if (message.type === "OUTBOUND") {
    console.log("received OUTBOUND");
    const { pendingOutboundId } = message;

    console.log(`received request with id: ${pendingOutboundId}`);

    const pendingOutbound = await db
      .select()
      .from(userSchema.pendingOutbound)
      .where(eq(userSchema.pendingOutbound.id, pendingOutboundId));

    if (pendingOutbound[0].progress !== 0) {
      return;
    }

    console.log(pendingOutbound);

    await outbound(pendingOutbound[0], { db });
  } else if (message.type === "COMPANY") {
    console.log("received COMPANY");
    const { pendingCompanyOutboundId } = message;

    console.log(`received request with id: ${pendingCompanyOutboundId}`);

    const pendingCompanyOutbound = await db
      .select()
      .from(userSchema.pendingCompanyOutbound)
      .where(
        eq(userSchema.pendingCompanyOutbound.id, pendingCompanyOutboundId),
      );

    let found = false;
    for (const outbound of pendingCompanyOutbound) {
      if (outbound.progress === 0 && !found) {
        found = true;
        console.log(pendingCompanyOutbound);
        await company(pendingCompanyOutbound[0], { db });
      }
    }
  } else {
    console.log(`invalid type field given: ${message}`);
  }
}
