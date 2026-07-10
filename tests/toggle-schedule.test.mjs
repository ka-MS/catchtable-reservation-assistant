import assert from "node:assert/strict";
import test from "node:test";
import { nextTogglePlan } from "../dist/shared/toggle-schedule.js";

test("precision burst is phase-locked to the opening instant", () => {
  const openAt = 10_000;
  const targets = [];
  let now = 9_400;
  for (let index = 0; index < 5; index += 1) {
    const plan = nextTogglePlan(now, openAt, 400);
    targets.push(plan.targetClickAtMs);
    now = plan.targetClickAtMs + 25;
  }
  assert.deepEqual(targets, [9_550, 9_700, 9_850, 10_000, 10_150]);
});

test("toggle cadence relaxes after the precision window", () => {
  const openAt = 10_000;
  assert.equal(nextTogglePlan(12_100, openAt, 150).cycleMs, 250);
  assert.equal(nextTogglePlan(40_100, openAt, 150).cycleMs, 2_000);
});

test("adjacent click is scheduled shortly before the target click", () => {
  const plan = nextTogglePlan(9_900, 10_000, 150);
  assert.equal(plan.targetClickAtMs, 10_000);
  assert.equal(plan.adjacentClickAtMs, 9_960);
});
