// app/api/webhook/route.ts

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    console.log("Received POST request");
    const bodyText = await req.text();
    console.log("Request body:", bodyText);

    try {
      const bodyJson = JSON.parse(bodyText);
      console.log("Parsed JSON body:", bodyJson);
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
