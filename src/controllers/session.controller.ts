import { z } from "zod";

import { MatchModel } from "../models/Match";
import { MutationReceiptModel } from "../models/MutationReceipt";
import { PlayerProfileModel } from "../models/PlayerProfile";
import { RankingSnapshotModel } from "../models/RankingSnapshot";
import { SeasonModel } from "../models/Season";
import { SeasonParticipantModel } from "../models/SeasonParticipant";
import { SessionModel } from "../models/Session";
import {
  requireActiveGroupMember,
  requireGroupHost,
  requireGroupPermission,
} from "../services/access.service";
import { writeAuditLog } from "../services/audit.service";
import { calculateSeasonRankings } from "../services/ranking.service";
import { generateFairSchedule, validateManualSchedule } from "../services/schedule.service";
import { validateBadmintonScore } from "../services/score.service";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/appError";
import { routeParam } from "../utils/routeParam";

const participantIdsSchema = z.array(z.string()).min(5).max(20);

const createSessionSchema = z.object({
  title: z.string().trim().min(2).max(120),
  note: z.string().trim().max(500).optional(),
  venue: z.string().trim().max(160).optional(),
  scheduledFor: z.coerce.date(),
  participantProfileIds: participantIdsSchema.optional(),
});

const updateSessionSchema = z
  .object({
    title: z.string().trim().min(2).max(120).optional(),
    note: z.string().trim().max(500).optional(),
    venue: z.string().trim().max(160).optional(),
    scheduledFor: z.coerce.date().optional(),
    participantProfileIds: participantIdsSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "At least one session field is required");

const manualMatchSchema = z.object({
  teamAProfileIds: z.array(z.string()).min(1).max(2),
  teamBProfileIds: z.array(z.string()).min(1).max(2),
});

const scheduleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auto"), seed: z.string().trim().min(1).max(120).optional() }),
  z.object({ type: z.literal("manual"), matches: z.array(manualMatchSchema).min(1) }),
]);

const resultSchema = z.object({
  scoreA: z.number().int().min(0).max(30),
  scoreB: z.number().int().min(0).max(30),
  expectedVersion: z.number().int().min(1),
  idempotencyKey: z.string().trim().min(8).max(160).optional(),
});

const unlockSchema = z.object({
  reason: z.string().trim().min(3).max(300),
});

async function getSessionOrThrow(sessionId: string) {
  const session = await SessionModel.findById(sessionId);
  if (!session) {
    throw new AppError(404, "Session not found", "SESSION_NOT_FOUND");
  }
  return session;
}

async function validateSessionParticipants(seasonId: string, requestedIds?: string[]) {
  const roster = await SeasonParticipantModel.find({ seasonId }).sort({ seedOrder: 1 }).lean();
  const rosterIds = roster.map((participant) => participant.playerProfileId.toString());
  const selectedIds = requestedIds ?? rosterIds;
  const uniqueIds = [...new Set(selectedIds)];

  if (uniqueIds.length !== selectedIds.length) {
    throw new AppError(
      400,
      "Session participants cannot contain duplicates",
      "SESSION_DUPLICATE_PARTICIPANT",
    );
  }
  if (uniqueIds.length < 5 || uniqueIds.length > 20) {
    throw new AppError(
      400,
      "A session requires between 5 and 20 participants",
      "SESSION_PARTICIPANT_COUNT_INVALID",
    );
  }
  const rosterSet = new Set(rosterIds);
  const outsideRoster = uniqueIds.filter((profileId) => !rosterSet.has(profileId));
  if (outsideRoster.length) {
    throw new AppError(
      400,
      "Every session participant must belong to the locked season roster",
      "SESSION_PARTICIPANT_OUTSIDE_ROSTER",
      { playerProfileIds: outsideRoster },
    );
  }

  return {
    participantProfileIds: uniqueIds,
    absentProfileIds: rosterIds.filter((profileId) => !uniqueIds.includes(profileId)),
  };
}

async function refreshSessionResultState(sessionId: string) {
  const matches = await MatchModel.find({ sessionId }).select("status").lean();
  const completedCount = matches.filter((match) => match.status === "completed").length;
  const pendingCount = matches.filter((match) => match.status === "scheduled").length;
  const status = completedCount > 0 && pendingCount === 0 ? "completed" : "in_progress";
  const session = await SessionModel.findByIdAndUpdate(
    sessionId,
    { status, $inc: { resultVersion: 1 } },
    { returnDocument: "after" },
  );
  return { session, completedCount, pendingCount, matchCount: matches.length };
}

