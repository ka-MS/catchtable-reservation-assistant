import assert from "node:assert/strict";
import test from "node:test";
import { OpenRunOrchestrator } from "../dist/content/orchestrator.js";

function config(overrides = {}) {
  return {
    targetUrl: "https://app.catchtable.co.kr/ct/shop/kea",
    openAtMs: 1_000,
    reservationDate: "2026-07-30",
    personCount: 2,
    timeRange: { startMinutes: 1080, endMinutes: 1200 },
    priorityTimes: [1140],
    stopAtMs: 3_000,
    pagePrepared: true,
    dryRun: true,
    preOpenLeadMs: 300,
    toggleIntervalMs: 400,
    clockSampleCount: 3,
    ...overrides,
  };
}

function harness({ slotAfterCycles = 1, clickResult = true } = {}) {
  let now = 0;
  let cycles = 0;
  let slotClicks = 0;
  const dateClicks = [];
  const events = [];
  const calendar = {
    inspect: () => ({ targetAvailable: true, targetSelected: true, adjacentDate: "2026-07-29" }),
    clickDate: (date) => {
      dateClicks.push(date);
      if (date === "2026-07-30") cycles += 1;
      return true;
    },
  };
  const slots = {
    readAvailableSlots: () => cycles >= slotAfterCycles ? [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }] : [],
    clickSlot: () => {
      slotClicks += 1;
      return clickResult;
    },
  };
  const orchestrator = new OpenRunOrchestrator({
    clock: { now: () => now },
    syncClock: async () => ({ offsetMs: 0, sampleCount: 3, spreadMs: 2, fallback: false }),
    calendar,
    slots,
    sleep: async (ms, signal) => {
      if (signal.aborted) return false;
      now += ms;
      return true;
    },
    emit: (event) => events.push(event),
    runId: () => "run-1",
  });
  return {
    orchestrator,
    dateClicks,
    events,
    get slotClicks() { return slotClicks; },
    get now() { return now; },
  };
}

test("dry-run detects a prioritized slot without clicking", async () => {
  const h = harness({ slotAfterCycles: 2 });
  const result = await h.orchestrator.start(config());
  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.equal(h.slotClicks, 0);
  assert.deepEqual(h.dateClicks, ["2026-07-29", "2026-07-30", "2026-07-29", "2026-07-30"]);
  assert.deepEqual(h.events.filter((event) => event.kind === "state").map((event) => event.data?.state), [
    "CONFIGURED",
    "VALIDATING",
    "SYNCING_CLOCK",
    "PREPARING_PAGE",
    "WAITING_FOR_OPEN",
    "REFRESHING_SLOTS",
    "SLOT_DETECTED",
    "DRY_RUN_COMPLETED",
  ]);
});

test("actual mode clicks one slot and immediately hands off", async () => {
  const h = harness();
  const result = await h.orchestrator.start(config({ dryRun: false }));
  assert.equal(result.state, "HANDED_OFF");
  assert.equal(h.slotClicks, 1);
  assert.equal(h.events.some((event) => event.data?.state === "SLOT_SELECTED"), true);
  assert.equal(h.events.at(-1)?.data?.state, "HANDED_OFF");
});

test("monitoring terminates at stop time without slot clicks", async () => {
  const h = harness({ slotAfterCycles: Number.POSITIVE_INFINITY });
  const result = await h.orchestrator.start(config({ stopAtMs: 1_500 }));
  assert.equal(result.state, "TIMED_OUT");
  assert.equal(h.slotClicks, 0);
  assert.ok(h.now >= 1_500);
});

test("missing adjacent date hands control to the user", async () => {
  const h = harness();
  h.orchestrator = new OpenRunOrchestrator({
    clock: { now: () => 0 },
    syncClock: async () => ({ offsetMs: 0, sampleCount: 3, spreadMs: 1, fallback: false }),
    calendar: { inspect: () => ({ targetAvailable: true, targetSelected: true, adjacentDate: null }), clickDate: () => false },
    slots: { readAvailableSlots: () => [], clickSlot: () => false },
    sleep: async () => true,
    emit: () => undefined,
    runId: () => "run-2",
  });
  const result = await h.orchestrator.start(config());
  assert.equal(result.state, "HANDED_OFF");
});
