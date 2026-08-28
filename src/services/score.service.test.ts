import assert from "node:assert/strict";
import test from "node:test";

import { validateBadmintonScore } from "./score.service";

test("accepts standard, deuce, and capped badminton scores", () => {
  assert.deepEqual(validateBadmintonScore(21, 18), {
    scoreA: 21,
    scoreB: 18,
    winnerTeam: "A",
  });
  assert.equal(validateBadmintonScore(27, 25).winnerTeam, "A");
  assert.equal(validateBadmintonScore(29, 30).winnerTeam, "B");
});

test("rejects draws and scores that do not satisfy win-by-two", () => {
  assert.throws(() => validateBadmintonScore(21, 21), /draw/);
  assert.throws(() => validateBadmintonScore(21, 20), /two points/);
  assert.throws(() => validateBadmintonScore(31, 29), /between 21 and 30/);
});
