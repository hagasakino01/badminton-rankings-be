import { MatchModel } from "../models/Match";
import { PlayerModel } from "../models/Player";
import { SessionModel } from "../models/Session";

type RankingRow = {
  playerId: string;
  fullName: string;
  nickname?: string;
  sessionsAttended: number;
  absences: number;
  matchesPlayed: number;
  wins: number;
  losses: number;
  points: number;
  winRate: number;
  scoreDifference: number;
  rank: number;
};

export async function calculateSeasonRankings(seasonId: string, groupId: string) {
  const [players, sessions, matches] = await Promise.all([
    PlayerModel.find({ groupId, status: "active" }).lean(),
    SessionModel.find({ seasonId }).lean(),
    MatchModel.find({ seasonId, status: "completed" }).lean(),
  ]);

  const rankingMap = new Map<string, RankingRow>();

  for (const player of players) {
    rankingMap.set(player._id.toString(), {
      playerId: player._id.toString(),
      fullName: player.fullName,
      nickname: player.nickname,
      sessionsAttended: 0,
      absences: 0,
      matchesPlayed: 0,
      wins: 0,
      losses: 0,
      points: 0,
      winRate: 0,
      scoreDifference: 0,
      rank: 0,
    });
  }

  for (const session of sessions) {
    for (const playerId of session.participantIds.map((id) => id.toString())) {
      const row = rankingMap.get(playerId);
      if (row) {
        row.sessionsAttended += 1;
      }
    }

    for (const playerId of session.absentPlayerIds.map((id) => id.toString())) {
      const row = rankingMap.get(playerId);
      if (row) {
        row.absences += 1;
      }
    }
  }

  for (const match of matches) {
    const teamAIds = match.teamAIds.map((id) => id.toString());
    const teamBIds = match.teamBIds.map((id) => id.toString());
    const teamAWin = match.winnerTeam === "A";
    const scoreA = match.scoreA ?? 0;
    const scoreB = match.scoreB ?? 0;

    for (const playerId of teamAIds) {
      const row = rankingMap.get(playerId);
      if (!row) continue;
      row.matchesPlayed += 1;
      row.scoreDifference += scoreA - scoreB;
      if (teamAWin) {
        row.wins += 1;
        row.points += 1;
      } else {
        row.losses += 1;
      }
    }

    for (const playerId of teamBIds) {
      const row = rankingMap.get(playerId);
      if (!row) continue;
      row.matchesPlayed += 1;
      row.scoreDifference += scoreB - scoreA;
      if (!teamAWin) {
        row.wins += 1;
        row.points += 1;
      } else {
        row.losses += 1;
      }
    }
  }

  const rows = [...rankingMap.values()].map((row) => ({
    ...row,
    winRate: row.matchesPlayed === 0 ? 0 : Number((row.wins / row.matchesPlayed).toFixed(3)),
  }));

  rows.sort((left, right) => {
    if (right.points !== left.points) return right.points - left.points;
    if (right.winRate !== left.winRate) return right.winRate - left.winRate;
    if (right.scoreDifference !== left.scoreDifference) {
      return right.scoreDifference - left.scoreDifference;
    }
    if (right.wins !== left.wins) return right.wins - left.wins;
    return left.fullName.localeCompare(right.fullName);
  });

  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  return {
    rankingRules: [
      "Total points",
      "Win rate",
      "Score difference",
      "Total wins",
      "Alphabetical name",
    ],
    totals: {
      sessions: sessions.length,
      matches: matches.length,
    },
    rows,
  };
}
