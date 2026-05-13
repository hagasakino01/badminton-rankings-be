import { z } from "zod";

import { MatchModel } from "../models/Match";
import { PlayerModel } from "../models/Player";
import { SeasonModel } from "../models/Season";
import { SessionModel } from "../models/Session";
import { calculateSeasonRankings } from "../services/ranking.service";
import {
  generateFairSchedule,
  validateManualSchedule,
} from "../services/schedule.service";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/appError";
import { assertGroupManager } from "../utils/permissions";

const manualMatchSchema = z.object({
  teamAIds: z.array(z.string()).length(2),
  teamBIds: z.array(z.string()).length(2),
});

const generateSessionSchema = z
  .object({
    title: z.string().trim().max(120).optional(),
    note: z.string().trim().max(500).optional(),
    scheduledFor: z.coerce.date(),
    participantIds: z.array(z.string()).min(5, "A session requires at least 5 participants"),
    scheduleType: z.enum(["auto", "manual"]).default("auto"),
    manualMatches: z.array(manualMatchSchema).optional(),
  })
  .superRefine((payload, ctx) => {
    if (payload.scheduleType !== "manual") {
      return;
    }

    if (payload.participantIds.length > 12) {
      ctx.addIssue({
        code: "custom",
        path: ["participantIds"],
        message: "Manual schedules support at most 12 participants",
      });
    }

    if (!payload.manualMatches?.length) {
      ctx.addIssue({
        code: "custom",
        path: ["manualMatches"],
        message: "Manual schedules require at least one match",
      });
    }
  });

const updateResultsSchema = z.object({
  results: z.array(
    z.object({
      matchId: z.string(),
      scoreA: z.number().int().min(0),
      scoreB: z.number().int().min(0),
    }),
  ),
});

function areSessionResultsSaved(
  session: { isResultsSaved?: boolean | null },
  matches: Array<{ status: string; scoreA?: number; scoreB?: number }>,
) {
  if (session.isResultsSaved) {
    return true;
  }

  return (
    matches.length > 0 &&
    matches.every(
      (match) =>
        match.status === "completed" &&
        typeof match.scoreA === "number" &&
        typeof match.scoreB === "number",
    )
  );
}

function normalizeOptionalText(value?: string) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export const generateSession = asyncHandler(async (req, res) => {
  const payload = generateSessionSchema.parse(req.body);
  const season = await SeasonModel.findById(req.params.seasonId);

  if (!season) {
    throw new AppError(404, "Season not found");
  }

  await assertGroupManager(season.groupId.toString(), req.user);

  if (season.isLocked || season.status === "completed") {
    throw new AppError(400, "Season is locked");
  }

  const activePlayers = await PlayerModel.find({ groupId: season.groupId, status: "active" }).lean();
  const activePlayerIds = new Set(activePlayers.map((player) => player._id.toString()));
  const uniqueParticipantIds = Array.from(new Set(payload.participantIds));

  if (uniqueParticipantIds.length !== payload.participantIds.length) {
    throw new AppError(400, "Participants must be unique");
  }

  if (uniqueParticipantIds.some((id) => !activePlayerIds.has(id))) {
    throw new AppError(400, "Participants must belong to the group");
  }

  const absentPlayerIds = activePlayers
    .map((player) => player._id.toString())
    .filter((playerId) => !uniqueParticipantIds.includes(playerId));
  const normalizedSeasonId = season._id.toString();
  const schedule =
    payload.scheduleType === "manual"
      ? {
          matches: payload.manualMatches ?? [],
          playerLoad: Object.fromEntries(uniqueParticipantIds.map((participantId) => [participantId, 4])),
        }
      : generateFairSchedule(uniqueParticipantIds);

  if (payload.scheduleType === "manual") {
    const manualScheduleError = validateManualSchedule(uniqueParticipantIds, schedule.matches);
    if (manualScheduleError) {
      throw new AppError(400, manualScheduleError);
    }
  }

  const session = await SessionModel.create({
    groupId: season.groupId,
    seasonId: normalizedSeasonId,
    title: normalizeOptionalText(payload.title),
    note: normalizeOptionalText(payload.note),
    scheduledFor: payload.scheduledFor,
    participantIds: uniqueParticipantIds,
    absentPlayerIds,
    scheduleType: payload.scheduleType,
    createdBy: req.user?.userId,
  });

  const matches = await MatchModel.insertMany(
    schedule.matches.map((match, index) => ({
      groupId: season.groupId,
      seasonId: normalizedSeasonId,
      sessionId: session._id.toString(),
      courtOrder: index + 1,
      teamAIds: match.teamAIds,
      teamBIds: match.teamBIds,
      status: "scheduled",
    })),
  );

  if (season.status === "draft") {
    season.status = "active";
    season.startDate = season.startDate ?? payload.scheduledFor;
    await season.save();
  }

  res.status(201).json({
    session,
    matches,
    playerLoad: schedule.playerLoad,
  });
});

