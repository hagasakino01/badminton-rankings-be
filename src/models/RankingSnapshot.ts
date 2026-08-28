import { Schema, model } from "mongoose";

const rankingRowSchema = new Schema(
  {
    playerProfileId: { type: Schema.Types.ObjectId, ref: "PlayerProfile", required: true },
    displayName: { type: String, required: true, trim: true, maxlength: 80 },
    rank: { type: Number, required: true, min: 1 },
    points: { type: Number, required: true, min: 0 },
    matchesPlayed: { type: Number, required: true, min: 0 },
    wins: { type: Number, required: true, min: 0 },
    losses: { type: Number, required: true, min: 0 },
    winRate: { type: Number, required: true, min: 0, max: 1 },
    scoreDifference: { type: Number, required: true },
    scoreFor: { type: Number, required: true, min: 0 },
    h2hApplied: { type: Boolean, default: false },
  },
  { _id: false },
);

const rankingSnapshotSchema = new Schema(
  {
    groupId: { type: Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    seasonId: { type: Schema.Types.ObjectId, ref: "Season", required: true, index: true },
    sessionId: { type: Schema.Types.ObjectId, ref: "Session", index: true },
    type: { type: String, enum: ["session_lock", "season_final"], required: true, index: true },
    rows: { type: [rankingRowSchema], default: [] },
    sourceVersion: { type: Number, required: true, min: 1 },
    invalidatedAt: { type: Date },
    invalidatedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    createdByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

rankingSnapshotSchema.index({ seasonId: 1, createdAt: 1 });

export const RankingSnapshotModel = model("RankingSnapshot", rankingSnapshotSchema);
