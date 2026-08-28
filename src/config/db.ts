import mongoose from "mongoose";

import { env } from "./env";

export async function connectDatabase() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME });
}
