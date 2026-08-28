import { z } from "zod";

import { COMPETITION_MODES, GROUP_MIN_ACTIVE_MEMBERS } from "../domain/constants";
import { GroupMemberModel } from "../models/GroupMember";
import { MatchModel } from "../models/Match";
import { PlayerProfileModel } from "../models/PlayerProfile";
import { RankingSnapshotModel } from "../models/RankingSnapshot";
import { SeasonModel } from "../models/Season";
import { SeasonParticipantModel } from "../models/SeasonParticipant";
import { SessionModel } from "../models/Session";
import {
  requireActiveGroupMember,
  requireGroupAccess,
  requireGroupPermission,
} from "../services/access.service";
import { writeAuditLog } from "../services/audit.service";
import { countActiveGroupMembers } from "../services/groupLifecycle.service";
import { calculateSeasonRankings, RANKING_RULES } from "../services/ranking.service";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/appError";
import { routeParam } from "../utils/routeParam";

const dateFields = {
  startsOn: z.coerce.date().optional(),
  endsOn: z.coerce.date().optional(),
};

const createSeasonSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    mode: z.enum(COMPETITION_MODES),
    ...dateFields,
    participantProfileIds: z.array(z.string()).min(5).max(20).optional(),
  })
  .refine((value) => !value.startsOn || !value.endsOn || value.endsOn >= value.startsOn, {
    message: "Season end date must not be before its start date",
    path: ["endsOn"],
  });

const updateSeasonSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    mode: z.enum(COMPETITION_MODES).optional(),
    ...dateFields,
  })
  .refine((value) => Object.keys(value).length > 0, "At least one season field is required")
  .refine((value) => !value.startsOn || !value.endsOn || value.endsOn >= value.startsOn, {
    message: "Season end date must not be before its start date",
    path: ["endsOn"],
  });

const rosterSchema = z.object({
  participantProfileIds: z.array(z.string()).min(5).max(20),
});

async function getSeasonOrThrow(seasonId: string) {
  const season = await SeasonModel.findById(seasonId);
  if (!season) {
    throw new AppError(404, "Season not found", "SEASON_NOT_FOUND");
  }
  return season;
}

async function buildRoster(groupId: string, requestedProfileIds?: string[]) {
  const activeMembers = await GroupMemberModel.find({ groupId, status: "active" }).lean();
  const availableIds = new Set(
    activeMembers.map((member) => member.playerProfileId.toString()),
  );
  const profileIds = requestedProfileIds ?? [...availableIds];
  const uniqueIds = [...new Set(profileIds)];

  if (uniqueIds.length !== profileIds.length) {
    throw new AppError(400, "Season roster cannot contain duplicate players", "ROSTER_DUPLICATE_PLAYER");
  }
  if (uniqueIds.length < GROUP_MIN_ACTIVE_MEMBERS || uniqueIds.length > 20) {
    throw new AppError(
      400,
      "A season roster requires between 5 and 20 active members",
      "ROSTER_SIZE_INVALID",
      { minimum: GROUP_MIN_ACTIVE_MEMBERS, maximum: 20 },
    );
  }
  const unavailableIds = uniqueIds.filter((profileId) => !availableIds.has(profileId));
  if (unavailableIds.length) {
    throw new AppError(
      400,
      "Every season participant must be an active group member",
      "ROSTER_MEMBER_INACTIVE",
      { playerProfileIds: unavailableIds },
    );
  }

  const profiles = await PlayerProfileModel.find({
    _id: { $in: uniqueIds },
    status: "active",
  }).lean();
  if (profiles.length !== uniqueIds.length) {
    throw new AppError(400, "One or more player profiles are unavailable", "ROSTER_PROFILE_MISSING");
  }

  const memberByProfileId = new Map(
    activeMembers.map((member) => [member.playerProfileId.toString(), member]),
  );
  const profileById = new Map(profiles.map((profile) => [profile._id.toString(), profile]));

  return uniqueIds.map((profileId, index) => {
    const member = memberByProfileId.get(profileId)!;
    const profile = profileById.get(profileId)!;
    return {
      groupId,
      groupMemberId: member._id,
      playerProfileId: profile._id,
      displayNameSnapshot: profile.fullName,
      nicknameSnapshot: profile.nickname,
      seedOrder: index + 1,
    };
  });
}

export const listSeasons = asyncHandler(async (req, res) => {
  const groupId = routeParam(req, "groupId");
  await requireGroupAccess(groupId, req.user!.userId);
  const seasons = await SeasonModel.find({ groupId })
    .sort({ createdAt: -1 })
    .lean();
  const items = await Promise.all(
    seasons.map(async (season) => {
      const [participantCount, sessionCount] = await Promise.all([
        SeasonParticipantModel.countDocuments({ seasonId: season._id }),
        SessionModel.countDocuments({ seasonId: season._id }),
      ]);
      return { ...season, participantCount, sessionCount };
    }),
  );

  res.json({ seasons: items });
});

