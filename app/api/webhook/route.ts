// app/api/webhook/route.ts

import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  try {
    console.log("Received GET request");
    console.log(req.body);

    return NextResponse.json(
      { message: "GET request processed successfully" },
      { status: 200 },
    );
  } catch (error) {
    console.error("Error processing GET request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
