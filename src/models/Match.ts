import { Schema, model } from "mongoose";

import { COMPETITION_MODES, MATCH_STATUSES } from "../domain/constants";

const matchSchema = new Schema(
  {
    groupId: { type: Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    seasonId: { type: Schema.Types.ObjectId, ref: "Season", required: true, index: true },
    sessionId: { type: Schema.Types.ObjectId, ref: "Session", required: true, index: true },
    mode: { type: String, enum: COMPETITION_MODES, required: true },
    roundNumber: { type: Number, required: true, min: 1 },
    courtNumber: { type: Number, required: true, min: 1, max: 1, default: 1 },
    teamAProfileIds: [{ type: Schema.Types.ObjectId, ref: "PlayerProfile", required: true }],
    teamBProfileIds: [{ type: Schema.Types.ObjectId, ref: "PlayerProfile", required: true }],
    scoreA: { type: Number, min: 0, max: 30 },
    scoreB: { type: Number, min: 0, max: 30 },
    winnerTeam: { type: String, enum: ["A", "B"] },
    status: { type: String, enum: MATCH_STATUSES, default: "scheduled", index: true },
    resultVersion: { type: Number, default: 1, min: 1 },
    resultUpdatedAt: { type: Date },
    resultUpdatedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

matchSchema.index({ sessionId: 1, roundNumber: 1, courtNumber: 1 }, { unique: true });

export const MatchModel = model("Match", matchSchema);
