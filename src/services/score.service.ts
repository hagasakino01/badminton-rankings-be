export type ValidatedScore = {
  scoreA: number;
  scoreB: number;
  winnerTeam: "A" | "B";
};

export function validateBadmintonScore(scoreA: number, scoreB: number): ValidatedScore {
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
    throw new Error("Scores must be non-negative integers");
  }

  if (scoreA === scoreB) {
    throw new Error("A badminton match cannot end in a draw");
  }

  const winnerScore = Math.max(scoreA, scoreB);
  const loserScore = Math.min(scoreA, scoreB);

  if (winnerScore < 21 || winnerScore > 30 || loserScore > 29) {
    throw new Error("The winning score must be between 21 and 30");
  }

  if (winnerScore < 30 && winnerScore - loserScore < 2) {
    throw new Error("The winner must lead by two points before 30");
  }

  return {
    scoreA,
    scoreB,
    winnerTeam: scoreA > scoreB ? "A" : "B",
  };
}
