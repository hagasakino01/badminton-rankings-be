import assert from "node:assert/strict";
import test from "node:test";

import { generateFairSchedule, validateManualSchedule } from "./schedule.service";

for (const mode of ["singles", "doubles"] as const) {
  for (const participantCount of [5, 6, 7, 8, 12, 20]) {
    test(`${mode} schedule gives ${participantCount} players exactly four matches`, () => {
      const ids = Array.from(
        { length: participantCount },
        (_, index) => `player-${index + 1}`,
      );
      const schedule = generateFairSchedule(mode, ids, `${mode}-${participantCount}`);

      assert.equal(
        schedule.matches.length,
        mode === "singles" ? participantCount * 2 : participantCount,
      );
      assert.deepEqual(Object.values(schedule.playerLoad), Array(participantCount).fill(4));
      schedule.matches.forEach((match, index) => {
        assert.equal(match.roundNumber, index + 1);
        assert.equal(match.courtNumber, 1);
        assert.equal(match.teamAProfileIds.length, mode === "singles" ? 1 : 2);
        assert.equal(match.teamBProfileIds.length, mode === "singles" ? 1 : 2);
        assert.equal(
          new Set([...match.teamAProfileIds, ...match.teamBProfileIds]).size,
          mode === "singles" ? 2 : 4,
        );
      });
      assert.equal(
        validateManualSchedule(mode, ids, schedule.matches),
        null,
      );
    });
  }
}

test("automatic scheduling is deterministic for a fixed seed", () => {
  const ids = Array.from({ length: 8 }, (_, index) => `player-${index + 1}`);
  assert.deepEqual(
    generateFairSchedule("doubles", ids, "stable-seed"),
    generateFairSchedule("doubles", ids, "stable-seed"),
  );
});

test("manual schedules reject an incomplete player load", () => {
  const ids = ["a", "b", "c", "d", "e"];
  assert.match(
    validateManualSchedule("doubles", ids, [
      { teamAProfileIds: ["a", "b"], teamBProfileIds: ["c", "d"] },
    ]) ?? "",
    /exactly 5 matches/,
  );
});
