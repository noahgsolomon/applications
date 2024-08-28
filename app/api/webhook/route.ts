// app/api/webhook/route.ts

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    console.log("Received POST request");
    console.log(req.body);

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
