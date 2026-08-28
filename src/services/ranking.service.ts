import { MatchModel } from "../models/Match";
import { SeasonModel } from "../models/Season";
import { SeasonParticipantModel } from "../models/SeasonParticipant";
import { SessionModel } from "../models/Session";
import { AppError } from "../utils/appError";
import type { SessionStatus } from "../domain/constants";

export const RANKING_RULES = [
  "points",
  "win_rate",
  "score_difference",
  "score_for",
  "wins",
  "matches_played",
  "head_to_head",
] as const;

export type RankingParticipantInput = {
  playerProfileId: string;
  displayName: string;
  nickname?: string;
};

export type RankingMatchInput = {
  teamAProfileIds: string[];
  teamBProfileIds: string[];
  scoreA: number;
  scoreB: number;
  winnerTeam: "A" | "B";
};

export type RankingRow = {
  playerProfileId: string;
  displayName: string;
  nickname?: string;
  rank: number;
  points: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  winRate: number;
  scoreDifference: number;
  scoreFor: number;
  sessionsAttended: number;
  absences: number;
  headToHead: {
    applied: boolean;
    directMatches: number;
    wins: number;
    losses: number;
  };
};

type MutableRankingRow = RankingRow & { h2hSortWins: number | null };

function pairKey(firstId: string, secondId: string) {
  return [firstId, secondId].sort().join(":");
}

function compareBaseRanking(left: RankingRow, right: RankingRow) {
  if (right.points !== left.points) return right.points - left.points;
  if (right.winRate !== left.winRate) return right.winRate - left.winRate;
  if (right.scoreDifference !== left.scoreDifference) {
    return right.scoreDifference - left.scoreDifference;
  }
  if (right.scoreFor !== left.scoreFor) return right.scoreFor - left.scoreFor;
  if (right.wins !== left.wins) return right.wins - left.wins;
  if (right.matchesPlayed !== left.matchesPlayed) return right.matchesPlayed - left.matchesPlayed;
  return 0;
}

function baseTieKey(row: RankingRow) {
  return [
    row.points,
    row.winRate.toFixed(6),
    row.scoreDifference,
    row.scoreFor,
    row.wins,
    row.matchesPlayed,
  ].join("|");
}

export function calculateRankingRows(
  participants: RankingParticipantInput[],
  matches: RankingMatchInput[],
  attendance: Record<string, { attended: number; absent: number }> = {},
) {
  const rows = new Map<string, MutableRankingRow>();

  for (const participant of participants) {
    const attendanceRow = attendance[participant.playerProfileId] ?? { attended: 0, absent: 0 };
    rows.set(participant.playerProfileId, {
      playerProfileId: participant.playerProfileId,
      displayName: participant.displayName,
      nickname: participant.nickname,
      rank: 0,
      points: 0,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      scoreDifference: 0,
      scoreFor: 0,
      sessionsAttended: attendanceRow.attended,
      absences: attendanceRow.absent,
      headToHead: { applied: false, directMatches: 0, wins: 0, losses: 0 },
      h2hSortWins: null,
    });
  }

  for (const match of matches) {
    const teamAWin = match.winnerTeam === "A";

    for (const playerId of match.teamAProfileIds) {
      const row = rows.get(playerId);
      if (!row) continue;
      row.matchesPlayed += 1;
      row.scoreFor += match.scoreA;
      row.scoreDifference += match.scoreA - match.scoreB;
      if (teamAWin) {
        row.wins += 1;
        row.points += 1;
      } else {
        row.losses += 1;
      }
    }

    for (const playerId of match.teamBProfileIds) {
      const row = rows.get(playerId);
      if (!row) continue;
      row.matchesPlayed += 1;
      row.scoreFor += match.scoreB;
      row.scoreDifference += match.scoreB - match.scoreA;
      if (!teamAWin) {
        row.wins += 1;
        row.points += 1;
      } else {
        row.losses += 1;
      }
    }
  }

  for (const row of rows.values()) {
    row.winRate = row.matchesPlayed === 0 ? 0 : Number((row.wins / row.matchesPlayed).toFixed(6));
  }

  const ordered = [...rows.values()].sort((left, right) => {
    const byBase = compareBaseRanking(left, right);
    return byBase || left.displayName.localeCompare(right.displayName, "vi");
  });
  const tieGroups = new Map<string, MutableRankingRow[]>();

  for (const row of ordered) {
    const key = baseTieKey(row);
    tieGroups.set(key, [...(tieGroups.get(key) ?? []), row]);
  }

  for (const tiedRows of tieGroups.values()) {
    if (tiedRows.length < 2) continue;

    const tiedIds = new Set(tiedRows.map((row) => row.playerProfileId));
    const encounters = new Map<string, number>();
    const h2hStats = new Map(
      tiedRows.map((row) => [row.playerProfileId, { matches: 0, wins: 0, losses: 0 }]),
    );

    for (const match of matches) {
      const teamAIds = match.teamAProfileIds.filter((id) => tiedIds.has(id));
      const teamBIds = match.teamBProfileIds.filter((id) => tiedIds.has(id));
      if (!teamAIds.length || !teamBIds.length) continue;

      for (const leftId of teamAIds) {
        for (const rightId of teamBIds) {
          const key = pairKey(leftId, rightId);
          encounters.set(key, (encounters.get(key) ?? 0) + 1);
        }
      }

      for (const playerId of [...teamAIds, ...teamBIds]) {
        const stat = h2hStats.get(playerId);
        if (!stat) continue;
        stat.matches += 1;
        const playerWon = teamAIds.includes(playerId)
          ? match.winnerTeam === "A"
          : match.winnerTeam === "B";
        if (playerWon) stat.wins += 1;
        else stat.losses += 1;
      }
    }

    const hasCompleteDirectData = tiedRows.every((left, leftIndex) =>
      tiedRows.slice(leftIndex + 1).every(
        (right) => (encounters.get(pairKey(left.playerProfileId, right.playerProfileId)) ?? 0) > 0,
      ),
    );

    if (!hasCompleteDirectData) continue;

    for (const row of tiedRows) {
      const stat = h2hStats.get(row.playerProfileId) ?? { matches: 0, wins: 0, losses: 0 };
      row.headToHead = {
        applied: true,
        directMatches: stat.matches,
        wins: stat.wins,
        losses: stat.losses,
      };
      row.h2hSortWins = stat.wins;
    }
  }

  ordered.sort((left, right) => {
    const byBase = compareBaseRanking(left, right);
    if (byBase) return byBase;
    if (left.h2hSortWins !== null && right.h2hSortWins !== null) {
      const byH2h = right.h2hSortWins - left.h2hSortWins;
      if (byH2h) return byH2h;
    }
    return left.displayName.localeCompare(right.displayName, "vi");
  });

  let previousSignature = "";
  let previousRank = 0;
  ordered.forEach((row, index) => {
    const signature = `${baseTieKey(row)}|${row.h2hSortWins ?? "na"}`;
    row.rank = index === 0 || signature !== previousSignature ? index + 1 : previousRank;
    previousSignature = signature;
    previousRank = row.rank;
  });

  return ordered.map(({ h2hSortWins: _h2hSortWins, ...row }) => row);
}

