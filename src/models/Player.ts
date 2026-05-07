import { Schema, model } from "mongoose";

export type PlayerStatus = "active" | "inactive";

export interface PlayerDocument {
  _id: string;
  groupId: string;
  fullName: string;
  nickname?: string;
  contactInfo?: string;
  status: PlayerStatus;
  createdAt: Date;
  updatedAt: Date;
}

const playerSchema = new Schema<PlayerDocument>(
  {
    groupId: { type: String, required: true, index: true },
    fullName: { type: String, required: true, trim: true },
    nickname: { type: String, trim: true },
    contactInfo: { type: String, trim: true },
    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  {
    timestamps: true,
  },
);

export const PlayerModel = model<PlayerDocument>("Player", playerSchema);
