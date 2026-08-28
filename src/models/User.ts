import { Schema, model } from "mongoose";

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      unique: true,
      index: true,
    },
    passwordHash: { type: String, required: true },
    status: { type: String, enum: ["active", "disabled"], default: "active", index: true },
    timezone: { type: String, default: "Asia/Ho_Chi_Minh", trim: true },
    lastLoginAt: { type: Date },
  },
  { timestamps: true },
);

export const UserModel = model("User", userSchema);
