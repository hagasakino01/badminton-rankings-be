import assert from "node:assert/strict";
import test from "node:test";

import { determineNewMemberStatus } from "./groupLifecycle.service";

test("new members are inactive while a season is active", () => {
  assert.equal(determineNewMemberStatus(5, true), "inactive");
  assert.equal(determineNewMemberStatus(19, true), "inactive");
});

test("new members are active before the active-member limit", () => {
  assert.equal(determineNewMemberStatus(1, false), "active");
  assert.equal(determineNewMemberStatus(19, false), "active");
});

test("new members are inactive at the active-member limit", () => {
  assert.equal(determineNewMemberStatus(20, false), "inactive");
});
