import assert from "node:assert/strict";
import test from "node:test";

import {
  summarizePersonalMatches,
  type PersonalMatchInput,
} from "./personalStatistics.service";

const matches: PersonalMatchInput[] = [
  {
    id: "m1",
    groupId: "g1",
    groupName: "Diamond Club",
    seasonId: "s1",
    seasonName: "Summer",
    seasonStatus: "active",
    mode: "doubles",
    sessionId: "session1",
    sessionTitle: "Round one",
    scheduledFor: new Date("2026-07-10T10:00:00.000Z"),
    roundNumber: 1,
    teamAProfileIds: ["player", "teammate"],
    teamBProfileIds: ["opponent1", "opponent2"],
    scoreA: 21,
    scoreB: 18,
    winnerTeam: "A",
  },
  {
    id: "m2",
    groupId: "g1",
    groupName: "Diamond Club",
    seasonId: "s1",
    seasonName: "Summer",
    seasonStatus: "active",
    mode: "doubles",
    sessionId: "session1",
    sessionTitle: "Round one",
    scheduledFor: new Date("2026-07-10T10:00:00.000Z"),
    roundNumber: 2,
    teamAProfileIds: ["opponent1", "opponent3"],
    teamBProfileIds: ["player", "teammate"],
    scoreA: 21,
    scoreB: 19,
    winnerTeam: "A",
  },
  {
    id: "m3",
    groupId: "g2",
    groupName: "Singles Club",
    seasonId: "s2",
    seasonName: "Autumn",
    seasonStatus: "completed",
    mode: "singles",
    sessionId: "session2",
    sessionTitle: "Singles night",
    scheduledFor: new Date("2026-08-12T10:00:00.000Z"),
    roundNumber: 1,
    teamAProfileIds: ["player"],
    teamBProfileIds: ["opponent1"],
    scoreA: 21,
    scoreB: 10,
    winnerTeam: "A",
  },
];

const names = {
  player: "Player",
  teammate: "Teammate",
  opponent1: "Opponent One",
  opponent2: "Opponent Two",
  opponent3: "Opponent Three",
};

test("summarizes personal results across formats and groups", () => {
  const result = summarizePersonalMatches("player", matches, names);

  assert.deepEqual(result.overall, {
    matchesPlayed: 3,
    wins: 2,
    losses: 1,
    winRate: 0.666667,
    points: 2,
    scoreFor: 61,
    scoreAgainst: 49,
    scoreDifference: 12,
    sessionsPlayed: 2,
    currentWinStreak: 1,
    bestWinStreak: 1,
  });
  assert.equal(result.formats.doubles.matchesPlayed, 2);
  assert.equal(result.formats.singles.wins, 1);
  assert.equal(result.groups.length, 2);
  assert.equal(result.trend.length, 2);
});

test("builds perspective-aware history and relationship leaders", () => {
  const result = summarizePersonalMatches("player", matches, names, 2);

  assert.equal(result.historyTotal, 3);
  assert.equal(result.history.length, 2);
  assert.equal(result.history[0]?.id, "m3");
  assert.equal(result.history[1]?.scoreFor, 19);
  assert.equal(result.frequentTeammates[0]?.displayName, "Teammate");
  assert.equal(result.frequentTeammates[0]?.encounters, 2);
  assert.equal(result.frequentOpponents[0]?.displayName, "Opponent One");
  assert.equal(result.frequentOpponents[0]?.encounters, 3);
});

test("ignores matches that do not contain the selected player", () => {
  const result = summarizePersonalMatches("missing", matches, names);
  assert.equal(result.overall.matchesPlayed, 0);
  assert.equal(result.historyTotal, 0);
});