export const getSession = asyncHandler(async (req, res) => {
  const session = await SessionModel.findById(req.params.sessionId).lean();

  if (!session) {
    throw new AppError(404, "Session not found");
  }

  await assertGroupManager(session.groupId.toString(), req.user);

  const matches = await MatchModel.find({ sessionId: session._id.toString() })
    .sort({ courtOrder: 1 })
    .lean();

  res.json({
    session: {
      ...session,
      scheduleType: session.scheduleType ?? "auto",
      isResultsSaved: areSessionResultsSaved(session, matches),
    },
    matches,
  });
});

export const updateResults = asyncHandler(async (req, res) => {
  const payload = updateResultsSchema.parse(req.body);
  const session = await SessionModel.findById(req.params.sessionId);

  if (!session) {
    throw new AppError(404, "Session not found");
  }

  await assertGroupManager(session.groupId.toString(), req.user);

  const season = await SeasonModel.findById(session.seasonId);
  if (!season || season.isLocked) {
    throw new AppError(400, "Season is locked");
  }

  const allSessionMatches = await MatchModel.find({ sessionId: session._id.toString() });

  if (areSessionResultsSaved(session, allSessionMatches)) {
    throw new AppError(400, "Results for this session have already been saved");
  }

  if (!allSessionMatches.length) {
    throw new AppError(400, "This session has no matches");
  }

  if (payload.results.length !== allSessionMatches.length) {
    throw new AppError(400, "You must submit results for all matches in the session");
  }

  const matchIds = payload.results.map((result) => result.matchId);
  if (new Set(matchIds).size !== matchIds.length) {
    throw new AppError(400, "Duplicate match results are not allowed");
  }

  const matches = await MatchModel.find({
    _id: { $in: matchIds },
    sessionId: session._id.toString(),
  });

  if (matches.length !== payload.results.length) {
    throw new AppError(400, "One or more matches were not found in this session");
  }

  for (const result of payload.results) {
    if (result.scoreA === result.scoreB) {
      throw new AppError(400, "Draws are not supported by the current rules");
    }

    const match = matches.find((item) => item._id.toString() === result.matchId);
    if (!match) continue;

    match.scoreA = result.scoreA;
    match.scoreB = result.scoreB;
    match.winnerTeam = result.scoreA > result.scoreB ? "A" : "B";
    match.status = "completed";
    await match.save();
  }

  session.isResultsSaved = true;
  await session.save();

  const updatedMatches = await MatchModel.find({ sessionId: session._id.toString() })
    .sort({ courtOrder: 1 })
    .lean();
  const rankings = await calculateSeasonRankings(session.seasonId.toString(), session.groupId.toString());

  res.json({
    session,
    matches: updatedMatches,
    rankings,
  });
});

export const deleteSession = asyncHandler(async (req, res) => {
  const session = await SessionModel.findById(req.params.sessionId);

  if (!session) {
    throw new AppError(404, "Session not found");
  }

  await assertGroupManager(session.groupId.toString(), req.user);

  const season = await SeasonModel.findById(session.seasonId);
  if (!season || season.isLocked || season.status === "completed") {
    throw new AppError(400, "Season is locked");
  }

  const matches = await MatchModel.find({ sessionId: session._id.toString() }).lean();
  if (areSessionResultsSaved(session, matches)) {
    throw new AppError(400, "Saved sessions cannot be deleted");
  }

  await MatchModel.deleteMany({ sessionId: session._id.toString() });
  await SessionModel.deleteOne({ _id: session._id });

  const remainingSessions = await SessionModel.countDocuments({ seasonId: session.seasonId });
  if (remainingSessions === 0 && season.status === "active") {
    season.status = "draft";
    season.startDate = undefined;
    await season.save();
  }

  res.json({
    message: "Session deleted successfully",
  });
});
