export const NextEnv = {
  DB_URL: process.env.DB_URL!,
  NEXTAUTH_URL: process.env.WEBSITE!,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET!,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
  MODE: "PROD",
};

export const SubscriberEnv = {
  DB_URL: process.env.DB_URL!,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
  SCRAPIN_API_KEY: process.env.SCRAPIN_API_KEY!,
  GOOGLE_CSE_ID: process.env.GOOGLE_CSE_ID!,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY!,
};
