import { z } from "zod";

import { MatchModel } from "../models/Match";
import { PlayerModel } from "../models/Player";
import { SeasonModel } from "../models/Season";
import { SessionModel } from "../models/Session";
import { calculateSeasonRankings } from "../services/ranking.service";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/appError";
import { assertGroupManager } from "../utils/permissions";

const createSeasonSchema = z.object({
  name: z.string().min(2).max(80),
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

export const createSeason = asyncHandler(async (req, res) => {
  const payload = createSeasonSchema.parse(req.body);
  const groupId = String(req.params.groupId);
  const group = await assertGroupManager(groupId, req.user);
  const normalizedGroupId = group._id.toString();
  const activePlayers = await PlayerModel.countDocuments({
    groupId: normalizedGroupId,
    status: "active",
  });

  if (activePlayers < 8 || activePlayers > 20) {
    throw new AppError(400, "A group needs between 8 and 20 active players before creating a season");
  }

  const openSeason = await SeasonModel.findOne({
    groupId: normalizedGroupId,
    status: { $in: ["draft", "active"] },
    isLocked: false,
  });

  if (openSeason) {
    throw new AppError(409, "Finish the current season before creating a new one");
  }

  const season = await SeasonModel.create({
    groupId: normalizedGroupId,
    name: payload.name,
    status: "draft",
  });

  res.status(201).json({ season });
});

export const getSeason = asyncHandler(async (req, res) => {
  const season = await SeasonModel.findById(req.params.seasonId).lean();

  if (!season) {
    throw new AppError(404, "Season not found");
  }

  await assertGroupManager(season.groupId.toString(), req.user);

  const [sessions, matches, rankings] = await Promise.all([
    SessionModel.find({ seasonId: season._id.toString() }).sort({ scheduledFor: -1 }).lean(),
    MatchModel.find({ seasonId: season._id.toString() }).sort({ courtOrder: 1 }).lean(),
    calculateSeasonRankings(season._id.toString(), season.groupId.toString()),
  ]);

  const matchesBySessionId = matches.reduce<Record<string, typeof matches>>((accumulator, match) => {
    const key = match.sessionId.toString();
    accumulator[key] ??= [];
    accumulator[key].push(match);
    return accumulator;
  }, {});

  res.json({
    season,
    sessions: sessions.map((session) => ({
      ...session,
      isResultsSaved: areSessionResultsSaved(session, matchesBySessionId[session._id.toString()] ?? []),
      matches: matchesBySessionId[session._id.toString()] ?? [],
    })),
    rankings,
  });
});

export const getSeasonRankings = asyncHandler(async (req, res) => {
  const season = await SeasonModel.findById(req.params.seasonId).lean();

  if (!season) {
    throw new AppError(404, "Season not found");
  }

  await assertGroupManager(season.groupId.toString(), req.user);
  const rankings = await calculateSeasonRankings(season._id.toString(), season.groupId.toString());

  res.json(rankings);
});

export const finalizeSeason = asyncHandler(async (req, res) => {
  const season = await SeasonModel.findById(req.params.seasonId);

  if (!season) {
    throw new AppError(404, "Season not found");
  }

  await assertGroupManager(season.groupId.toString(), req.user);

  season.status = "completed";
  season.endDate = new Date();
  season.isLocked = true;
  await season.save();

  const rankings = await calculateSeasonRankings(season._id.toString(), season.groupId.toString());

  res.json({
    season,
    rankings,
  });
});

export const deleteSeason = asyncHandler(async (req, res) => {
  const season = await SeasonModel.findById(req.params.seasonId);

  if (!season) {
    throw new AppError(404, "Season not found");
  }

  const normalizedSeasonId = season._id.toString();
  await assertGroupManager(season.groupId.toString(), req.user);

  await Promise.all([
    MatchModel.deleteMany({ seasonId: normalizedSeasonId }),
    SessionModel.deleteMany({ seasonId: normalizedSeasonId }),
  ]);

  await SeasonModel.deleteOne({ _id: season._id });

  res.json({
    message: "Season deleted successfully",
  });
});