export const listSessions = asyncHandler(async (req, res) => {
  const season = await SeasonModel.findById(routeParam(req, "seasonId")).lean();
  if (!season) {
    throw new AppError(404, "Season not found", "SEASON_NOT_FOUND");
  }
  await requireActiveGroupMember(season.groupId.toString(), req.user!.userId);
  const sessions = await SessionModel.find({ seasonId: season._id })
    .sort({ scheduledFor: -1 })
    .lean();
  const items = await Promise.all(
    sessions.map(async (session) => {
      const [matchCount, completedMatchCount] = await Promise.all([
        MatchModel.countDocuments({ sessionId: session._id }),
        MatchModel.countDocuments({ sessionId: session._id, status: "completed" }),
      ]);
      return { ...session, matchCount, completedMatchCount };
    }),
  );

  res.json({ sessions: items });
});

export const createSession = asyncHandler(async (req, res) => {
  const payload = createSessionSchema.parse(req.body);
  const season = await SeasonModel.findById(routeParam(req, "seasonId"));
  if (!season) {
    throw new AppError(404, "Season not found", "SEASON_NOT_FOUND");
  }
  const { group, member: actor } = await requireGroupPermission(
    season.groupId.toString(),
    req.user!.userId,
    "manage_matches",
  );
  if (season.status !== "active" || !season.rosterLocked) {
    throw new AppError(
      409,
      "Sessions can only be created in an active season",
      "ACTIVE_SEASON_REQUIRED",
    );
  }

  const attendance = await validateSessionParticipants(
    season._id.toString(),
    payload.participantProfileIds,
  );
  const session = await SessionModel.create({
    groupId: group._id,
    seasonId: season._id,
    title: payload.title,
    note: payload.note,
    venue: payload.venue ?? group.defaultVenue,
    scheduledFor: payload.scheduledFor,
    status: "draft",
    ...attendance,
    createdByUserId: req.user!.userId,
  });
  await writeAuditLog({
    groupId: group._id,
    seasonId: season._id,
    sessionId: session._id,
    actorUserId: req.user!.userId,
    actorRole: actor.role,
    action: "session.created",
    targetType: "session",
    targetId: session._id,
    metadata: {
      scheduledFor: session.scheduledFor,
      participantCount: attendance.participantProfileIds.length,
    },
  });

  res.status(201).json({ session });
});

export const getSession = asyncHandler(async (req, res) => {
  const session = await getSessionOrThrow(routeParam(req, "sessionId"));
  const { member } = await requireActiveGroupMember(
    session.groupId.toString(),
    req.user!.userId,
  );
  const [matches, profiles] = await Promise.all([
    MatchModel.find({ sessionId: session._id }).sort({ roundNumber: 1, courtNumber: 1 }).lean(),
    PlayerProfileModel.find({
      _id: { $in: [...session.participantProfileIds, ...session.absentProfileIds] },
    })
      .select("fullName nickname avatarUrl")
      .lean(),
  ]);

  res.json({
    session,
    matches,
    playerProfiles: profiles,
    currentMembership: {
      id: member._id,
      role: member.role,
      permissions: member.permissions,
      status: member.status,
    },
    scoringRules: { gameTo: 21, winBy: 2, cap: 30 },
  });
});

export const updateSession = asyncHandler(async (req, res) => {
  const payload = updateSessionSchema.parse(req.body);
  const session = await getSessionOrThrow(routeParam(req, "sessionId"));
  const { member: actor } = await requireGroupPermission(
    session.groupId.toString(),
    req.user!.userId,
    "manage_matches",
  );
  if (!(["draft", "scheduled"] as const).includes(session.status as "draft" | "scheduled")) {
    throw new AppError(409, "This session can no longer be edited", "SESSION_NOT_EDITABLE");
  }
  if (payload.participantProfileIds && session.status !== "draft") {
    throw new AppError(
      409,
      "Attendance can only change before the schedule is generated",
      "SESSION_ATTENDANCE_LOCKED",
    );
  }

  const before = session.toObject();
  if (payload.participantProfileIds) {
    const attendance = await validateSessionParticipants(
      session.seasonId.toString(),
      payload.participantProfileIds,
    );
    session.participantProfileIds = attendance.participantProfileIds as never;
    session.absentProfileIds = attendance.absentProfileIds as never;
  }
  if (payload.title) session.title = payload.title;
  if (payload.note !== undefined) session.note = payload.note;
  if (payload.venue !== undefined) session.venue = payload.venue;
  if (payload.scheduledFor) session.scheduledFor = payload.scheduledFor;
  await session.save();
  await writeAuditLog({
    groupId: session.groupId,
    seasonId: session.seasonId,
    sessionId: session._id,
    actorUserId: req.user!.userId,
    actorRole: actor.role,
    action: "session.updated",
    targetType: "session",
    targetId: session._id,
    metadata: { before, after: payload },
  });

  res.json({ session });
});

