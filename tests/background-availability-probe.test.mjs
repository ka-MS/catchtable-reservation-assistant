import assert from "node:assert/strict";
import test from "node:test";
import { ensureAvailabilityProbe } from "../dist/background/availability-probe.js";

test("disabled availability diagnostics do not install the MAIN-world wrapper", async () => {
  let calls = 0;
  const installed = await ensureAvailabilityProbe(7, false, {
    executeScript: async () => { calls += 1; },
  });

  assert.equal(installed, false);
  assert.equal(calls, 0);
});

test("enabled availability diagnostics install the expected MAIN-world bundle", async () => {
  let injection;
  const installed = await ensureAvailabilityProbe(7, true, {
    executeScript: async (value) => { injection = value; },
  });

  assert.equal(installed, true);
  assert.deepEqual(injection, {
    target: { tabId: 7 },
    world: "MAIN",
    files: ["main-world/availability-probe.js"],
  });
});

test("probe installation failure preserves the DOM fallback", async () => {
  const installed = await ensureAvailabilityProbe(7, true, {
    executeScript: async () => { throw new Error("blocked"); },
  });

  assert.equal(installed, false);
});
