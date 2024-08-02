export const NextEnv = {
  DB_URL: process.env.DB_URL!,
  // switch to process.env.WEBSITE! when running sst deploy
  NEXTAUTH_URL: process.env.NEXTAUTH_URL!,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET!,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
  // switch to DEV when running sst deploy
  MODE: "DEV",
};

export const SubscriberEnv = {
  DB_URL: process.env.DB_URL!,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
  SCRAPIN_API_KEY: process.env.SCRAPIN_API_KEY!,
  GOOGLE_CSE_ID: process.env.GOOGLE_CSE_ID!,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY!,
};
