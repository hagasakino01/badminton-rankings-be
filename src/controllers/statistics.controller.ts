import { isValidObjectId } from "mongoose";
import { z } from "zod";

import { GroupModel } from "../models/Group";
import { GroupMemberModel } from "../models/GroupMember";
import { MatchModel } from "../models/Match";
import { PlayerProfileModel } from "../models/PlayerProfile";
import { RankingSnapshotModel } from "../models/RankingSnapshot";
import { SeasonModel } from "../models/Season";
import { SeasonParticipantModel } from "../models/SeasonParticipant";
import { SessionModel } from "../models/Session";
import { requireActiveGroupMember } from "../services/access.service";
import {
  summarizePersonalMatches,
  type PersonalMatchInput,
} from "../services/personalStatistics.service";
import { calculateSeasonRankings } from "../services/ranking.service";
import { asyncHandler } from "../utils/asyncHandler";
import { AppError } from "../utils/appError";
import { routeParam } from "../utils/routeParam";

type AggregateRow = {
  playerProfileId: string;
  displayName: string;
  seasonsPlayed: number;
  totalMatches: number;
  totalWins: number;
  totalLosses: number;
  totalPoints: number;
  totalScoreFor: number;
  totalScoreDifference: number;
  firstPlaceFinishes: number;
  topThreeFinishes: number;
  bestRank: number | null;
  rankTotal: number;
};

const optionalObjectId = z
  .string()
  .refine((value) => isValidObjectId(value), "Invalid identifier")
  .optional();

const personalStatisticsQuerySchema = z.object({
  groupId: optionalObjectId,
  seasonId: optionalObjectId,
  mode: z.enum(["all", "singles", "doubles"]).default("all"),
  historyLimit: z.coerce.number().int().min(1).max(100).default(30),
});

function emptyPerformance() {
  return {
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    points: 0,
    scoreFor: 0,
    scoreAgainst: 0,
    scoreDifference: 0,
    sessionsPlayed: 0,
  };
}

export const getAllSeasonsStats = asyncHandler(async (req, res) => {
  const groupId = routeParam(req, "groupId");
  await requireActiveGroupMember(groupId, req.user!.userId);

  const seasons = await SeasonModel.find({ groupId, status: "completed" })
    .sort({ completedAt: 1 })
    .select("_id name mode completedAt finalSnapshotId")
    .lean();
  const snapshots = await RankingSnapshotModel.find({
    _id: { $in: seasons.map((season) => season.finalSnapshotId).filter(Boolean) },
    type: "season_final",
    invalidatedAt: { $exists: false },
  }).lean();
  const snapshotById = new Map(snapshots.map((snapshot) => [snapshot._id.toString(), snapshot]));
  const aggregates = new Map<string, AggregateRow>();

  for (const season of seasons) {
    if (!season.finalSnapshotId) continue;
    const snapshot = snapshotById.get(season.finalSnapshotId.toString());
    if (!snapshot) continue;

    for (const row of snapshot.rows) {
      const playerProfileId = row.playerProfileId.toString();
      const aggregate = aggregates.get(playerProfileId) ?? {
        playerProfileId,
        displayName: row.displayName,
        seasonsPlayed: 0,
        totalMatches: 0,
        totalWins: 0,
        totalLosses: 0,
        totalPoints: 0,
        totalScoreFor: 0,
        totalScoreDifference: 0,
        firstPlaceFinishes: 0,
        topThreeFinishes: 0,
        bestRank: null,
        rankTotal: 0,
      };

      aggregate.displayName = row.displayName;
      aggregate.seasonsPlayed += 1;
      aggregate.totalMatches += row.matchesPlayed;
      aggregate.totalWins += row.wins;
      aggregate.totalLosses += row.losses;
      aggregate.totalPoints += row.points;
      aggregate.totalScoreFor += row.scoreFor;
      aggregate.totalScoreDifference += row.scoreDifference;
      aggregate.firstPlaceFinishes += row.rank === 1 ? 1 : 0;
      aggregate.topThreeFinishes += row.rank <= 3 ? 1 : 0;
      aggregate.bestRank =
        aggregate.bestRank === null ? row.rank : Math.min(aggregate.bestRank, row.rank);
      aggregate.rankTotal += row.rank;
      aggregates.set(playerProfileId, aggregate);
    }
  }

  const profiles = await PlayerProfileModel.find({
    _id: { $in: [...aggregates.keys()] },
  })
    .select("fullName nickname avatarUrl status mergedIntoProfileId")
    .lean();
  const profileById = new Map(profiles.map((profile) => [profile._id.toString(), profile]));
  const rows = [...aggregates.values()]
    .map(({ rankTotal, ...row }) => {
      const profile = profileById.get(row.playerProfileId);
      return {
        ...row,
        displayName: profile?.fullName ?? row.displayName,
        nickname: profile?.nickname ?? null,
        avatarUrl: profile?.avatarUrl ?? null,
        overallWinRate:
          row.totalMatches === 0
            ? 0
            : Number((row.totalWins / row.totalMatches).toFixed(6)),
        averageRank:
          row.seasonsPlayed === 0 ? null : Number((rankTotal / row.seasonsPlayed).toFixed(2)),
      };
    })
    .sort((left, right) => left.displayName.localeCompare(right.displayName, "vi"));

  res.json({
    groupId,
    type: "aggregate_statistics",
    isOfficialRanking: false,
    completedSeasonCount: seasons.length,
    includedSeasonCount: snapshots.length,
    seasons: seasons.map((season) => ({
      id: season._id,
      name: season.name,
      mode: season.mode,
      completedAt: season.completedAt,
      included: Boolean(
        season.finalSnapshotId && snapshotById.has(season.finalSnapshotId.toString()),
      ),
    })),
    rows,
  });
});

