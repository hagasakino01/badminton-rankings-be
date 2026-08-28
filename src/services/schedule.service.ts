import type { CompetitionMode } from "../domain/constants";
import { DEFAULT_MATCHES_PER_PLAYER } from "../domain/constants";

export type MatchPlan = {
  teamAProfileIds: string[];
  teamBProfileIds: string[];
  roundNumber: number;
  courtNumber: 1;
};

export type ScheduleFairness = {
  maxTeammateRepeats: number;
  repeatedTeammatePairs: number;
  maxOpponentRepeats: number;
  consecutiveAppearancePenalty: number;
};

type UnorderedMatch = Omit<MatchPlan, "roundNumber" | "courtNumber">;
type RandomSource = () => number;

function hashSeed(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandomSource(seed: string): RandomSource {
  let state = hashSeed(seed) || 1;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(values: T[], random: RandomSource) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function pairKey(firstId: string, secondId: string) {
  return [firstId, secondId].sort().join(":");
}

function matchPlayers(match: UnorderedMatch) {
  return [...match.teamAProfileIds, ...match.teamBProfileIds];
}

function normalizeParticipants(participantIds: string[]) {
  const uniqueIds = Array.from(new Set(participantIds));
  if (uniqueIds.length !== participantIds.length) {
    throw new Error("Participants must be unique");
  }
  if (uniqueIds.length < 5 || uniqueIds.length > 20) {
    throw new Error("A session requires between 5 and 20 participants");
  }
  return uniqueIds;
}

function buildDoublesPairings(players: string[]): UnorderedMatch[] {
  const [a, b, c, d] = players;
  return [
    { teamAProfileIds: [a, b], teamBProfileIds: [c, d] },
    { teamAProfileIds: [a, c], teamBProfileIds: [b, d] },
    { teamAProfileIds: [a, d], teamBProfileIds: [b, c] },
  ];
}

function pairingPenalty(
  match: UnorderedMatch,
  teammateCounts: Map<string, number>,
  opponentCounts: Map<string, number>,
) {
  const teammateKeys = [
    pairKey(match.teamAProfileIds[0], match.teamAProfileIds[1]),
    pairKey(match.teamBProfileIds[0], match.teamBProfileIds[1]),
  ];
  const opponentKeys = match.teamAProfileIds.flatMap((leftId) =>
    match.teamBProfileIds.map((rightId) => pairKey(leftId, rightId)),
  );

  return (
    teammateKeys.reduce((sum, key) => sum + (teammateCounts.get(key) ?? 0) * 1000, 0) +
    opponentKeys.reduce((sum, key) => sum + (opponentCounts.get(key) ?? 0) * 25, 0)
  );
}

function recordPairs(
  match: UnorderedMatch,
  teammateCounts: Map<string, number>,
  opponentCounts: Map<string, number>,
) {
  for (const key of [
    pairKey(match.teamAProfileIds[0], match.teamAProfileIds[1]),
    pairKey(match.teamBProfileIds[0], match.teamBProfileIds[1]),
  ]) {
    teammateCounts.set(key, (teammateCounts.get(key) ?? 0) + 1);
  }

  for (const leftId of match.teamAProfileIds) {
    for (const rightId of match.teamBProfileIds) {
      const key = pairKey(leftId, rightId);
      opponentCounts.set(key, (opponentCounts.get(key) ?? 0) + 1);
    }
  }
}

function orderForRest(matches: UnorderedMatch[], random: RandomSource) {
  const pending = shuffle(matches, random);
  const ordered: UnorderedMatch[] = [];

  while (pending.length > 0) {
    let bestIndex = 0;
    let bestPenalty = Number.POSITIVE_INFINITY;

    for (const [index, candidate] of pending.entries()) {
      const players = new Set(matchPlayers(candidate));
      const previous = ordered.at(-1);
      const beforePrevious = ordered.at(-2);
      const immediateOverlap = previous
        ? matchPlayers(previous).filter((id) => players.has(id)).length
        : 0;
      const recentOverlap = beforePrevious
        ? matchPlayers(beforePrevious).filter((id) => players.has(id)).length
        : 0;
      const penalty = immediateOverlap * 1000 + recentOverlap * 80 + random();

      if (penalty < bestPenalty) {
        bestPenalty = penalty;
        bestIndex = index;
      }
    }

    ordered.push(pending.splice(bestIndex, 1)[0]);
  }

  return ordered;
}

function evaluateFairness(matches: UnorderedMatch[]): ScheduleFairness & { score: number } {
  const teammateCounts = new Map<string, number>();
  const opponentCounts = new Map<string, number>();

  for (const match of matches) {
    recordPairs(match, teammateCounts, opponentCounts);
  }

  const teammateValues = [...teammateCounts.values()];
  const opponentValues = [...opponentCounts.values()];
  const maxTeammateRepeats = Math.max(0, ...teammateValues);
  const repeatedTeammatePairs = teammateValues.reduce(
    (sum, count) => sum + Math.max(0, count - 1),
    0,
  );
  const maxOpponentRepeats = Math.max(0, ...opponentValues);
  let consecutiveAppearancePenalty = 0;

  for (let index = 1; index < matches.length; index += 1) {
    const previousPlayers = new Set(matchPlayers(matches[index - 1]));
    consecutiveAppearancePenalty += matchPlayers(matches[index]).filter((id) =>
      previousPlayers.has(id),
    ).length;
  }

  return {
    maxTeammateRepeats,
    repeatedTeammatePairs,
    maxOpponentRepeats,
    consecutiveAppearancePenalty,
    score:
      Math.max(0, maxTeammateRepeats - 1) * 10_000_000 +
      repeatedTeammatePairs * 1_000_000 +
      maxOpponentRepeats * 10_000 +
      consecutiveAppearancePenalty,
  };
}

function generateDoublesAttempt(participantIds: string[], random: RandomSource) {
  const players = shuffle(participantIds, random);
  const offsets = shuffle(
    Array.from({ length: players.length - 1 }, (_, index) => index + 1),
    random,
  ).slice(0, 3);
  const groups = players.map((_, startIndex) => [
    players[startIndex],
    ...offsets.map((offset) => players[(startIndex + offset) % players.length]),
  ]);
  const teammateCounts = new Map<string, number>();
  const opponentCounts = new Map<string, number>();
  const matches: UnorderedMatch[] = [];

  for (const group of shuffle(groups, random)) {
    const candidates = shuffle(buildDoublesPairings(group), random);
    candidates.sort(
      (left, right) =>
        pairingPenalty(left, teammateCounts, opponentCounts) -
        pairingPenalty(right, teammateCounts, opponentCounts),
    );
    const chosen = candidates[0];
    matches.push(chosen);
    recordPairs(chosen, teammateCounts, opponentCounts);
  }

  return orderForRest(matches, random);
}

function generateDoublesSchedule(participantIds: string[], seed: string) {
  const random = createRandomSource(seed);
  let bestMatches: UnorderedMatch[] | null = null;
  let bestEvaluation: ReturnType<typeof evaluateFairness> | null = null;

  for (let attempt = 0; attempt < 400; attempt += 1) {
    const matches = generateDoublesAttempt(participantIds, random);
    const evaluation = evaluateFairness(matches);

    if (!bestEvaluation || evaluation.score < bestEvaluation.score) {
      bestMatches = matches;
      bestEvaluation = evaluation;
    }

    if (
      evaluation.maxTeammateRepeats === 1 &&
      evaluation.repeatedTeammatePairs === 0
    ) {
      break;
    }
  }

  if (!bestMatches || !bestEvaluation) {
    throw new Error("Could not generate a fair doubles schedule");
  }

  return { matches: bestMatches, fairness: bestEvaluation };
}

function generateSinglesSchedule(participantIds: string[], seed: string) {
  const random = createRandomSource(seed);
  const players = shuffle(participantIds, random);
  const seen = new Set<string>();
  const matches: UnorderedMatch[] = [];

  for (const offset of [1, 2]) {
    for (let index = 0; index < players.length; index += 1) {
      const opponentIndex = (index + offset) % players.length;
      const key = pairKey(players[index], players[opponentIndex]);
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push({
        teamAProfileIds: [players[index]],
        teamBProfileIds: [players[opponentIndex]],
      });
    }
  }

  const ordered = orderForRest(matches, random);
  return { matches: ordered, fairness: evaluateFairness(ordered) };
}

export function generateFairSchedule(
  mode: CompetitionMode,
  participantIds: string[],
  seed: string,
) {
  const normalizedIds = normalizeParticipants(participantIds);
  const generated =
    mode === "singles"
      ? generateSinglesSchedule(normalizedIds, seed)
      : generateDoublesSchedule(normalizedIds, seed);
  const playerLoad = Object.fromEntries(normalizedIds.map((id) => [id, 0]));

  for (const match of generated.matches) {
    for (const playerId of matchPlayers(match)) {
      playerLoad[playerId] += 1;
    }
  }

  if (Object.values(playerLoad).some((count) => count !== DEFAULT_MATCHES_PER_PLAYER)) {
    throw new Error("The generated schedule is not balanced at four matches per player");
  }

  return {
    matches: generated.matches.map((match, index) => ({
      ...match,
      roundNumber: index + 1,
      courtNumber: 1 as const,
    })),
    playerLoad,
    fairness: {
      maxTeammateRepeats: generated.fairness.maxTeammateRepeats,
      repeatedTeammatePairs: generated.fairness.repeatedTeammatePairs,
      maxOpponentRepeats: generated.fairness.maxOpponentRepeats,
      consecutiveAppearancePenalty: generated.fairness.consecutiveAppearancePenalty,
    },
  };
}

export function validateManualSchedule(
  mode: CompetitionMode,
  participantIds: string[],
  matches: Array<Pick<MatchPlan, "teamAProfileIds" | "teamBProfileIds">>,
) {
  const normalizedIds = normalizeParticipants(participantIds);
  const expectedTeamSize = mode === "singles" ? 1 : 2;
  const expectedMatchCount = mode === "singles" ? normalizedIds.length * 2 : normalizedIds.length;

  if (matches.length !== expectedMatchCount) {
    return `A ${mode} schedule with ${normalizedIds.length} participants requires exactly ${expectedMatchCount} matches`;
  }

  const participantSet = new Set(normalizedIds);
  const playerLoad = Object.fromEntries(normalizedIds.map((id) => [id, 0]));

  for (const [index, match] of matches.entries()) {
    if (
      match.teamAProfileIds.length !== expectedTeamSize ||
      match.teamBProfileIds.length !== expectedTeamSize
    ) {
      return `Match ${index + 1} has an invalid team size`;
    }

    const players = matchPlayers(match);
    if (new Set(players).size !== players.length) {
      return `A player cannot appear twice in match ${index + 1}`;
    }
    if (players.some((playerId) => !participantSet.has(playerId))) {
      return `Match ${index + 1} includes a player outside the selected participants`;
    }

    for (const playerId of players) {
      playerLoad[playerId] += 1;
    }
  }

  if (Object.values(playerLoad).some((count) => count !== DEFAULT_MATCHES_PER_PLAYER)) {
    return "Every participant must appear in exactly 4 matches";
  }

  return null;
}
