import { Schema, model } from "mongoose";

import { GROUP_MAX_ACTIVE_MEMBERS, GROUP_STATUSES } from "../domain/constants";

const groupSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, trim: true, maxlength: 500 },
    region: { type: String, trim: true, maxlength: 120 },
    defaultVenue: { type: String, trim: true, maxlength: 160 },
    hostUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    status: { type: String, enum: GROUP_STATUSES, default: "draft", index: true },
    maxActiveMembers: { type: Number, default: GROUP_MAX_ACTIVE_MEMBERS, immutable: true },
    archivedAt: { type: Date },
    archivedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const GroupModel = model("Group", groupSchema);
