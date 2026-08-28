import { Schema, model } from "mongoose";

const seasonParticipantSchema = new Schema(
  {
    groupId: { type: Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    seasonId: { type: Schema.Types.ObjectId, ref: "Season", required: true, index: true },
    groupMemberId: { type: Schema.Types.ObjectId, ref: "GroupMember", required: true },
    playerProfileId: {
      type: Schema.Types.ObjectId,
      ref: "PlayerProfile",
      required: true,
      index: true,
    },
    displayNameSnapshot: { type: String, required: true, trim: true, maxlength: 80 },
    nicknameSnapshot: { type: String, trim: true, maxlength: 40 },
    seedOrder: { type: Number, required: true, min: 1 },
  },
  { timestamps: true },
);

seasonParticipantSchema.index({ seasonId: 1, playerProfileId: 1 }, { unique: true });

export const SeasonParticipantModel = model("SeasonParticipant", seasonParticipantSchema);
