import { Schema, model } from "mongoose";

const auditLogSchema = new Schema(
  {
    groupId: { type: Schema.Types.ObjectId, ref: "Group", required: true, index: true },
    seasonId: { type: Schema.Types.ObjectId, ref: "Season", index: true },
    sessionId: { type: Schema.Types.ObjectId, ref: "Session", index: true },
    matchId: { type: Schema.Types.ObjectId, ref: "Match", index: true },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    actorRole: { type: String, enum: ["host", "manager", "member"], required: true },
    action: { type: String, required: true, trim: true, maxlength: 80, index: true },
    targetType: { type: String, required: true, trim: true, maxlength: 40 },
    targetId: { type: Schema.Types.ObjectId, required: true },
    reason: { type: String, trim: true, maxlength: 500 },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

auditLogSchema.index({ groupId: 1, createdAt: -1 });
auditLogSchema.index({ sessionId: 1, createdAt: -1 });

export const AuditLogModel = model("AuditLog", auditLogSchema);
