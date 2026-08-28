import { Schema, model } from "mongoose";

import { INVITATION_STATUSES } from "../domain/constants";

const invitationSchema = new Schema(
  {
    groupId: { type: Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    groupMemberId: { type: Schema.Types.ObjectId, ref: "GroupMember", required: true, index: true },
    playerProfileId: {
      type: Schema.Types.ObjectId,
      ref: "PlayerProfile",
      required: true,
      index: true,
    },
    email: { type: String, trim: true, lowercase: true, maxlength: 160 },
    tokenHash: { type: String, required: true, unique: true, index: true },
    tokenHint: { type: String, required: true, trim: true, maxlength: 16 },
    status: { type: String, enum: INVITATION_STATUSES, default: "pending", index: true },
    expiresAt: { type: Date, required: true, index: true },
    invitedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    acceptedAt: { type: Date },
    acceptedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
    revokedAt: { type: Date },
    revokedByUserId: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const InvitationModel = model("Invitation", invitationSchema);