export const createSeason = asyncHandler(async (req, res) => {
  const payload = createSeasonSchema.parse(req.body);
  const { group, member: actor } = await requireGroupPermission(
    routeParam(req, "groupId"),
    req.user!.userId,
    "manage_seasons",
  );
  const activeMemberCount = await countActiveGroupMembers(group._id.toString());
  if (group.status !== "active" || activeMemberCount < GROUP_MIN_ACTIVE_MEMBERS) {
    throw new AppError(
      409,
      "Draft groups cannot create seasons",
      "ACTIVE_GROUP_REQUIRED",
      { groupStatus: group.status, activeMemberCount },
    );
  }

  const roster = await buildRoster(group._id.toString(), payload.participantProfileIds);
  const season = await SeasonModel.create({
    groupId: group._id,
    name: payload.name,
    mode: payload.mode,
    startsOn: payload.startsOn,
    endsOn: payload.endsOn,
    status: "upcoming",
    rosterLocked: false,
    createdByUserId: req.user!.userId,
  });

  try {
    await SeasonParticipantModel.insertMany(
      roster.map((participant) => ({ ...participant, seasonId: season._id })),
    );
    await writeAuditLog({
      groupId: group._id,
      seasonId: season._id,
      actorUserId: req.user!.userId,
      actorRole: actor.role,
      action: "season.created",
      targetType: "season",
      targetId: season._id,
      metadata: { name: season.name, mode: season.mode, participantCount: roster.length },
    });

    res.status(201).json({ season, participantCount: roster.length });
  } catch (error) {
    await SeasonModel.deleteOne({ _id: season._id });
    throw error;
  }
});

export const getSeason = asyncHandler(async (req, res) => {
  const season = await getSeasonOrThrow(routeParam(req, "seasonId"));
  const { member } = await requireGroupAccess(season.groupId.toString(), req.user!.userId);
  const [participants, sessions] = await Promise.all([
    SeasonParticipantModel.find({ seasonId: season._id }).sort({ seedOrder: 1 }).lean(),
    SessionModel.find({ seasonId: season._id }).sort({ scheduledFor: -1 }).lean(),
  ]);

  res.json({
    season,
    participants,
    sessions,
    currentMembership: {
      id: member._id,
      role: member.role,
      permissions: member.permissions,
      status: member.status,
    },
    rankingRules: RANKING_RULES,
  });
});

export const updateSeason = asyncHandler(async (req, res) => {
  const payload = updateSeasonSchema.parse(req.body);
  const season = await getSeasonOrThrow(routeParam(req, "seasonId"));
  const { member: actor } = await requireGroupPermission(
    season.groupId.toString(),
    req.user!.userId,
    "manage_seasons",
  );
  if (season.status !== "upcoming") {
    throw new AppError(409, "Only upcoming seasons can be edited", "SEASON_NOT_EDITABLE");
  }

  const nextStartsOn = payload.startsOn ?? season.startsOn;
  const nextEndsOn = payload.endsOn ?? season.endsOn;
  if (nextStartsOn && nextEndsOn && nextEndsOn < nextStartsOn) {
    throw new AppError(400, "Season end date must not be before its start date", "SEASON_DATES_INVALID");
  }

  const before = season.toObject();
  season.set(payload);
  season.version += 1;
  await season.save();
  await writeAuditLog({
    groupId: season.groupId,
    seasonId: season._id,
    actorUserId: req.user!.userId,
    actorRole: actor.role,
    action: "season.updated",
    targetType: "season",
    targetId: season._id,
    metadata: { before, after: payload },
  });

  res.json({ season });
});

export const replaceSeasonRoster = asyncHandler(async (req, res) => {
  const payload = rosterSchema.parse(req.body);
  const season = await getSeasonOrThrow(routeParam(req, "seasonId"));
  const { member: actor } = await requireGroupPermission(
    season.groupId.toString(),
    req.user!.userId,
    "manage_seasons",
  );
  if (season.status !== "upcoming" || season.rosterLocked) {
    throw new AppError(409, "The season roster is locked", "SEASON_ROSTER_LOCKED");
  }

  const roster = await buildRoster(season.groupId.toString(), payload.participantProfileIds);
  await SeasonParticipantModel.deleteMany({ seasonId: season._id });
  await SeasonParticipantModel.insertMany(
    roster.map((participant) => ({ ...participant, seasonId: season._id })),
  );
  season.version += 1;
  await season.save();
  await writeAuditLog({
    groupId: season.groupId,
    seasonId: season._id,
    actorUserId: req.user!.userId,
    actorRole: actor.role,
    action: "season.roster_replaced",
    targetType: "season",
    targetId: season._id,
    metadata: {
      participantCount: roster.length,
      playerProfileIds: roster.map((participant) => participant.playerProfileId),
    },
  });

  res.json({ participants: roster, version: season.version });
});