export async function calculateSeasonRankings(
  seasonId: string,
  mode: "provisional" | "official" = "provisional",
) {
  const season = await SeasonModel.findById(seasonId).lean();
  if (!season) {
    throw new AppError(404, "Season not found", "SEASON_NOT_FOUND");
  }

  const sessionStatuses: SessionStatus[] =
    mode === "official" ? ["locked"] : ["in_progress", "completed", "locked"];
  const [participants, sessions] = await Promise.all([
    SeasonParticipantModel.find({ seasonId }).sort({ seedOrder: 1 }).lean(),
    SessionModel.find({ seasonId, status: { $in: sessionStatuses } }).lean(),
  ]);
  const sessionIds = sessions.map((session) => session._id);
  const matches = sessionIds.length
    ? await MatchModel.find({ sessionId: { $in: sessionIds }, status: "completed" }).lean()
    : [];
  const attendance = Object.fromEntries(
    participants.map((participant) => [
      participant.playerProfileId.toString(),
      { attended: 0, absent: 0 },
    ]),
  );

  for (const session of sessions) {
    for (const profileId of session.participantProfileIds) {
      const row = attendance[profileId.toString()];
      if (row) row.attended += 1;
    }
    for (const profileId of session.absentProfileIds) {
      const row = attendance[profileId.toString()];
      if (row) row.absent += 1;
    }
  }

  const rows = calculateRankingRows(
    participants.map((participant) => ({
      playerProfileId: participant.playerProfileId.toString(),
      displayName: participant.displayNameSnapshot,
      nickname: participant.nicknameSnapshot ?? undefined,
    })),
    matches.map((match) => ({
      teamAProfileIds: match.teamAProfileIds.map((id) => id.toString()),
      teamBProfileIds: match.teamBProfileIds.map((id) => id.toString()),
      scoreA: match.scoreA ?? 0,
      scoreB: match.scoreB ?? 0,
      winnerTeam: match.winnerTeam as "A" | "B",
    })),
    attendance,
  );

  return {
    seasonId: season._id.toString(),
    groupId: season.groupId.toString(),
    status: season.status === "completed" && mode === "official" ? "official" : mode,
    rankingRules: RANKING_RULES,
    totals: { sessions: sessions.length, matches: matches.length },
    rows,
  };
}
