import type { ClientSession, Types } from "mongoose";

import { AuditLogModel } from "../models/AuditLog";

type AuditInput = {
  groupId: string | Types.ObjectId;
  seasonId?: string | Types.ObjectId;
  sessionId?: string | Types.ObjectId;
  matchId?: string | Types.ObjectId;
  actorUserId: string | Types.ObjectId;
  actorRole: "host" | "manager" | "member";
  action: string;
  targetType: string;
  targetId: string | Types.ObjectId;
  reason?: string;
  metadata?: Record<string, unknown>;
};

export async function writeAuditLog(input: AuditInput, session?: ClientSession) {
  if (!session) return AuditLogModel.create(input);
  const [log] = await AuditLogModel.create([input], { session });
  return log;
}
