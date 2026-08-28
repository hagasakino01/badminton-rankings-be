export type PersonalMatchInput = {
  id: string;
  groupId: string;
  groupName: string;
  seasonId: string;
  seasonName: string;
  seasonStatus: "upcoming" | "active" | "completed";
  mode: "singles" | "doubles";
  sessionId: string;
  sessionTitle: string;
  scheduledFor: Date;
  roundNumber: number;
  teamAProfileIds: string[];
  teamBProfileIds: string[];
  scoreA: number;
  scoreB: number;
  winnerTeam: "A" | "B";
};

type AggregateAccumulator = {
  matchesPlayed: number;
  wins: number;
  losses: number;
  points: number;
  scoreFor: number;
  scoreAgainst: number;
  sessionIds: Set<string>;
};

type PerspectiveMatch = PersonalMatchInput & {
  result: "win" | "loss";
  scoreForPlayer: number;
  scoreAgainstPlayer: number;
  teammateProfileIds: string[];
  opponentProfileIds: string[];
};

type RelationshipAccumulator = {
  playerProfileId: string;
  encounters: number;
  wins: number;
  losses: number;
};

function createAccumulator(): AggregateAccumulator {
  return {
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    points: 0,
    scoreFor: 0,
    scoreAgainst: 0,
    sessionIds: new Set<string>(),
  };
}

function addMatch(accumulator: AggregateAccumulator, match: PerspectiveMatch) {
  accumulator.matchesPlayed += 1;
  accumulator.wins += match.result === "win" ? 1 : 0;
  accumulator.losses += match.result === "loss" ? 1 : 0;
  accumulator.points += match.result === "win" ? 1 : 0;
  accumulator.scoreFor += match.scoreForPlayer;
  accumulator.scoreAgainst += match.scoreAgainstPlayer;
  accumulator.sessionIds.add(match.sessionId);
}

function finalizeAccumulator(accumulator: AggregateAccumulator) {
  return {
    matchesPlayed: accumulator.matchesPlayed,
    wins: accumulator.wins,
    losses: accumulator.losses,
    winRate:
      accumulator.matchesPlayed === 0
        ? 0
        : Number((accumulator.wins / accumulator.matchesPlayed).toFixed(6)),
    points: accumulator.points,
    scoreFor: accumulator.scoreFor,
    scoreAgainst: accumulator.scoreAgainst,
    scoreDifference: accumulator.scoreFor - accumulator.scoreAgainst,
    sessionsPlayed: accumulator.sessionIds.size,
  };
}

function getPerspective(playerProfileId: string, match: PersonalMatchInput): PerspectiveMatch | null {
  const onTeamA = match.teamAProfileIds.includes(playerProfileId);
  const onTeamB = match.teamBProfileIds.includes(playerProfileId);
  if (onTeamA === onTeamB) return null;

  const playerWon = (onTeamA && match.winnerTeam === "A") || (onTeamB && match.winnerTeam === "B");
  const ownTeam = onTeamA ? match.teamAProfileIds : match.teamBProfileIds;
  const opposingTeam = onTeamA ? match.teamBProfileIds : match.teamAProfileIds;

  return {
    ...match,
    result: playerWon ? "win" : "loss",
    scoreForPlayer: onTeamA ? match.scoreA : match.scoreB,
    scoreAgainstPlayer: onTeamA ? match.scoreB : match.scoreA,
    teammateProfileIds: ownTeam.filter((id) => id !== playerProfileId),
    opponentProfileIds: opposingTeam,
  };
}

function addRelationship(
  map: Map<string, RelationshipAccumulator>,
  playerProfileId: string,
  result: "win" | "loss",
) {
  const item = map.get(playerProfileId) ?? {
    playerProfileId,
    encounters: 0,
    wins: 0,
    losses: 0,
  };
  item.encounters += 1;
  item.wins += result === "win" ? 1 : 0;
  item.losses += result === "loss" ? 1 : 0;
  map.set(playerProfileId, item);
}

