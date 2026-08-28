import { Schema, model } from "mongoose";

import { COMPETITION_MODES, SEASON_STATUSES } from "../domain/constants";

const seasonSchema = new Schema(
  {
    groupId: { type: Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    mode: { type: String, enum: COMPETITION_MODES, required: true },
    status: { type: String, enum: SEASON_STATUSES, default: "upcoming", index: true },
    startsOn: { type: Date },
    endsOn: { type: Date },
    rosterLocked: { type: Boolean, default: false },
    activatedAt: { type: Date },
    activatedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    completedAt: { type: Date },
    completedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    finalSnapshotId: { type: Schema.Types.ObjectId, ref: "RankingSnapshot" },
    version: { type: Number, default: 1, min: 1 },
    createdByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

seasonSchema.index(
  { groupId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "active" } },
);

export const SeasonModel = model("Season", seasonSchema);
