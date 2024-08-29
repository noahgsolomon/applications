// app/api/webhook/route.ts

import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import dotenv from "dotenv";
import * as userSchema from "../../../server/db/schemas/users/schema";
import { eq } from "drizzle-orm";

dotenv.config({
  path: "../.env",
});

const connection = neon(process.env.DB_URL!);

const db = drizzle(connection, {
  schema: {
    ...userSchema,
  },
});

export async function POST(req: NextRequest) {
  try {
    console.log("Received POST request");
    const bodyText = await req.text();

    let id: string;
    let cookdData: { score: any; result: string; resumeScreenerId: string };
    let cookdScore: number;

    try {
      const bodyJson = JSON.parse(bodyText);

      id = bodyJson.candidateJson.id;
      cookdData = {
        score: bodyJson.score,
        result: bodyJson.result,
        resumeScreenerId: bodyJson.resumeScreenerId,
      };
      cookdScore = Number(bodyJson.score.numericScore);

      await db
        .update(userSchema.candidates)
        .set({ cookdData, cookdScore, cookdReviewed: true })
        .where(eq(userSchema.candidates.id, id));

      console.log(`Updated Cookd data for ${id}`);
    } catch (parseError) {
      console.log("Body is not valid JSON");
    }

    return NextResponse.json(
      { message: "POST request processed successfully" },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error processing POST request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
