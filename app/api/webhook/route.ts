// pages/api/webhook.js

import { NextApiRequest, NextApiResponse } from "next";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method === "POST") {
    try {
      const webhookData = req.body;

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

      res
        .status(200)
        .json({ message: "Webhook received and processed successfully" });
    } catch (error) {
      console.error("Error processing webhook:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  } else {
    res.setHeader("Allow", ["POST"]);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