function relationshipRows(
  map: Map<string, RelationshipAccumulator>,
  profileNames: Record<string, string>,
) {
  return [...map.values()]
    .map((item) => ({
      ...item,
      displayName: profileNames[item.playerProfileId] ?? "Unknown player",
      winRate: Number((item.wins / item.encounters).toFixed(6)),
    }))
    .sort(
      (left, right) =>
        right.encounters - left.encounters ||
        right.wins - left.wins ||
        left.displayName.localeCompare(right.displayName, "vi"),
    );
}

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function summarizePersonalMatches(
  playerProfileId: string,
  matches: PersonalMatchInput[],
  profileNames: Record<string, string>,
  historyLimit = 30,
) {
  const perspectiveMatches = matches
    .map((match) => getPerspective(playerProfileId, match))
    .filter((match): match is PerspectiveMatch => Boolean(match))
    .sort(
      (left, right) =>
        left.scheduledFor.getTime() - right.scheduledFor.getTime() ||
        left.roundNumber - right.roundNumber,
    );
  const overall = createAccumulator();
  const byFormat = new Map<"singles" | "doubles", AggregateAccumulator>([
    ["singles", createAccumulator()],
    ["doubles", createAccumulator()],
  ]);
  const byGroup = new Map<string, AggregateAccumulator>();
  const bySeason = new Map<string, AggregateAccumulator>();
  const byMonth = new Map<string, AggregateAccumulator>();
  const teammates = new Map<string, RelationshipAccumulator>();
  const opponents = new Map<string, RelationshipAccumulator>();
  let currentWinStreak = 0;
  let bestWinStreak = 0;

  for (const match of perspectiveMatches) {
    addMatch(overall, match);
    addMatch(byFormat.get(match.mode)!, match);

    const groupAccumulator = byGroup.get(match.groupId) ?? createAccumulator();
    addMatch(groupAccumulator, match);
    byGroup.set(match.groupId, groupAccumulator);

    const seasonAccumulator = bySeason.get(match.seasonId) ?? createAccumulator();
    addMatch(seasonAccumulator, match);
    bySeason.set(match.seasonId, seasonAccumulator);

    const key = monthKey(match.scheduledFor);
    const monthAccumulator = byMonth.get(key) ?? createAccumulator();
    addMatch(monthAccumulator, match);
    byMonth.set(key, monthAccumulator);

    for (const teammateId of match.teammateProfileIds) {
      addRelationship(teammates, teammateId, match.result);
    }
    for (const opponentId of match.opponentProfileIds) {
      addRelationship(opponents, opponentId, match.result);
    }

    currentWinStreak = match.result === "win" ? currentWinStreak + 1 : 0;
    bestWinStreak = Math.max(bestWinStreak, currentWinStreak);
  }

  const groupMetadata = new Map(matches.map((match) => [match.groupId, match]));
  const seasonMetadata = new Map(matches.map((match) => [match.seasonId, match]));
  const history = [...perspectiveMatches]
    .reverse()
    .slice(0, historyLimit)
    .map((match) => ({
      id: match.id,
      groupId: match.groupId,
      groupName: match.groupName,
      seasonId: match.seasonId,
      seasonName: match.seasonName,
      sessionId: match.sessionId,
      sessionTitle: match.sessionTitle,
      scheduledFor: match.scheduledFor,
      roundNumber: match.roundNumber,
      mode: match.mode,
      result: match.result,
      scoreFor: match.scoreForPlayer,
      scoreAgainst: match.scoreAgainstPlayer,
      teammateProfileIds: match.teammateProfileIds,
      teammateNames: match.teammateProfileIds.map((id) => profileNames[id] ?? "Unknown player"),
      opponentProfileIds: match.opponentProfileIds,
      opponentNames: match.opponentProfileIds.map((id) => profileNames[id] ?? "Unknown player"),
    }));

  return {
    overall: {
      ...finalizeAccumulator(overall),
      currentWinStreak,
      bestWinStreak,
    },
    formats: {
      singles: finalizeAccumulator(byFormat.get("singles")!),
      doubles: finalizeAccumulator(byFormat.get("doubles")!),
    },
    groups: [...byGroup.entries()]
      .map(([groupId, accumulator]) => ({
        groupId,
        groupName: groupMetadata.get(groupId)?.groupName ?? "Unknown group",
        ...finalizeAccumulator(accumulator),
      }))
      .sort((left, right) => right.matchesPlayed - left.matchesPlayed || left.groupName.localeCompare(right.groupName, "vi")),
    seasons: [...bySeason.entries()]
      .map(([seasonId, accumulator]) => {
        const metadata = seasonMetadata.get(seasonId);
        return {
          seasonId,
          seasonName: metadata?.seasonName ?? "Unknown season",
          seasonStatus: metadata?.seasonStatus ?? "completed",
          groupId: metadata?.groupId ?? "",
          groupName: metadata?.groupName ?? "Unknown group",
          mode: metadata?.mode ?? "doubles",
          ...finalizeAccumulator(accumulator),
        };
      })
      .sort((left, right) => right.matchesPlayed - left.matchesPlayed || left.seasonName.localeCompare(right.seasonName, "vi")),
    trend: [...byMonth.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([period, accumulator]) => ({ period, ...finalizeAccumulator(accumulator) })),
    frequentTeammates: relationshipRows(teammates, profileNames),
    frequentOpponents: relationshipRows(opponents, profileNames),
    historyTotal: perspectiveMatches.length,
    history,
  };
}
