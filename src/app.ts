import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";

import { env } from "./config/env";
import { errorHandler, notFoundHandler } from "./middlewares/errorMiddleware";
import { apiRouter } from "./routes";

export function createApp() {
  const app = express();
  const allowedOrigins = env.CLIENT_ORIGIN.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const allowAllOrigins = allowedOrigins.includes("*");

  app.use(
    cors({
      origin(origin, callback) {
        if (allowAllOrigins) {
          callback(null, true);
          return;
        }

        // Allow server-to-server calls and configured browser origins.
        if (!origin || allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      credentials: true,
    }),
  );
  app.use(cookieParser());
  app.use(express.json());

  app.use("/api", apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
