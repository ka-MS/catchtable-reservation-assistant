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
    postSlotEnabled: true,
    tablePreference: "any",
    menuKeyword: "",
    stopAtMs: 3_000,
    pagePrepared: true,
    dryRun: true,
    preOpenLeadMs: 300,
    toggleIntervalMs: 400,
    clockSampleCount: 3,
    ...overrides,
  };
}

function harness({
  slotAfterCycles = 1,
  clickResult = true,
  postSlot = { inspect: () => ({ kind: "form" }), advance: () => ({ status: "blocked", message: "unused" }) },
} = {}) {
  let now = 0;
  let cycles = 0;
  let slotClicks = 0;
  const dateClicks = [];
  const dateClickTimes = [];
  const events = [];
  const calendar = {
    inspect: () => ({ targetAvailable: true, targetSelected: true, adjacentDate: "2026-07-29" }),
    clickDate: (date) => {
      dateClicks.push(date);
      dateClickTimes.push({ date, at: now });
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
    syncClock: async () => ({
      offsetMs: 0,
      sampleCount: 3,
      spreadMs: 2,
      fallback: false,
      method: "boundary",
      precisionMs: 20,
    }),
    calendar,
    slots,
    postSlot,
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
    dateClickTimes,
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
  assert.equal(h.dateClickTimes.filter((click) => click.date === "2026-07-30").at(-1)?.at, 1_000);
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

test("actual mode clicks one slot and hands off at the reservation form", async () => {
  const h = harness();
  const result = await h.orchestrator.start(config({ dryRun: false }));
  assert.equal(result.state, "HANDED_OFF");
  assert.equal(h.slotClicks, 1);
  assert.equal(h.events.some((event) => event.data?.state === "SLOT_SELECTED"), true);
  assert.equal(h.events.some((event) => event.data?.state === "ADVANCING_RESERVATION"), true);
  assert.equal(h.events.at(-1)?.data?.state, "HANDED_OFF");
});

test("disabled post-slot automation stops immediately after the slot click", async () => {
  let inspections = 0;
  const h = harness({
    postSlot: {
      inspect: () => {
        inspections += 1;
        return { kind: "table_type", options: ["홀"] };
      },
      advance: () => ({ status: "acted", message: "unexpected" }),
    },
  });

  const result = await h.orchestrator.start(config({ dryRun: false, postSlotEnabled: false }));

  assert.equal(result.state, "HANDED_OFF");
  assert.equal(h.slotClicks, 1);
  assert.equal(inspections, 0);
  assert.equal(h.events.some((event) => event.data?.state === "ADVANCING_RESERVATION"), false);
  assert.match(h.events.at(-1)?.message ?? "", /슬롯 선택까지만/);
});

test("optional post-slot stages are advanced in observed order", async () => {
  const stages = [
    { kind: "table_type", options: ["홀", "바"] },
    { kind: "menu", options: ["디너 오마카세"] },
    { kind: "deposit" },
    { kind: "form" },
  ];
  const actions = [];
  let index = 0;
  const h = harness({
    postSlot: {
      inspect: () => stages[index],
      advance: (stage) => {
        actions.push(stage.kind);
        index += 1;
        return { status: "acted", message: `${stage.kind} 처리` };
      },
    },
  });

  const result = await h.orchestrator.start(config({ dryRun: false }));

  assert.equal(result.state, "HANDED_OFF");
  assert.deepEqual(actions, ["table_type", "menu", "deposit"]);
  assert.match(h.events.at(-1)?.message ?? "", /예약 폼/);
});

test("long waits resynchronize the server clock shortly before opening", async () => {
  let now = 0;
  let syncCalls = 0;
  let targetClicks = 0;
  const orchestrator = new OpenRunOrchestrator({
    clock: { now: () => now },
    syncClock: async () => {
      syncCalls += 1;
      return {
        offsetMs: syncCalls === 1 ? 25 : 40,
        sampleCount: 9,
        spreadMs: 10,
        fallback: false,
        method: "boundary",
        precisionMs: 15,
      };
    },
    calendar: {
      inspect: () => ({ targetAvailable: true, targetSelected: true, adjacentDate: "2026-07-29" }),
      clickDate: (date) => {
        if (date === "2026-07-30") targetClicks += 1;
        return true;
      },
    },
    slots: {
      readAvailableSlots: () => targetClicks > 0 ? [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }] : [],
      clickSlot: () => true,
    },
    postSlot: { inspect: () => ({ kind: "form" }), advance: () => ({ status: "blocked", message: "unused" }) },
    sleep: async (ms) => {
      now += ms;
      return true;
    },
    emit: () => undefined,
    runId: () => "run-final-sync",
  });

  const result = await orchestrator.start(config({
    openAtMs: 10_000,
    stopAtMs: 12_000,
    dryRun: true,
  }));

  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.equal(syncCalls, 2);
});

test("monitoring terminates at stop time without slot clicks", async () => {
  const h = harness({ slotAfterCycles: Number.POSITIVE_INFINITY });
  const result = await h.orchestrator.start(config({ stopAtMs: 1_500 }));
  assert.equal(result.state, "TIMED_OUT");
  assert.equal(h.slotClicks, 0);
  assert.ok(h.now >= 1_500);
});

test("deadline wins over a slot that appears during target-date settling", async () => {
  let now = 0;
  let targetClicked = false;
  let reads = 0;
  let clicks = 0;
  const orchestrator = new OpenRunOrchestrator({
    clock: { now: () => now },
    syncClock: async () => ({
      offsetMs: 0,
      sampleCount: 3,
      spreadMs: 1,
      fallback: false,
      method: "boundary",
      precisionMs: 20,
    }),
    calendar: {
      inspect: () => ({ targetAvailable: true, targetSelected: true, adjacentDate: "2026-07-29" }),
      clickDate: (date) => {
        if (date === "2026-07-30") targetClicked = true;
        return true;
      },
    },
    slots: {
      readAvailableSlots: () => {
        reads += 1;
        return [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }];
      },
      clickSlot: () => {
        clicks += 1;
        return true;
      },
    },
    postSlot: { inspect: () => ({ kind: "form" }), advance: () => ({ status: "blocked", message: "unused" }) },
    sleep: async (ms) => {
      now = targetClicked ? 1_001 : now + ms;
      return true;
    },
    emit: () => undefined,
    runId: () => "run-deadline",
  });
  const result = await orchestrator.start(config({ stopAtMs: 1_001 }));
  assert.equal(result.state, "TIMED_OUT");
  assert.equal(reads, 0);
  assert.equal(clicks, 0);
});

test("missing adjacent date hands control to the user", async () => {
  const h = harness();
  h.orchestrator = new OpenRunOrchestrator({
    clock: { now: () => 0 },
    syncClock: async () => ({
      offsetMs: 0,
      sampleCount: 3,
      spreadMs: 1,
      fallback: false,
      method: "boundary",
      precisionMs: 20,
    }),
    calendar: { inspect: () => ({ targetAvailable: true, targetSelected: true, adjacentDate: null }), clickDate: () => false },
    slots: { readAvailableSlots: () => [], clickSlot: () => false },
    postSlot: { inspect: () => ({ kind: "form" }), advance: () => ({ status: "blocked", message: "unused" }) },
    sleep: async () => true,
    emit: () => undefined,
    runId: () => "run-2",
  });
  const result = await h.orchestrator.start(config());
  assert.equal(result.state, "HANDED_OFF");
});