export const scheduleSession = asyncHandler(async (req, res) => {
  const payload = scheduleSchema.parse(req.body);
  const session = await getSessionOrThrow(routeParam(req, "sessionId"));
  const { member: actor } = await requireGroupPermission(
    session.groupId.toString(),
    req.user!.userId,
    "manage_matches",
  );
  const season = await SeasonModel.findById(session.seasonId).lean();
  if (!season || season.status !== "active") {
    throw new AppError(409, "The season is not active", "ACTIVE_SEASON_REQUIRED");
  }
  if (!(["draft", "scheduled"] as const).includes(session.status as "draft" | "scheduled")) {
    throw new AppError(409, "A started session cannot be rescheduled", "SESSION_ALREADY_STARTED");
  }

  const participantIds = session.participantProfileIds.map((id) => id.toString());
  let plans: Array<{
    teamAProfileIds: string[];
    teamBProfileIds: string[];
    roundNumber: number;
    courtNumber: 1;
  }>;
  let scheduleSeed: string | undefined;
  let fairness: unknown = null;

  if (payload.type === "auto") {
    scheduleSeed = payload.seed ?? `${session._id}:${session.resultVersion}`;
    try {
      const generated = generateFairSchedule(season.mode, participantIds, scheduleSeed);
      plans = generated.matches;
      fairness = generated.fairness;
    } catch (error) {
      throw new AppError(
        400,
        error instanceof Error ? error.message : "Unable to generate schedule",
        "SCHEDULE_GENERATION_FAILED",
      );
    }
  } else {
    const validationError = validateManualSchedule(season.mode, participantIds, payload.matches);
    if (validationError) {
      throw new AppError(400, validationError, "MANUAL_SCHEDULE_INVALID");
    }
    plans = payload.matches.map((match, index) => ({
      ...match,
      roundNumber: index + 1,
      courtNumber: 1,
    }));
  }

  await MatchModel.deleteMany({ sessionId: session._id });
  const matches = await MatchModel.insertMany(
    plans.map((plan) => ({
      groupId: session.groupId,
      seasonId: session.seasonId,
      sessionId: session._id,
      mode: season.mode,
      ...plan,
      status: "scheduled",
    })),
  );
  session.status = "scheduled";
  session.scheduleType = payload.type;
  session.scheduleSeed = scheduleSeed;
  session.resultVersion += 1;
  await session.save();
  await writeAuditLog({
    groupId: session.groupId,
    seasonId: session.seasonId,
    sessionId: session._id,
    actorUserId: req.user!.userId,
    actorRole: actor.role,
    action: "session.scheduled",
    targetType: "session",
    targetId: session._id,
    metadata: { type: payload.type, seed: scheduleSeed, matchCount: matches.length, fairness },
  });

  res.json({ session, matches, fairness });
});

