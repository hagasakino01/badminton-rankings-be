import { Schema, model } from "mongoose";

const playerProfileSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", unique: true, sparse: true, index: true },
    fullName: { type: String, required: true, trim: true, maxlength: 80 },
    nickname: { type: String, trim: true, maxlength: 40 },
    phone: { type: String, trim: true, maxlength: 30 },
    email: { type: String, trim: true, lowercase: true, maxlength: 160 },
    avatarUrl: { type: String, trim: true, maxlength: 500 },
    status: { type: String, enum: ["active", "merged"], default: "active", index: true },
    mergedIntoProfileId: { type: Schema.Types.ObjectId, ref: "PlayerProfile" },
    createdByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

export const PlayerProfileModel = model("PlayerProfile", playerProfileSchema);
