import { Schema, model } from "mongoose";

import {
  DEFAULT_COURT_NUMBER,
  DEFAULT_MATCHES_PER_PLAYER,
  SCHEDULE_TYPES,
  SESSION_STATUSES,
} from "../domain/constants";

const sessionSchema = new Schema(
  {
    groupId: { type: Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    seasonId: { type: Schema.Types.ObjectId, ref: "Season", required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    note: { type: String, trim: true, maxlength: 500 },
    venue: { type: String, trim: true, maxlength: 160 },
    scheduledFor: { type: Date, required: true },
    status: { type: String, enum: SESSION_STATUSES, default: "draft", index: true },
    participantProfileIds: [{ type: Schema.Types.ObjectId, ref: "PlayerProfile" }],
    absentProfileIds: [{ type: Schema.Types.ObjectId, ref: "PlayerProfile" }],
    scheduleType: { type: String, enum: SCHEDULE_TYPES },
    scheduleSeed: { type: String, trim: true, maxlength: 120 },
    courtCount: { type: Number, default: DEFAULT_COURT_NUMBER, min: 1, max: 1 },
    matchesPerPlayer: { type: Number, default: DEFAULT_MATCHES_PER_PLAYER, min: 4, max: 4 },
    resultVersion: { type: Number, default: 1, min: 1 },
    lockedAt: { type: Date },
    lockedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    lastUnlockedAt: { type: Date },
    lastUnlockedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    createdByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

export const SessionModel = model("Session", sessionSchema);
