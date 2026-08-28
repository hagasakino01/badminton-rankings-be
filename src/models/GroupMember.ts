import { Schema, model } from "mongoose";

import {
  GROUP_MEMBER_ROLES,
  GROUP_MEMBER_STATUSES,
  MANAGER_PERMISSIONS,
} from "../domain/constants";

const groupMemberSchema = new Schema(
  {
    groupId: { type: Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    playerProfileId: {
      type: Schema.Types.ObjectId,
      ref: "PlayerProfile",
      required: true,
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", sparse: true, index: true },
    role: { type: String, enum: GROUP_MEMBER_ROLES, default: "member", index: true },
    permissions: [{ type: String, enum: MANAGER_PERMISSIONS }],
    status: { type: String, enum: GROUP_MEMBER_STATUSES, default: "active", index: true },
    joinedAt: { type: Date, default: Date.now },
    inactivatedAt: { type: Date },
    removedAt: { type: Date },
  },
  { timestamps: true },
);

groupMemberSchema.index({ groupId: 1, playerProfileId: 1 }, { unique: true });
groupMemberSchema.index(
  { groupId: 1, userId: 1 },
  { unique: true, partialFilterExpression: { userId: { $type: "objectId" } } },
);

export const GroupMemberModel = model("GroupMember", groupMemberSchema);
