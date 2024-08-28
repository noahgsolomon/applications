// app/api/webhook/route.ts

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const webhookData = await req.json();

    console.log("Received webhook data:", webhookData);

    const { score, result, resumeScreenerId, candidateJson } = webhookData;

    console.log(`Candidate score: ${score.numericScore}`);
    console.log(`Result: ${result}`);

    if (
      score.experienceMatch === "strong yes" &&
      score.locationMatch === "strong yes"
    ) {
      console.log("This candidate is a strong match!");
    }

    return NextResponse.json(
      { message: "Webhook received and processed successfully" },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error processing webhook:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
