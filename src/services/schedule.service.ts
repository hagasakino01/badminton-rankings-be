export type MatchPlan = {
  teamAIds: string[];
  teamBIds: string[];
};

function pairKey(firstId: string, secondId: string) {
  return [firstId, secondId].sort().join(":");
}

function buildPairings(players: string[]): MatchPlan[] {
  const [a, b, c, d] = players;

  return [
    { teamAIds: [a, b], teamBIds: [c, d] },
    { teamAIds: [a, c], teamBIds: [b, d] },
    { teamAIds: [a, d], teamBIds: [b, c] },
  ];
}

function scorePlan(
  plan: MatchPlan,
  appearances: Map<string, number>,
  teammateCounts: Map<string, number>,
  opponentCounts: Map<string, number>,
) {
  const players = [...plan.teamAIds, ...plan.teamBIds];
  const baseLoad = players.reduce((sum, id) => sum + (appearances.get(id) ?? 0), 0);
  const loadSpread = Math.max(...players.map((id) => appearances.get(id) ?? 0))
    - Math.min(...players.map((id) => appearances.get(id) ?? 0));

  const teammatePenalty =
    (teammateCounts.get(pairKey(plan.teamAIds[0], plan.teamAIds[1])) ?? 0)
    + (teammateCounts.get(pairKey(plan.teamBIds[0], plan.teamBIds[1])) ?? 0);

  const opponentPairs = [
    pairKey(plan.teamAIds[0], plan.teamBIds[0]),
    pairKey(plan.teamAIds[0], plan.teamBIds[1]),
    pairKey(plan.teamAIds[1], plan.teamBIds[0]),
    pairKey(plan.teamAIds[1], plan.teamBIds[1]),
  ];

  const opponentPenalty = opponentPairs.reduce(
    (sum, key) => sum + (opponentCounts.get(key) ?? 0),
    0,
  );

  return baseLoad * 10 + loadSpread * 6 + teammatePenalty * 9 + opponentPenalty * 3;
}

export function generateFairSchedule(participantIds: string[]) {
  if (participantIds.length < 4) {
    throw new Error("At least 4 participants are required");
  }

  const uniqueParticipantIds = Array.from(new Set(participantIds));

  if (uniqueParticipantIds.length !== participantIds.length) {
    throw new Error("Participants must be unique");
  }

  const appearances = new Map(uniqueParticipantIds.map((id) => [id, 0]));
  const teammateCounts = new Map<string, number>();
  const opponentCounts = new Map<string, number>();
  const matches: MatchPlan[] = [];
  const totalMatches = uniqueParticipantIds.length;

  for (let round = 0; round < totalMatches; round += 1) {
    const ordered = [...uniqueParticipantIds].sort((leftId, rightId) => {
      const byAppearances = (appearances.get(leftId) ?? 0) - (appearances.get(rightId) ?? 0);
      return byAppearances !== 0 ? byAppearances : leftId.localeCompare(rightId);
    });

    const candidatePool = ordered.slice(0, Math.min(6, ordered.length));
    let bestScore = Number.POSITIVE_INFINITY;
    let bestPlan: MatchPlan | null = null;

    for (let i = 0; i < candidatePool.length - 3; i += 1) {
      for (let j = i + 1; j < candidatePool.length - 2; j += 1) {
        for (let k = j + 1; k < candidatePool.length - 1; k += 1) {
          for (let l = k + 1; l < candidatePool.length; l += 1) {
            const combo = [candidatePool[i], candidatePool[j], candidatePool[k], candidatePool[l]];

            for (const plan of buildPairings(combo)) {
              const score = scorePlan(plan, appearances, teammateCounts, opponentCounts);
              if (score < bestScore) {
                bestScore = score;
                bestPlan = plan;
              }
            }
          }
        }
      }
    }

    if (!bestPlan) {
      throw new Error("Could not generate a fair match plan");
    }

    matches.push(bestPlan);

    for (const id of [...bestPlan.teamAIds, ...bestPlan.teamBIds]) {
      appearances.set(id, (appearances.get(id) ?? 0) + 1);
    }

    const teammateKeys = [
      pairKey(bestPlan.teamAIds[0], bestPlan.teamAIds[1]),
      pairKey(bestPlan.teamBIds[0], bestPlan.teamBIds[1]),
    ];

    for (const key of teammateKeys) {
      teammateCounts.set(key, (teammateCounts.get(key) ?? 0) + 1);
    }

    const opponentKeys = [
      pairKey(bestPlan.teamAIds[0], bestPlan.teamBIds[0]),
      pairKey(bestPlan.teamAIds[0], bestPlan.teamBIds[1]),
      pairKey(bestPlan.teamAIds[1], bestPlan.teamBIds[0]),
      pairKey(bestPlan.teamAIds[1], bestPlan.teamBIds[1]),
    ];

    for (const key of opponentKeys) {
      opponentCounts.set(key, (opponentCounts.get(key) ?? 0) + 1);
    }
  }

  return {
    matches,
    playerLoad: Object.fromEntries(appearances),
  };
}

export function validateManualSchedule(participantIds: string[], matches: MatchPlan[]) {
  if (participantIds.length < 5) {
    return "A manual schedule requires at least 5 participants";
  }

  if (participantIds.length > 12) {
    return "A manual schedule supports at most 12 participants";
  }

  if (matches.length !== participantIds.length) {
    return `A manual schedule with ${participantIds.length} participants must include exactly ${participantIds.length} matches`;
  }

  const participantSet = new Set(participantIds);
  const matchCounts = new Map(participantIds.map((participantId) => [participantId, 0]));

  for (const [index, match] of matches.entries()) {
    if (match.teamAIds.length !== 2 || match.teamBIds.length !== 2) {
      return `Match ${index + 1} must contain exactly 2 players per team`;
    }

    const players = [...match.teamAIds, ...match.teamBIds];

    if (players.some((playerId) => !playerId)) {
      return `Match ${index + 1} must contain exactly 4 players`;
    }

    if (new Set(players).size !== players.length) {
      return `A player cannot appear twice in match ${index + 1}`;
    }

    if (players.some((playerId) => !participantSet.has(playerId))) {
      return `Match ${index + 1} includes a player outside the selected participants`;
    }

    for (const playerId of players) {
      matchCounts.set(playerId, (matchCounts.get(playerId) ?? 0) + 1);
    }
  }

  for (const participantId of participantIds) {
    const matchCount = matchCounts.get(participantId) ?? 0;

    if (matchCount < 4) {
      return "Every participant must appear in exactly 4 matches";
    }

    if (matchCount > 4) {
      return "Participants cannot be scheduled for more than 4 matches";
    }
  }

  return null;
}