export const updateMatchResult = asyncHandler(async (req, res) => {
  const payload = resultSchema.parse(req.body);
  const session = await getSessionOrThrow(routeParam(req, "sessionId"));
  const matchId = routeParam(req, "matchId");
  const { member: actor } = await requireGroupPermission(
    session.groupId.toString(),
    req.user!.userId,
    "enter_results",
  );
  if (session.status === "locked") {
    throw new AppError(423, "This session is locked", "SESSION_LOCKED");
  }
  if (!(["scheduled", "in_progress", "completed"] as const).includes(
    session.status as "scheduled" | "in_progress" | "completed",
  )) {
    throw new AppError(409, "Generate the schedule before entering results", "SESSION_NOT_SCHEDULED");
  }
  const season = await SeasonModel.findById(session.seasonId).select("status").lean();
  if (!season || season.status !== "active") {
    throw new AppError(409, "Results can only change in an active season", "SEASON_RESULTS_IMMUTABLE");
  }

  const idempotencyKey =
    payload.idempotencyKey ??
    (typeof req.headers["idempotency-key"] === "string"
      ? req.headers["idempotency-key"].trim()
      : undefined);
  if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 160) {
    throw new AppError(
      400,
      "An Idempotency-Key is required for result updates",
      "IDEMPOTENCY_KEY_REQUIRED",
    );
  }

  const existingReceipt = await MutationReceiptModel.findOne({
    key: idempotencyKey,
    actorUserId: req.user!.userId,
  }).lean();
  if (existingReceipt) {
    if (
      existingReceipt.resourceType !== "match_result" ||
      existingReceipt.resourceId.toString() !== matchId
    ) {
      throw new AppError(409, "This idempotency key was used for another request", "IDEMPOTENCY_KEY_REUSED");
    }
    const match = await MatchModel.findById(matchId).lean();
    res.json({ match, idempotentReplay: true });
    return;
  }

  let score: ReturnType<typeof validateBadmintonScore>;
  try {
    score = validateBadmintonScore(payload.scoreA, payload.scoreB);
  } catch (error) {
    throw new AppError(
      400,
      error instanceof Error ? error.message : "Invalid badminton score",
      "MATCH_SCORE_INVALID",
    );
  }

  const before = await MatchModel.findOne({
    _id: matchId,
    sessionId: session._id,
  }).lean();
  if (!before) {
    throw new AppError(404, "Match not found", "MATCH_NOT_FOUND");
  }
  if (before.status === "cancelled") {
    throw new AppError(409, "A cancelled match cannot receive a result", "MATCH_CANCELLED");
  }

  const match = await MatchModel.findOneAndUpdate(
    {
      _id: before._id,
      sessionId: session._id,
      resultVersion: payload.expectedVersion,
      status: { $ne: "cancelled" },
    },
    {
      scoreA: score.scoreA,
      scoreB: score.scoreB,
      winnerTeam: score.winnerTeam,
      status: "completed",
      resultUpdatedAt: new Date(),
      resultUpdatedByUserId: req.user!.userId,
      $inc: { resultVersion: 1 },
    },
    { returnDocument: "after" },
  );
  if (!match) {
    const serverMatch = await MatchModel.findById(before._id).lean();
    throw new AppError(
      409,
      "This result changed on another device. Review both versions before saving again.",
      "RESULT_VERSION_CONFLICT",
      {
        expectedVersion: payload.expectedVersion,
        serverVersion: serverMatch?.resultVersion,
        serverResult: serverMatch
          ? {
              scoreA: serverMatch.scoreA,
              scoreB: serverMatch.scoreB,
              winnerTeam: serverMatch.winnerTeam,
              updatedAt: serverMatch.resultUpdatedAt,
            }
          : null,
        clientResult: { scoreA: payload.scoreA, scoreB: payload.scoreB },
      },
    );
  }

  try {
    await MutationReceiptModel.create({
      key: idempotencyKey,
      actorUserId: req.user!.userId,
      resourceType: "match_result",
      resourceId: match._id,
      version: match.resultVersion,
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
    });
  } catch (error) {
    const receipt = await MutationReceiptModel.findOne({
      key: idempotencyKey,
      actorUserId: req.user!.userId,
      resourceId: match._id,
    }).lean();
    if (!receipt) throw error;
  }

  const state = await refreshSessionResultState(session._id.toString());
  await writeAuditLog({
    groupId: session.groupId,
    seasonId: session.seasonId,
    sessionId: session._id,
    matchId: match._id,
    actorUserId: req.user!.userId,
    actorRole: actor.role,
    action: before.status === "completed" ? "match.result_edited" : "match.result_entered",
    targetType: "match",
    targetId: match._id,
    metadata: {
      before: {
        scoreA: before.scoreA,
        scoreB: before.scoreB,
        winnerTeam: before.winnerTeam,
        resultVersion: before.resultVersion,
      },
      after: {
        scoreA: match.scoreA,
        scoreB: match.scoreB,
        winnerTeam: match.winnerTeam,
        resultVersion: match.resultVersion,
      },
      idempotencyKey,
    },
  });

  res.json({
    match,
    session: state.session,
    progress: {
      completedMatches: state.completedCount,
      pendingMatches: state.pendingCount,
      totalMatches: state.matchCount,
    },
  });
});

