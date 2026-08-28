import dotenv from "dotenv";
import { z } from "zod";

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
  CLIENT_ORIGIN: z.string().min(1).default("http://localhost:3000"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  INVITATION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(48),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(10).max(120).default(30),
});

export const env = envSchema.parse(process.env);
