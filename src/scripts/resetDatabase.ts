import mongoose from "mongoose";

import { connectDatabase } from "../config/db";
import { env } from "../config/env";

async function resetDatabase() {
  const confirmation = process.argv
    .find((argument) => argument.startsWith("--confirm="))
    ?.slice("--confirm=".length);
  if (confirmation !== env.MONGODB_DB_NAME) {
    throw new Error(
      `Database reset refused. Pass --confirm=${env.MONGODB_DB_NAME} to reset this exact database.`,
    );
  }
  if (env.NODE_ENV === "production" && !process.argv.includes("--allow-production")) {
    throw new Error("Production reset refused without --allow-production");
  }

  await connectDatabase();
  const database = mongoose.connection.db;
  if (!database || database.databaseName !== env.MONGODB_DB_NAME) {
    throw new Error("Connected database does not match MONGODB_DB_NAME");
  }

  await database.dropDatabase();
  console.log(`Reset complete: ${database.databaseName}`);
}

resetDatabase()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
