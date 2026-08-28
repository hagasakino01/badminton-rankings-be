import assert from "node:assert/strict";
import test from "node:test";

import { calculateRankingRows } from "./ranking.service";

const participants = ["a", "b", "c", "d"].map((playerProfileId) => ({
  playerProfileId,
  displayName: playerProfileId.toUpperCase(),
}));

test("ranks by points, win rate, and score statistics in the approved order", () => {
  const rows = calculateRankingRows(participants.slice(0, 3), [
    {
      teamAProfileIds: ["a"],
      teamBProfileIds: ["b"],
      scoreA: 21,
      scoreB: 19,
      winnerTeam: "A",
    },
    {
      teamAProfileIds: ["a"],
      teamBProfileIds: ["c"],
      scoreA: 19,
      scoreB: 21,
      winnerTeam: "B",
    },
    {
      teamAProfileIds: ["b"],
      teamBProfileIds: ["c"],
      scoreA: 21,
      scoreB: 10,
      winnerTeam: "A",
    },
  ]);

  assert.deepEqual(
    rows.map((row) => row.playerProfileId),
    ["b", "a", "c"],
  );
  assert.deepEqual(
    rows.map((row) => row.points),
    [1, 1, 1],
  );
});

test("uses head-to-head only when tied players have direct data", () => {
  const rows = calculateRankingRows(participants, [
    {
      teamAProfileIds: ["a"],
      teamBProfileIds: ["b"],
      scoreA: 21,
      scoreB: 19,
      winnerTeam: "A",
    },
    {
      teamAProfileIds: ["a"],
      teamBProfileIds: ["c"],
      scoreA: 19,
      scoreB: 21,
      winnerTeam: "B",
    },
    {
      teamAProfileIds: ["b"],
      teamBProfileIds: ["d"],
      scoreA: 21,
      scoreB: 19,
      winnerTeam: "A",
    },
  ]);
  const playerA = rows.find((row) => row.playerProfileId === "a")!;
  const playerB = rows.find((row) => row.playerProfileId === "b")!;

  assert.equal(playerA.headToHead.applied, true);
  assert.equal(playerB.headToHead.applied, true);
  assert.ok(playerA.rank < playerB.rank);

  const emptyRows = calculateRankingRows(participants.slice(0, 2), []);
  assert.equal(emptyRows[0].headToHead.applied, false);
  assert.equal(emptyRows[1].headToHead.applied, false);
  assert.equal(emptyRows[0].rank, emptyRows[1].rank);
});
