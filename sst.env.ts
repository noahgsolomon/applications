export const NextEnv = {
  DB_URL: process.env.DB_URL!,
  NEXTAUTH_URL: process.env.WEBSITE!,
  NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET!,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
  HONO_URL: process.env.HONO_URL_PROD!,
  MODE: "PROD",
};

export const HonoEnv = {
  DB_URL: process.env.DB_URL!,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
};
