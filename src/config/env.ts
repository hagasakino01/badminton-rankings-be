import dotenv from "dotenv";
import { z } from "zod";

import { resolveClientUrls } from "./clientUrls";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DB_NAME: z
    .string()
    .regex(/^diamond-ranking(?:-[a-z0-9]+)*$/, "MONGODB_DB_NAME must be a Diamond Ranking database")
    .default("diamond-ranking-v3"),
  JWT_SECRET: z.string().min(12, "JWT_SECRET must be at least 12 characters"),
  CLIENT_ORIGIN: z.string().min(1).optional(),
  APP_URL: z.string().url().optional(),
  INVITATION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(48),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(10).max(120).default(30),
});

const parsedEnv = envSchema.parse(process.env);
const clientUrls = resolveClientUrls({
  nodeEnv: parsedEnv.NODE_ENV,
  clientOrigin: parsedEnv.CLIENT_ORIGIN,
  appUrl: parsedEnv.APP_URL,
});

export const env = {
  ...parsedEnv,
  CLIENT_ORIGIN: clientUrls.clientOrigin,
  APP_URL: clientUrls.appUrl,
};