export const activateSeason = asyncHandler(async (req, res) => {
  const season = await getSeasonOrThrow(routeParam(req, "seasonId"));
  const { group, member: actor } = await requireGroupPermission(
    season.groupId.toString(),
    req.user!.userId,
    "manage_seasons",
  );
  if (season.status !== "upcoming") {
    throw new AppError(409, "Only upcoming seasons can be activated", "SEASON_NOT_UPCOMING");
  }

  const [activeMemberCount, roster, otherActiveSeason] = await Promise.all([
    countActiveGroupMembers(group._id.toString()),
    SeasonParticipantModel.find({ seasonId: season._id }).lean(),
    SeasonModel.findOne({ groupId: group._id, status: "active", _id: { $ne: season._id } })
      .select("_id name")
      .lean(),
  ]);
  if (group.status !== "active" || activeMemberCount < GROUP_MIN_ACTIVE_MEMBERS) {
    throw new AppError(409, "An active group is required", "ACTIVE_GROUP_REQUIRED");
  }
  if (roster.length < GROUP_MIN_ACTIVE_MEMBERS || roster.length > 20) {
    throw new AppError(409, "Season roster must contain 5 to 20 players", "ROSTER_SIZE_INVALID");
  }
  if (otherActiveSeason) {
    throw new AppError(
      409,
      "This group already has an active season",
      "ACTIVE_SEASON_EXISTS",
      { activeSeasonId: otherActiveSeason._id, activeSeasonName: otherActiveSeason.name },
    );
  }
  const activeRosterMembers = await GroupMemberModel.countDocuments({
    groupId: group._id,
    playerProfileId: { $in: roster.map((participant) => participant.playerProfileId) },
    status: "active",
  });
  if (activeRosterMembers !== roster.length) {
    throw new AppError(
      409,
      "Every roster player must still be an active group member",
      "ROSTER_MEMBER_INACTIVE",
    );
  }

  season.status = "active";
  season.rosterLocked = true;
  season.activatedAt = new Date();
  season.activatedByUserId = actor.userId;
  season.startsOn ??= new Date();
  season.version += 1;
  await season.save();
  await writeAuditLog({
    groupId: season.groupId,
    seasonId: season._id,
    actorUserId: req.user!.userId,
    actorRole: actor.role,
    action: "season.activated",
    targetType: "season",
    targetId: season._id,
    metadata: { participantCount: roster.length },
  });

  res.json({ season });
});

export const getSeasonRankings = asyncHandler(async (req, res) => {
  const season = await getSeasonOrThrow(routeParam(req, "seasonId"));
  await requireActiveGroupMember(season.groupId.toString(), req.user!.userId);

  if (season.status === "completed" && season.finalSnapshotId) {
    const snapshot = await RankingSnapshotModel.findOne({
      _id: season.finalSnapshotId,
      invalidatedAt: { $exists: false },
    }).lean();
    if (snapshot) {
      res.json({
        seasonId: season._id,
        groupId: season.groupId,
        status: "official",
        rankingRules: RANKING_RULES,
        snapshotId: snapshot._id,
        snapshotCreatedAt: snapshot.createdAt,
        rows: snapshot.rows,
      });
      return;
    }
  }

  res.json(
    await calculateSeasonRankings(
      season._id.toString(),
      season.status === "completed" ? "official" : "provisional",
    ),
  );
});

