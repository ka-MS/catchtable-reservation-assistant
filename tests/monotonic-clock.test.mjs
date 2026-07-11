import assert from "node:assert/strict";
import test from "node:test";
import { MonotonicEpochClock } from "../dist/shared/monotonic-clock.js";

test("monotonic epoch clock advances from its anchor and ignores wall-clock changes", () => {
  let monotonicNow = 100;
  const clock = new MonotonicEpochClock({ now: () => monotonicNow });

  clock.anchor(1_000);
  monotonicNow = 175;
  assert.equal(clock.now(), 1_075);
});

test("reanchoring atomically replaces the server epoch basis", () => {
  let monotonicNow = 200;
  const clock = new MonotonicEpochClock({ now: () => monotonicNow });

  clock.anchor(2_000);
  monotonicNow = 250;
  clock.anchor(3_000);
  monotonicNow = 280;
  assert.equal(clock.now(), 3_030);
});