export const lockSession = asyncHandler(async (req, res) => {
  const session = await getSessionOrThrow(routeParam(req, "sessionId"));
  const { member: actor } = await requireGroupPermission(
    session.groupId.toString(),
    req.user!.userId,
    "lock_sessions",
  );
  if (session.status !== "completed") {
    throw new AppError(
      409,
      "All match results must be completed before locking",
      "SESSION_NOT_COMPLETE",
    );
  }
  const pendingMatches = await MatchModel.countDocuments({
    sessionId: session._id,
    status: { $ne: "completed" },
  });
  if (pendingMatches > 0) {
    throw new AppError(409, "Every match requires a result", "SESSION_MATCHES_INCOMPLETE");
  }

  const nextVersion = session.resultVersion + 1;
  session.status = "locked";
  session.lockedAt = new Date();
  session.lockedByUserId = actor.userId;
  session.resultVersion = nextVersion;
  await session.save();

  try {
    const ranking = await calculateSeasonRankings(session.seasonId.toString(), "official");
    const snapshot = await RankingSnapshotModel.create({
      groupId: session.groupId,
      seasonId: session.seasonId,
      sessionId: session._id,
      type: "session_lock",
      rows: ranking.rows.map((row) => ({ ...row, h2hApplied: row.headToHead.applied })),
      sourceVersion: nextVersion,
      createdByUserId: req.user!.userId,
    });
    await writeAuditLog({
      groupId: session.groupId,
      seasonId: session.seasonId,
      sessionId: session._id,
      actorUserId: req.user!.userId,
      actorRole: actor.role,
      action: "session.locked",
      targetType: "session",
      targetId: session._id,
      metadata: { snapshotId: snapshot._id, resultVersion: nextVersion },
    });

    res.json({ session, ranking: { ...ranking, snapshotId: snapshot._id } });
  } catch (error) {
    session.status = "completed";
    session.lockedAt = undefined;
    session.lockedByUserId = undefined;
    session.resultVersion += 1;
    await session.save();
    throw error;
  }
});

export const unlockSession = asyncHandler(async (req, res) => {
  const payload = unlockSchema.parse(req.body);
  const session = await getSessionOrThrow(routeParam(req, "sessionId"));
  const { member: actor } = await requireGroupHost(
    session.groupId.toString(),
    req.user!.userId,
  );
  const season = await SeasonModel.findById(session.seasonId).select("status").lean();
  if (!season || season.status !== "active") {
    throw new AppError(
      409,
      "Sessions in a completed season cannot be unlocked",
      "COMPLETED_SEASON_IMMUTABLE",
    );
  }
  if (session.status !== "locked") {
    throw new AppError(409, "Only locked sessions can be unlocked", "SESSION_NOT_LOCKED");
  }

  const previousVersion = session.resultVersion;
  session.status = "completed";
  session.lastUnlockedAt = new Date();
  session.lastUnlockedByUserId = actor.userId;
  session.lockedAt = undefined;
  session.lockedByUserId = undefined;
  session.resultVersion += 1;
  await session.save();
  await RankingSnapshotModel.updateMany(
    {
      sessionId: session._id,
      type: "session_lock",
      invalidatedAt: { $exists: false },
    },
    { invalidatedAt: new Date(), invalidatedByUserId: req.user!.userId },
  );
  await writeAuditLog({
    groupId: session.groupId,
    seasonId: session.seasonId,
    sessionId: session._id,
    actorUserId: req.user!.userId,
    actorRole: actor.role,
    action: "session.unlocked",
    targetType: "session",
    targetId: session._id,
    reason: payload.reason,
    metadata: { previousVersion, resultVersion: session.resultVersion },
  });

  res.json({ session });
});

export const deleteSession = asyncHandler(async (req, res) => {
  const session = await getSessionOrThrow(routeParam(req, "sessionId"));
  const { member: actor } = await requireGroupPermission(
    session.groupId.toString(),
    req.user!.userId,
    "manage_matches",
  );
  if (!(["draft", "scheduled"] as const).includes(session.status as "draft" | "scheduled")) {
    throw new AppError(
      409,
      "A session with results cannot be deleted",
      "SESSION_DELETE_NOT_ALLOWED",
    );
  }
  if (await MatchModel.exists({ sessionId: session._id, status: "completed" })) {
    throw new AppError(409, "A session with results cannot be deleted", "SESSION_HAS_RESULTS");
  }

  await MatchModel.deleteMany({ sessionId: session._id });
  await SessionModel.deleteOne({ _id: session._id });
  await writeAuditLog({
    groupId: session.groupId,
    seasonId: session.seasonId,
    sessionId: session._id,
    actorUserId: req.user!.userId,
    actorRole: actor.role,
    action: "session.deleted",
    targetType: "session",
    targetId: session._id,
    metadata: { title: session.title },
  });

  res.status(204).send();
});

export const generateSession = createSession;