export const getSeasonHeadToHead = asyncHandler(async (req, res) => {
  const query = z
    .object({ playerA: z.string().min(1), playerB: z.string().min(1) })
    .refine((value) => value.playerA !== value.playerB, "Choose two different players")
    .parse(req.query);
  const season = await getSeasonOrThrow(routeParam(req, "seasonId"));
  await requireActiveGroupMember(season.groupId.toString(), req.user!.userId);
  const participants = await SeasonParticipantModel.find({
    seasonId: season._id,
    playerProfileId: { $in: [query.playerA, query.playerB] },
  }).lean();
  if (participants.length !== 2) {
    throw new AppError(400, "Both players must belong to this season", "H2H_PLAYERS_INVALID");
  }

  const sessionStatuses =
    season.status === "completed"
      ? (["locked"] as const)
      : (["in_progress", "completed", "locked"] as const);
  const sessions = await SessionModel.find({
    seasonId: season._id,
    status: { $in: sessionStatuses },
  })
    .select("_id")
    .lean();
  const matches = await MatchModel.find({
    sessionId: { $in: sessions.map((session) => session._id) },
    status: "completed",
    $and: [
      { $or: [{ teamAProfileIds: query.playerA }, { teamBProfileIds: query.playerA }] },
      { $or: [{ teamAProfileIds: query.playerB }, { teamBProfileIds: query.playerB }] },
    ],
  }).lean();

  let playerAWins = 0;
  let playerBWins = 0;
  let directMatches = 0;
  let teammateMatches = 0;
  for (const match of matches) {
    const aOnTeamA = match.teamAProfileIds.some((id) => id.toString() === query.playerA);
    const bOnTeamA = match.teamAProfileIds.some((id) => id.toString() === query.playerB);
    const aOnTeamB = match.teamBProfileIds.some((id) => id.toString() === query.playerA);
    const bOnTeamB = match.teamBProfileIds.some((id) => id.toString() === query.playerB);
    if ((aOnTeamA && bOnTeamA) || (aOnTeamB && bOnTeamB)) {
      teammateMatches += 1;
      continue;
    }
    if (!((aOnTeamA && bOnTeamB) || (aOnTeamB && bOnTeamA))) continue;

    directMatches += 1;
    const aWon = (aOnTeamA && match.winnerTeam === "A") || (aOnTeamB && match.winnerTeam === "B");
    if (aWon) playerAWins += 1;
    else playerBWins += 1;
  }

  res.json({
    seasonId: season._id,
    playerA: participants.find(
      (participant) => participant.playerProfileId.toString() === query.playerA,
    ),
    playerB: participants.find(
      (participant) => participant.playerProfileId.toString() === query.playerB,
    ),
    directMatches,
    playerAWins,
    playerBWins,
    teammateMatches,
    dataSufficient: directMatches > 0,
  });
});

export const completeSeason = asyncHandler(async (req, res) => {
  const season = await getSeasonOrThrow(routeParam(req, "seasonId"));
  const { member: actor } = await requireGroupPermission(
    season.groupId.toString(),
    req.user!.userId,
    "manage_seasons",
  );
  if (season.status !== "active") {
    throw new AppError(409, "Only active seasons can be completed", "SEASON_NOT_ACTIVE");
  }

  const sessions = await SessionModel.find({ seasonId: season._id }).select("_id status").lean();
  if (!sessions.length) {
    throw new AppError(409, "A season needs at least one session", "SEASON_HAS_NO_SESSIONS");
  }
  const unlockedSessions = sessions.filter((session) => session.status !== "locked");
  if (unlockedSessions.length) {
    throw new AppError(
      409,
      "Every session must be locked before completing the season",
      "SEASON_SESSIONS_NOT_LOCKED",
      { sessionIds: unlockedSessions.map((session) => session._id) },
    );
  }

  const ranking = await calculateSeasonRankings(season._id.toString(), "official");
  const nextVersion = season.version + 1;
  const snapshot = await RankingSnapshotModel.create({
    groupId: season.groupId,
    seasonId: season._id,
    type: "season_final",
    rows: ranking.rows.map((row) => ({ ...row, h2hApplied: row.headToHead.applied })),
    sourceVersion: nextVersion,
    createdByUserId: req.user!.userId,
  });

  season.status = "completed";
  season.completedAt = new Date();
  season.completedByUserId = actor.userId;
  season.endsOn ??= new Date();
  season.finalSnapshotId = snapshot._id;
  season.version = nextVersion;
  await season.save();
  await writeAuditLog({
    groupId: season.groupId,
    seasonId: season._id,
    actorUserId: req.user!.userId,
    actorRole: actor.role,
    action: "season.completed",
    targetType: "season",
    targetId: season._id,
    metadata: { finalSnapshotId: snapshot._id, sessions: sessions.length },
  });

  res.json({ season, ranking: { ...ranking, status: "official", snapshotId: snapshot._id } });
});

export const deleteSeason = asyncHandler(async (req, res) => {
  const season = await getSeasonOrThrow(routeParam(req, "seasonId"));
  const { member: actor } = await requireGroupPermission(
    season.groupId.toString(),
    req.user!.userId,
    "manage_seasons",
  );
  if (season.status !== "upcoming") {
    throw new AppError(409, "Only upcoming seasons can be deleted", "SEASON_DELETE_NOT_ALLOWED");
  }
  if (await SessionModel.exists({ seasonId: season._id })) {
    throw new AppError(409, "Delete all sessions first", "SEASON_HAS_SESSIONS");
  }

  await SeasonParticipantModel.deleteMany({ seasonId: season._id });
  await SeasonModel.deleteOne({ _id: season._id });
  await writeAuditLog({
    groupId: season.groupId,
    seasonId: season._id,
    actorUserId: req.user!.userId,
    actorRole: actor.role,
    action: "season.deleted",
    targetType: "season",
    targetId: season._id,
    metadata: { name: season.name },
  });

  res.status(204).send();
});

export const finalizeSeason = completeSeason;