export const getMyStatistics = asyncHandler(async (req, res) => {
  const query = personalStatisticsQuerySchema.parse(req.query);
  const profile = await PlayerProfileModel.findOne({
    userId: req.user!.userId,
    status: "active",
  }).lean();

  if (!profile) {
    const empty = emptyPerformance();
    res.json({
      linkedProfile: false,
      profile: null,
      filters: query,
      overview: {
        ...empty,
        currentWinStreak: 0,
        bestWinStreak: 0,
        groupCount: 0,
        seasonCount: 0,
        currentRank: null,
        bestRank: null,
        firstPlaceFinishes: 0,
        topThreeFinishes: 0,
        averageRank: null,
      },
      formats: { singles: empty, doubles: empty },
      groups: [],
      seasons: [],
      trend: [],
      frequentTeammates: [],
      frequentOpponents: [],
      historyTotal: 0,
      history: [],
    });
    return;
  }

  const memberships = await GroupMemberModel.find({
    userId: req.user!.userId,
    playerProfileId: profile._id,
    status: { $in: ["active", "inactive", "removed"] },
  }).lean();
  const allowedGroupIds = memberships.map((membership) => membership.groupId.toString());

  if (query.groupId && !allowedGroupIds.includes(query.groupId)) {
    throw new AppError(403, "You cannot view statistics for this group", "GROUP_ACCESS_DENIED");
  }

  const requestedSeason = query.seasonId
    ? await SeasonModel.findById(query.seasonId).lean()
    : null;
  if (query.seasonId && !requestedSeason) {
    throw new AppError(404, "Season not found", "SEASON_NOT_FOUND");
  }
  if (requestedSeason && !allowedGroupIds.includes(requestedSeason.groupId.toString())) {
    throw new AppError(403, "You cannot view statistics for this season", "GROUP_ACCESS_DENIED");
  }
  if (requestedSeason && query.groupId && requestedSeason.groupId.toString() !== query.groupId) {
    throw new AppError(400, "Season does not belong to the selected group", "STAT_FILTER_MISMATCH");
  }
  if (requestedSeason && query.mode !== "all" && requestedSeason.mode !== query.mode) {
    throw new AppError(400, "Season format does not match the selected filter", "STAT_FILTER_MISMATCH");
  }

  const scopedGroupIds = query.groupId
    ? [query.groupId]
    : requestedSeason
      ? [requestedSeason.groupId.toString()]
      : allowedGroupIds;
  const seasonFilter = {
    groupId: { $in: scopedGroupIds },
    ...(query.seasonId ? { _id: query.seasonId } : {}),
    ...(query.mode === "all" ? {} : { mode: query.mode }),
  };
  const candidateSeasons = await SeasonModel.find(seasonFilter).sort({ createdAt: -1 }).lean();
  const participantRows = await SeasonParticipantModel.find({
    seasonId: { $in: candidateSeasons.map((season) => season._id) },
    playerProfileId: profile._id,
  }).lean();
  const participantSeasonIds = new Set(
    participantRows.map((participant) => participant.seasonId.toString()),
  );
  const seasons = candidateSeasons.filter((season) =>
    participantSeasonIds.has(season._id.toString()),
  );
  const seasonIds = seasons.map((season) => season._id);
  const sessions = seasonIds.length
    ? await SessionModel.find({
        seasonId: { $in: seasonIds },
        status: { $in: ["in_progress", "completed", "locked"] },
      }).lean()
    : [];
  const sessionIds = sessions.map((session) => session._id);
  const matches = sessionIds.length
    ? await MatchModel.find({
        sessionId: { $in: sessionIds },
        status: "completed",
        $or: [
          { teamAProfileIds: profile._id },
          { teamBProfileIds: profile._id },
        ],
      }).lean()
    : [];

  const referencedProfileIds = new Set<string>([profile._id.toString()]);
  for (const match of matches) {
    for (const profileId of [...match.teamAProfileIds, ...match.teamBProfileIds]) {
      referencedProfileIds.add(profileId.toString());
    }
  }
  const [groups, referencedProfiles] = await Promise.all([
    GroupModel.find({ _id: { $in: scopedGroupIds } }).lean(),
    PlayerProfileModel.find({ _id: { $in: [...referencedProfileIds] } })
      .select("fullName")
      .lean(),
  ]);
  const groupById = new Map(groups.map((group) => [group._id.toString(), group]));
  const seasonById = new Map(seasons.map((season) => [season._id.toString(), season]));
  const sessionById = new Map(sessions.map((session) => [session._id.toString(), session]));
  const profileNames = Object.fromEntries(
    referencedProfiles.map((item) => [item._id.toString(), item.fullName]),
  );

  const normalizedMatches = matches.flatMap<PersonalMatchInput>((match) => {
    const season = seasonById.get(match.seasonId.toString());
    const session = sessionById.get(match.sessionId.toString());
    const group = groupById.get(match.groupId.toString());
    if (
      !season ||
      !session ||
      !group ||
      typeof match.scoreA !== "number" ||
      typeof match.scoreB !== "number" ||
      (match.winnerTeam !== "A" && match.winnerTeam !== "B")
    ) {
      return [];
    }

    return [{
      id: match._id.toString(),
      groupId: group._id.toString(),
      groupName: group.name,
      seasonId: season._id.toString(),
      seasonName: season.name,
      seasonStatus: season.status,
      mode: match.mode,
      sessionId: session._id.toString(),
      sessionTitle: session.title,
      scheduledFor: session.scheduledFor,
      roundNumber: match.roundNumber,
      teamAProfileIds: match.teamAProfileIds.map((id) => id.toString()),
      teamBProfileIds: match.teamBProfileIds.map((id) => id.toString()),
      scoreA: match.scoreA,
      scoreB: match.scoreB,
      winnerTeam: match.winnerTeam,
    }];
  });
  const statistics = summarizePersonalMatches(
    profile._id.toString(),
    normalizedMatches,
    profileNames,
    query.historyLimit,
  );

  const completedSeasons = seasons.filter(
    (season) => season.status === "completed" && season.finalSnapshotId,
  );
  const snapshots = completedSeasons.length
    ? await RankingSnapshotModel.find({
        _id: { $in: completedSeasons.map((season) => season.finalSnapshotId) },
        type: "season_final",
        invalidatedAt: { $exists: false },
      }).lean()
    : [];
  const snapshotById = new Map(snapshots.map((snapshot) => [snapshot._id.toString(), snapshot]));
  const matchStatsBySeason = new Map(
    statistics.seasons.map((season) => [season.seasonId, season]),
  );
  const seasonSummaries = await Promise.all(
    seasons.map(async (season) => {
      let rankingRow:
        | {
            rank: number;
            points: number;
            matchesPlayed: number;
            wins: number;
            losses: number;
            winRate: number;
            scoreFor: number;
            scoreDifference: number;
          }
        | undefined;
      let rankingStatus: "official" | "provisional" | "unavailable" = "unavailable";

      if (season.status === "completed" && season.finalSnapshotId) {
        const snapshot = snapshotById.get(season.finalSnapshotId.toString());
        rankingRow = snapshot?.rows.find(
          (row) => row.playerProfileId.toString() === profile._id.toString(),
        );
        rankingStatus = rankingRow ? "official" : "unavailable";
      } else if (season.status === "active") {
        const ranking = await calculateSeasonRankings(season._id.toString());
        rankingRow = ranking.rows.find(
          (row) => row.playerProfileId === profile._id.toString(),
        );
        rankingStatus = rankingRow ? "provisional" : "unavailable";
      }

      return {
        seasonId: season._id.toString(),
        seasonName: season.name,
        seasonStatus: season.status,
        mode: season.mode,
        groupId: season.groupId.toString(),
        groupName: groupById.get(season.groupId.toString())?.name ?? "Unknown group",
        startsOn: season.startsOn ?? null,
        endsOn: season.endsOn ?? null,
        rankingStatus,
        rank: rankingRow?.rank ?? null,
        ...emptyPerformance(),
        ...(matchStatsBySeason.get(season._id.toString()) ?? {}),
      };
    }),
  );
  seasonSummaries.sort((left, right) => {
    const leftDate = left.startsOn ? new Date(left.startsOn).getTime() : 0;
    const rightDate = right.startsOn ? new Date(right.startsOn).getTime() : 0;
    return rightDate - leftDate || left.seasonName.localeCompare(right.seasonName, "vi");
  });
  const officialRanks = seasonSummaries
    .filter((season) => season.rankingStatus === "official" && season.rank !== null)
    .map((season) => season.rank as number);
  const selectedRank = query.seasonId
    ? seasonSummaries.find((season) => season.seasonId === query.seasonId)?.rank ?? null
    : seasonSummaries.find(
        (season) => season.seasonStatus === "active" && season.rank !== null,
      )?.rank ?? null;
  const groupStatsById = new Map(statistics.groups.map((group) => [group.groupId, group]));
  const membershipByGroupId = new Map(
    memberships.map((membership) => [membership.groupId.toString(), membership]),
  );
  const groupSummaries = groups.map((group) => {
    const membership = membershipByGroupId.get(group._id.toString());
    return {
      groupId: group._id.toString(),
      groupName: group.name,
      role: membership?.role ?? "member",
      membershipStatus: membership?.status ?? "inactive",
      ...emptyPerformance(),
      ...(groupStatsById.get(group._id.toString()) ?? {}),
    };
  });

  res.json({
    linkedProfile: true,
    profile: {
      id: profile._id,
      fullName: profile.fullName,
      nickname: profile.nickname ?? null,
      avatarUrl: profile.avatarUrl ?? null,
    },
    filters: query,
    overview: {
      ...statistics.overall,
      groupCount: groupSummaries.length,
      seasonCount: seasonSummaries.length,
      currentRank: selectedRank,
      bestRank: officialRanks.length ? Math.min(...officialRanks) : null,
      firstPlaceFinishes: officialRanks.filter((rank) => rank === 1).length,
      topThreeFinishes: officialRanks.filter((rank) => rank <= 3).length,
      averageRank: officialRanks.length
        ? Number((officialRanks.reduce((sum, rank) => sum + rank, 0) / officialRanks.length).toFixed(2))
        : null,
    },
    formats: statistics.formats,
    groups: groupSummaries,
    seasons: seasonSummaries,
    trend: statistics.trend,
    frequentTeammates: statistics.frequentTeammates,
    frequentOpponents: statistics.frequentOpponents,
    historyTotal: statistics.historyTotal,
    history: statistics.history,
  });
});
