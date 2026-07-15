import assert from "node:assert/strict";
import test from "node:test";
import { OpenRunOrchestrator } from "../dist/content/orchestrator.js";

// Tier 1 fake for Dependencies.referenceClock. Defaults to a zero-uncertainty,
// zero-RTT HIGH-confidence estimate so armLeadMs collapses to config.preOpenLeadMs
// exactly (see 20-design.md §4) — this is what keeps pre-existing toggle-grid
// timing assertions passing unmodified.
function fakeReferenceClock({ estimate = {}, bootstrapFails = false } = {}) {
  const build = (overrides) => ({
    offsetLowerMs: 0, offsetCenterMs: 0, offsetUpperMs: 0,
    uncertaintyMs: 0, confidence: "HIGH",
    dominantClusterSupport: 1, competingClusterSupport: 0, clusterSeparationMs: -1,
    medianRttMs: 0, p95RttMs: 0, sampleCount: 1, observationSpanMs: 0,
    source: "APP_HEAD_HTTP_DATE", updatedAtMonoMs: 0,
    ...overrides,
  });
  let latest = bootstrapFails ? null : build(estimate);
  let onEstimate = null;
  const calls = { started: 0, stopped: 0 };
  const port = {
    get latest() { return latest; },
    sampleOnce: async () => (bootstrapFails ? null : { t0: 0, t1: 0, serverDateMs: 0, rttMs: 0, lowerMs: 0, upperMs: 0, fromCache: false }),
    ingest: () => { latest = build(estimate); return latest; },
    start: (cb) => { calls.started += 1; onEstimate = cb; return new Promise(() => {}); },
    stop: () => { calls.stopped += 1; },
  };
  return {
    port,
    calls,
    fire: (overrides) => { latest = build(overrides); onEstimate?.(latest); },
  };
}

function config(overrides = {}) {
  return {
    targetUrl: "https://app.catchtable.co.kr/ct/shop/kea",
    openAtMs: 1_000,
    reservationDate: "2026-07-30",
    personCount: 2,
    timeRange: { startMinutes: 1080, endMinutes: 1200 },
    priorityTimes: [1140],
    postSlotEnabled: true,
    paymentMethodAutoAdvance: true,
    tablePreference: "any",
    menuKeyword: "",
    stopAtMs: 3_000,
    entryMode: "prepared",
    dryRun: true,
    preOpenLeadMs: 300,
    toggleIntervalMs: 400,
    ...overrides,
  };
}

function fakeAvailabilityShadow() {
  let listener = null;
  let marker = null;
  const calls = { started: 0, marked: 0, stopped: 0 };
  return {
    calls,
    get marked() { return marker !== null; },
    port: {
      start: (_expiresAt, nextListener) => {
        calls.started += 1;
        listener = nextListener;
      },
      markTargetCycle: (nextMarker) => {
        calls.marked += 1;
        marker = nextMarker;
      },
      stop: () => { calls.stopped += 1; },
    },
    emit(overrides = {}) {
      assert.ok(listener, "shadow listener must be started");
      assert.ok(marker, "target cycle must be marked");
      const atMonoMs = overrides.atMonoMs ?? marker.targetClickMonoMs;
      listener({
        source: "ct-reserve-main",
        type: "AVAILABILITY_SHADOW_EVENT",
        schemaVersion: 2,
        channelId: "channel-wake",
        sequence: 1,
        cycle: marker.cycle,
        targetClickMonoMs: marker.targetClickMonoMs,
        requestDate: "260730",
        personCount: 2,
        classification: "POPULATED",
        availableMinutes: [1140],
        responseStatus: 200,
        requestSentMonoMs: marker.targetClickMonoMs,
        responseCompletedMonoMs: atMonoMs,
        bodyReadCompletedMonoMs: atMonoMs,
        payloadClassifiedMonoMs: atMonoMs,
        bridgeReceivedMonoMs: atMonoMs,
        ...overrides,
      });
    },
  };
}

function harness({
  slotAfterCycles = 1,
  clickResult = true,
  entry = { inspect: () => ({ reservationOpen: true, ctaAvailable: true, waitingOnly: false }), openReservation: () => true },
  person = { inspect: () => ({ ready: true, targetAvailable: true, targetSelected: true }), select: () => true },
  prepareTarget = () => ({ status: "ready", message: "목표 날짜가 준비됐습니다." }),
  postSlot = { inspect: () => ({ kind: "form" }), advance: () => ({ status: "blocked", message: "unused" }) },
  onCalendarInspect = () => undefined,
  referenceEstimate = {},
  bootstrapFails = false,
  readSlots = null,
  availabilityShadow = null,
  slotDomMutationWatch = null,
  targetSelectionDelayMs = 0,
  onTrace = null,
  diagnostics = null,
  captureSnapshot = () => ({
    urlKind: "shop", headings: [], buttons: ["확인"], disabledButtons: [false],
    disabledButtonCount: 0, dialogLabel: "", dialogTitle: "", textSnippet: "", fingerprint: "ss-test",
  }),
} = {}) {
  let now = 0;
  let monotonicNow = 0;
  let cycles = 0;
  let slotClicks = 0;
  const dateClicks = [];
  const dateClickTimes = [];
  const events = [];
  const traces = [];
  const calendar = {
    inspect: () => {
      const selectedOverride = onCalendarInspect({ now, monotonicNow, cycles });
      const lastTargetClick = dateClickTimes.findLast((entry) => entry.date === "2026-07-30");
      return {
        targetAvailable: true,
        targetSelected: typeof selectedOverride === "boolean"
          ? selectedOverride
          : lastTargetClick === undefined || now >= lastTargetClick.at + targetSelectionDelayMs,
        adjacentDate: "2026-07-29",
      };
    },
    prepareTarget,
    clickDate: (date) => {
      dateClicks.push(date);
      dateClickTimes.push({ date, at: now, monotonicAt: monotonicNow });
      if (date === "2026-07-30") cycles += 1;
      return true;
    },
  };
  let arrivalCallback = null;
  const slotWatchCalls = { started: 0, stopped: 0 };
  const slotWatch = {
    start: (cb) => { slotWatchCalls.started += 1; arrivalCallback = cb; },
    stop: () => { slotWatchCalls.stopped += 1; },
  };
  const slotCtx = {
    get now() { return now; },
    get cycles() { return cycles; },
    scans: 0,
    fireArrival: () => arrivalCallback?.(),
  };
  const slots = {
    readAvailableSlots: () => {
      slotCtx.scans += 1;
      if (readSlots) return readSlots(slotCtx);
      return cycles >= slotAfterCycles ? [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }] : [];
    },
    clickSlot: () => {
      slotClicks += 1;
      return clickResult;
    },
  };
  const reference = fakeReferenceClock({ estimate: referenceEstimate, bootstrapFails });
  const orchestrator = new OpenRunOrchestrator({
    clock: { now: () => now },
    monotonicClock: { now: () => monotonicNow },
    referenceClock: () => reference.port,
    calendar,
    entry,
    person,
    slots,
    postSlot,
    slotWatch,
    ...(slotDomMutationWatch ? { slotDomMutationWatch } : {}),
    ...(availabilityShadow ? { availabilityShadow } : {}),
    sleep: async (ms, signal) => {
      if (signal.aborted) return false;
      now += ms;
      monotonicNow += ms;
      return true;
    },
    emit: (event) => events.push(event),
    trace: (code, severity, message, options) => {
      traces.push({ code, severity, message, options });
      onTrace?.(code, severity, message, options);
    },
    flushTrace: async () => undefined,
    captureSnapshot,
    ...(diagnostics ? { diagnostics } : {}),
    runId: () => "run-1",
  });
  return {
    orchestrator,
    dateClicks,
    dateClickTimes,
    events,
    traces,
    slotWatchCalls,
    fireArrival: () => arrivalCallback?.(),
    referenceClockCalls: reference.calls,
    fireReferenceEstimate: reference.fire,
    get slotClicks() { return slotClicks; },
    get now() { return now; },
    jumpWall(ms) { now += ms; },
  };
}

test("clock metrics transition from bootstrap to armed and forward the offset via the legacy field", async () => {
  const h = harness({ referenceEstimate: { offsetCenterMs: 42 } });
  await h.orchestrator.start(config());
  const metrics = h.events.filter((event) => typeof event.data?.clockPhase === "string");
  assert.deepEqual(metrics.map((m) => m.data.clockPhase), ["bootstrap", "armed"]);
  for (const metric of metrics) {
    // clockOffsetMs is the legacy field name the sidepanel countdown/badge and
    // event-format log line still read. It is the WALL-clock delta
    // (serverClock − Date.now()), not the epoch-scale offsetCenterMs. In this
    // fake wall == monotonic so both happen to equal 42.
    assert.equal(metric.data.clockOffsetMs, 42);
    assert.equal(metric.data.clockOffsetCenterMs, 42);
  }
});

test("availability shadow records body/DOM agreement without changing the slot control result", async () => {
  const calls = { started: 0, marked: 0, stopped: 0 };
  let listener = null;
  const availabilityShadow = {
    start: (_expiresAt, nextListener) => {
      calls.started += 1;
      listener = nextListener;
    },
    markTargetCycle: (marker) => {
      calls.marked += 1;
      listener({
        source: "ct-reserve-main",
        type: "AVAILABILITY_SHADOW_EVENT",
        schemaVersion: 2,
        channelId: "channel-1",
        sequence: 2,
        cycle: marker.cycle,
        targetClickMonoMs: marker.targetClickMonoMs,
        requestDate: "260730",
        personCount: 2,
        classification: "POPULATED",
        availableMinutes: [1140],
        responseStatus: 200,
        requestSentMonoMs: marker.targetClickMonoMs + 10,
        responseCompletedMonoMs: marker.targetClickMonoMs + 20,
        bodyReadCompletedMonoMs: marker.targetClickMonoMs + 21,
        payloadClassifiedMonoMs: marker.targetClickMonoMs + 22,
        bridgeReceivedMonoMs: marker.targetClickMonoMs + 23,
      });
    },
    stop: () => { calls.stopped += 1; },
  };
  const observed = harness({ availabilityShadow });
  const baseline = harness();

  const [observedResult, baselineResult] = await Promise.all([
    observed.orchestrator.start(config({ dryRun: false })),
    baseline.orchestrator.start(config({ dryRun: false })),
  ]);

  assert.equal(observedResult.state, baselineResult.state);
  assert.equal(observed.slotClicks, baseline.slotClicks);
  assert.equal(calls.started, 1);
  assert.equal(calls.marked, 1);
  assert.equal(calls.stopped, 1);
  const shadow = observed.traces.filter((trace) => trace.code === "AVAILABILITY_SHADOW");
  assert.deepEqual(shadow.map((trace) => trace.options.attributes.phase), ["body", "dom_compare"]);
  assert.equal(shadow[1].options.attributes.agreement, true);
  assert.equal(shadow[1].options.attributes.correlationQuality, "EXACT");
  assert.equal(shadow[1].options.attributes.correlationId, "cycle:1:request:2");
  assert.equal(typeof shadow[1].options.attributes.bridgeToDomMs, "number");
  assert.equal(shadow[1].options.attributes.claimSource, "body");
});

test("an EXACT matching body wakes an immediate same-cycle DOM rescan", async () => {
  const shadow = fakeAvailabilityShadow();
  let emittedAt = null;
  const h = harness({
    availabilityShadow: shadow.port,
    readSlots: (ctx) => {
      if (emittedAt === null) {
        emittedAt = ctx.now;
        shadow.emit({ atMonoMs: ctx.now });
        return [];
      }
      return [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }];
    },
  });

  const result = await h.orchestrator.start(config());
  const wake = h.traces.find((trace) => trace.options.attributes.phase === "wake_result");
  const detected = h.events.find((event) => event.data?.state === "SLOT_DETECTED");

  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.equal(wake?.options.attributes.correlationQuality, "EXACT");
  assert.equal(wake?.options.attributes.wakeCandidateFound, true);
  assert.equal(wake?.options.attributes.wakeToDomMs, 0);
  assert.equal(detected?.data?.timingServerAtMs, emittedAt);
});

test("a wake that skips an in-flight sleep records the skipped baseline scan as wakeAdvanceMs", async () => {
  const shadow = fakeAvailabilityShadow();
  let emittedAt = null;
  const h = harness({
    availabilityShadow: shadow.port,
    readSlots: (ctx) => {
      if (emittedAt === null) {
        emittedAt = ctx.now;
        shadow.emit({ atMonoMs: ctx.now });
        return [];
      }
      return [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }];
    },
  });

  const result = await h.orchestrator.start(config());
  const wake = h.traces.find((trace) => trace.options.attributes.phase === "wake_result");

  assert.equal(result.state, "DRY_RUN_COMPLETED");
  // 첫 scan 도중 body가 도착해 pending으로 저장되고, 25ms sleep 대신 wait가
  // 즉시 해제된다. baseline(= sleep 만료 시각)과의 차이가 계측된 전진분이다.
  assert.equal(wake?.options.attributes.wakeAdvanceMs, 25);
  assert.equal(
    wake?.options.attributes.baselineNextScanAtMonoMs - wake?.options.attributes.wakeScanAtMonoMs,
    25,
  );
});

test("a wake consumed before the first scan records wakeAdvanceMs of zero", async () => {
  const shadow = fakeAvailabilityShadow();
  let emitted = false;
  const h = harness({
    availabilityShadow: shadow.port,
    onCalendarInspect: () => {
      if (shadow.marked && !emitted) {
        emitted = true;
        shadow.emit();
      }
    },
  });

  const result = await h.orchestrator.start(config());
  const wake = h.traces.find((trace) => trace.options.attributes.phase === "wake_result");

  assert.equal(result.state, "DRY_RUN_COMPLETED");
  // 목표 날짜 선택 확인 중 body가 도착하면 loop 시작 전에 소비된다. 첫 scan은
  // wake와 무관하게 즉시 실행되므로 전진분은 0이어야 한다.
  assert.equal(wake?.options.attributes.wakeCandidateFound, true);
  assert.equal(wake?.options.attributes.wakeAdvanceMs, 0);
  assert.equal(
    wake?.options.attributes.baselineNextScanAtMonoMs,
    wake?.options.attributes.wakeScanAtMonoMs,
  );
});

test("a unique STRONG body can wake the current cycle without an explicit marker", async () => {
  const shadow = fakeAvailabilityShadow();
  let emitted = false;
  const h = harness({
    availabilityShadow: shadow.port,
    readSlots: (ctx) => {
      if (!emitted) {
        emitted = true;
        shadow.emit({ atMonoMs: ctx.now, cycle: null, targetClickMonoMs: null });
        return [];
      }
      return [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }];
    },
  });

  const result = await h.orchestrator.start(config());
  const wake = h.traces.find((trace) => trace.options.attributes.phase === "wake_result");

  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.equal(wake?.options.attributes.correlationQuality, "STRONG");
  assert.equal(wake?.options.attributes.wakeCandidateFound, true);
});

test("a date-mismatched body is discarded and leaves the 25ms fallback cadence intact", async () => {
  const shadow = fakeAvailabilityShadow();
  let emittedAt = null;
  const h = harness({
    availabilityShadow: shadow.port,
    readSlots: (ctx) => {
      if (emittedAt === null) {
        emittedAt = ctx.now;
        shadow.emit({ atMonoMs: ctx.now, requestDate: "260731" });
        return [];
      }
      return [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }];
    },
  });

  const result = await h.orchestrator.start(config());
  const body = h.traces.find((trace) => trace.options.attributes.phase === "body");
  const detected = h.events.find((event) => event.data?.state === "SLOT_DETECTED");

  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.equal(body?.options.attributes.wakeAccepted, false);
  assert.equal(body?.options.attributes.wakeDiscardReason, "untrusted_quality");
  assert.equal(detected?.data?.timingServerAtMs - emittedAt, 25);
});

test("a person-mismatched body is discarded and leaves the 25ms fallback cadence intact", async () => {
  const shadow = fakeAvailabilityShadow();
  let emittedAt = null;
  const h = harness({
    availabilityShadow: shadow.port,
    readSlots: (ctx) => {
      if (emittedAt === null) {
        emittedAt = ctx.now;
        shadow.emit({ atMonoMs: ctx.now, personCount: 3 });
        return [];
      }
      return [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }];
    },
  });

  const result = await h.orchestrator.start(config());
  const body = h.traces.find((trace) => trace.options.attributes.phase === "body");
  const detected = h.events.find((event) => event.data?.state === "SLOT_DETECTED");

  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.equal(body?.options.attributes.wakeAccepted, false);
  assert.equal(body?.options.attributes.wakeDiscardReason, "untrusted_quality");
  assert.equal(detected?.data?.timingServerAtMs - emittedAt, 25);
});

test("a trusted wake without a DOM candidate falls back and continues the next toggle", async () => {
  const shadow = fakeAvailabilityShadow();
  let emitted = false;
  const h = harness({
    availabilityShadow: shadow.port,
    readSlots: (ctx) => {
      if (!emitted) {
        emitted = true;
        shadow.emit({ atMonoMs: ctx.now });
      }
      return ctx.cycles >= 2
        ? [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }]
        : [];
    },
  });

  const result = await h.orchestrator.start(config());
  const wake = h.traces.find((trace) => trace.options.attributes.phase === "wake_result");
  const cycles = h.traces.filter((trace) => trace.code === "DATE_TOGGLE_CYCLE");

  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.equal(wake?.options.attributes.wakeCandidateFound, false);
  assert.equal(wake?.options.attributes.wakeFallbackUsed, true);
  assert.deepEqual(cycles.map((trace) => trace.options.attributes.result), ["NO_SLOT", "SLOT_FOUND"]);
});

test("an EXACT EMPTY ends the active cycle before the existing detection deadline", async () => {
  const shadow = fakeAvailabilityShadow();
  let emitted = false;
  const h = harness({
    availabilityShadow: shadow.port,
    readSlots: (ctx) => {
      if (!emitted) {
        emitted = true;
        shadow.emit({
          atMonoMs: ctx.now,
          classification: "EMPTY",
          availableMinutes: [],
        });
      }
      return ctx.cycles >= 2
        ? [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }]
        : [];
    },
  });

  const result = await h.orchestrator.start(config({ availabilityProbeMode: "empty_exit" }));
  const cycles = h.traces.filter((trace) => trace.code === "DATE_TOGGLE_CYCLE");
  const body = h.traces.find((trace) => trace.options.attributes.phase === "body");
  const earlyExit = h.traces.find((trace) => trace.options.attributes.phase === "empty_early_exit");

  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.deepEqual(cycles.map((trace) => trace.options.attributes.result), ["EMPTY_EARLY_EXIT", "SLOT_FOUND"]);
  assert.equal(body?.options.attributes.signalKind, "empty_exit");
  assert.equal(earlyExit?.options.attributes.emptyEarlyExitApplied, true);
  assert.equal(earlyExit?.options.attributes.targetStillSelected, true);
  assert.equal(earlyExit?.options.attributes.finalDomCandidateFound, false);
  assert.ok(h.dateClickTimes.filter((entry) => entry.date === "2026-07-30")[1].at <= 1_400);
});

test("a DOM candidate from the same scan wins over a pending EXACT EMPTY", async () => {
  const shadow = fakeAvailabilityShadow();
  let emitted = false;
  const h = harness({
    availabilityShadow: shadow.port,
    readSlots: (ctx) => {
      if (!emitted) {
        emitted = true;
        shadow.emit({
          atMonoMs: ctx.now,
          classification: "EMPTY",
          availableMinutes: [],
        });
      }
      return [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }];
    },
  });

  const result = await h.orchestrator.start(config({ availabilityProbeMode: "empty_exit" }));
  const cycles = h.traces.filter((trace) => trace.code === "DATE_TOGGLE_CYCLE");

  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.deepEqual(cycles.map((trace) => trace.options.attributes.result), ["SLOT_FOUND"]);
  assert.equal(h.traces.some((trace) => trace.options.attributes.phase === "empty_early_exit"), false);
});

test("a DOM candidate rendered during the EMPTY selection guard wins before cycle exit", async () => {
  const shadow = fakeAvailabilityShadow();
  let emitted = false;
  const h = harness({
    availabilityShadow: shadow.port,
    onCalendarInspect: (ctx) => {
      if (shadow.marked && !emitted) {
        emitted = true;
        shadow.emit({
          atMonoMs: ctx.monotonicNow,
          classification: "EMPTY",
          availableMinutes: [],
        });
      }
    },
    readSlots: (ctx) => {
      return ctx.scans >= 2
        ? [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }]
        : [];
    },
  });

  const result = await h.orchestrator.start(config({ availabilityProbeMode: "empty_exit" }));
  const cycles = h.traces.filter((trace) => trace.code === "DATE_TOGGLE_CYCLE");
  const earlyExit = h.traces.find((trace) => trace.options.attributes.phase === "empty_early_exit");

  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.deepEqual(cycles.map((trace) => trace.options.attributes.result), ["SLOT_FOUND"]);
  assert.equal(earlyExit?.options.attributes.finalDomCandidateFound, true);
  assert.equal(earlyExit?.options.attributes.emptyEarlyExitApplied, false);
});

test("EXACT EMPTY keeps the fallback when the target date is no longer selected", async () => {
  const shadow = fakeAvailabilityShadow();
  let emitted = false;
  const h = harness({
    availabilityShadow: shadow.port,
    onCalendarInspect: () => (emitted ? false : undefined),
    readSlots: (ctx) => {
      if (!emitted) {
        emitted = true;
        shadow.emit({
          atMonoMs: ctx.now,
          classification: "EMPTY",
          availableMinutes: [],
        });
      }
      return [];
    },
  });

  const result = await h.orchestrator.start(config({ availabilityProbeMode: "empty_exit" }));
  const earlyExit = h.traces.find((trace) => trace.options.attributes.phase === "empty_early_exit");

  assert.equal(result.state, "HANDED_OFF");
  assert.equal(earlyExit?.options.attributes.emptyEarlyExitApplied, false);
  assert.equal(earlyExit?.options.attributes.targetStillSelected, false);
  assert.equal(h.traces.some((trace) => trace.options.attributes.result === "EMPTY_EARLY_EXIT"), false);
});

test("observe mode EMPTY preserves the existing NO_SLOT cycle", async () => {
  const shadow = fakeAvailabilityShadow();
  let emitted = false;
  const h = harness({
    availabilityShadow: shadow.port,
    readSlots: (ctx) => {
      if (!emitted) {
        emitted = true;
        shadow.emit({
          atMonoMs: ctx.now,
          classification: "EMPTY",
          availableMinutes: [],
        });
      }
      return ctx.cycles >= 2
        ? [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }]
        : [];
    },
  });

  const result = await h.orchestrator.start(config({ availabilityProbeMode: "observe" }));
  const cycles = h.traces.filter((trace) => trace.code === "DATE_TOGGLE_CYCLE");
  const body = h.traces.find((trace) => trace.options.attributes.phase === "body");

  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.deepEqual(cycles.map((trace) => trace.options.attributes.result), ["NO_SLOT", "SLOT_FOUND"]);
  assert.equal(body?.options.attributes.wakeAccepted, false);
  assert.equal(body?.options.attributes.wakeDiscardReason, "no_matching_slot");
});

test("a trusted body preserves its bounded render window before the next toggle", async () => {
  const shadow = fakeAvailabilityShadow();
  let bodyAt = null;
  const h = harness({
    availabilityShadow: shadow.port,
    readSlots: (ctx) => {
      if (bodyAt === null) {
        bodyAt = ctx.now;
        shadow.emit({ atMonoMs: ctx.now });
        return [];
      }
      return ctx.now >= bodyAt + 150
        ? [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }]
        : [];
    },
  });

  const result = await h.orchestrator.start(config());
  const cycles = h.traces.filter((trace) => trace.code === "DATE_TOGGLE_CYCLE");
  const targetClicks = h.dateClicks.filter((date) => date === "2026-07-30");

  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.deepEqual(cycles.map((trace) => trace.options.attributes.result), ["SLOT_FOUND"]);
  assert.equal(targetClicks.length, 1);
});

test("a malformed body event cannot change the bounded DOM fallback result", async () => {
  const shadow = fakeAvailabilityShadow();
  let emittedAt = null;
  const h = harness({
    availabilityShadow: shadow.port,
    readSlots: (ctx) => {
      if (emittedAt === null) {
        emittedAt = ctx.now;
        shadow.emit({ atMonoMs: ctx.now, availableMinutes: null });
        return [];
      }
      return [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }];
    },
  });

  const result = await h.orchestrator.start(config());
  const detected = h.events.find((event) => event.data?.state === "SLOT_DETECTED");

  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.equal(detected?.data?.timingServerAtMs - emittedAt, 25);
  assert.equal(h.traces.some((trace) => trace.options.attributes.phase === "wake_result"), false);
});

test("a failing availability shadow port cannot change the fallback result", async () => {
  const failingShadow = {
    start: () => { throw new Error("probe start failed"); },
    markTargetCycle: () => { throw new Error("marker failed"); },
    stop: () => { throw new Error("probe stop failed"); },
  };
  const observed = harness({ availabilityShadow: failingShadow, slotAfterCycles: 2 });
  const baseline = harness({ slotAfterCycles: 2 });

  const [observedResult, baselineResult] = await Promise.all([
    observed.orchestrator.start(config()),
    baseline.orchestrator.start(config()),
  ]);

  assert.equal(observedResult.state, baselineResult.state);
  assert.deepEqual(observed.dateClicks, baseline.dateClicks);
  assert.equal(observed.slotClicks, baseline.slotClicks);
});

test("a failing wake-result trace cannot change the reservation result", async () => {
  const observedShadow = fakeAvailabilityShadow();
  const baselineShadow = fakeAvailabilityShadow();
  const readSlots = (shadow) => {
    let emitted = false;
    return (ctx) => {
      if (!emitted) {
        emitted = true;
        shadow.emit({ atMonoMs: ctx.now });
        return [];
      }
      return [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }];
    };
  };
  const observed = harness({
    availabilityShadow: observedShadow.port,
    readSlots: readSlots(observedShadow),
    onTrace: (_code, _severity, _message, options) => {
      if (options.attributes.phase === "wake_result") throw new Error("trace exporter failed");
    },
  });
  const baseline = harness({
    availabilityShadow: baselineShadow.port,
    readSlots: readSlots(baselineShadow),
  });

  const [observedResult, baselineResult] = await Promise.all([
    observed.orchestrator.start(config({ dryRun: false })),
    baseline.orchestrator.start(config({ dryRun: false })),
  ]);

  assert.equal(observedResult.state, baselineResult.state);
  assert.deepEqual(observed.dateClicks, baseline.dateClicks);
  assert.equal(observed.slotClicks, baseline.slotClicks);
});

test("an already-selected target date keeps the 20ms stale-DOM settling guard", async () => {
  const h = harness({ slotAfterCycles: 1 });
  const result = await h.orchestrator.start(config());
  const target = h.dateClickTimes.find((entry) => entry.date === "2026-07-30");
  const detected = h.events.find((event) => event.data?.state === "SLOT_DETECTED");

  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.equal(detected?.data?.timingServerAtMs, target.at + 20);
});

test("target selection still polls within the existing 60ms bound", async () => {
  const h = harness({ slotAfterCycles: 1, targetSelectionDelayMs: 50 });
  const result = await h.orchestrator.start(config());
  const cycle = h.traces.find((trace) => trace.code === "DATE_TOGGLE_CYCLE");

  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.equal(cycle?.options.attributes.targetSelectedAt - cycle?.options.attributes.targetClickedAt, 50);
});

test("a failing DOM mutation observer cannot change the reservation result", async () => {
  const failingWatch = {
    start: () => { throw new Error("observer start failed"); },
    snapshot: () => { throw new Error("observer snapshot failed"); },
    stop: () => { throw new Error("observer stop failed"); },
  };
  const observed = harness({ slotDomMutationWatch: failingWatch });
  const baseline = harness();
  const [observedResult, baselineResult] = await Promise.all([
    observed.orchestrator.start(config({ dryRun: false })),
    baseline.orchestrator.start(config({ dryRun: false })),
  ]);
  assert.equal(observedResult.state, baselineResult.state);
  assert.equal(observed.slotClicks, baseline.slotClicks);
});

test("clockOffsetMs is the small wall-clock delta, not the epoch-scale monotonic offset", async () => {
  // Regression for a real bug caught in E2E: the sidepanel countdown does
  // `Date.now() + clockOffsetMs`, so clockOffsetMs must be server−wall (a few
  // hundred ms), NOT offsetCenterMs (= server−monotonic, an epoch-scale number).
  // The bug showed "오픈 경과 +20647일" because Date.now() + 1.78e12 overflowed
  // the countdown. Here wall and monotonic diverge like the real extension
  // (Date.now() ≈ 1.78e12, performance.now() small).
  let mono = 50;
  const WALL_MINUS_MONO = 1_000_000 - 50; // wall = mono + this
  const rc = fakeReferenceClock({ estimate: { offsetCenterMs: 1_000_300 - 50 } }); // server epoch 1_000_300
  const events = [];
  const orchestrator = new OpenRunOrchestrator({
    clock: { now: () => mono + WALL_MINUS_MONO },
    monotonicClock: { now: () => mono },
    referenceClock: () => rc.port,
    calendar: {
      inspect: () => ({ targetAvailable: true, targetSelected: true, adjacentDate: "2026-07-29" }),
      clickDate: () => true,
    },
    slots: { readAvailableSlots: () => [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }], clickSlot: () => true },
    postSlot: { inspect: () => ({ kind: "form" }), advance: () => ({ status: "blocked", message: "x" }) },
    sleep: async (ms) => { mono += ms; return true; },
    emit: (event) => events.push(event),
    runId: () => "run-diverge",
  });
  await orchestrator.start(config({ openAtMs: 1_000_500, stopAtMs: 1_002_000, dryRun: true }));
  const bootstrap = events.find((e) => e.data?.clockPhase === "bootstrap");
  assert.equal(bootstrap.data.clockOffsetMs, 300);          // server(1_000_300) − wall(1_000_000)
  assert.equal(bootstrap.data.clockOffsetCenterMs, 1_000_250); // server − monotonic (epoch-scale)
});

test("clock metrics forward uncertainty, confidence, and cluster support", async () => {
  const h = harness({
    referenceEstimate: {
      uncertaintyMs: 780, confidence: "LOW",
      dominantClusterSupport: 3, competingClusterSupport: 2, clusterSeparationMs: 1000,
      medianRttMs: 95, p95RttMs: 175, sampleCount: 5, observationSpanMs: 6200,
    },
  });
  await h.orchestrator.start(config());
  const metric = h.events.find((event) => typeof event.data?.clockPhase === "string");
  assert.equal(metric.data.clockUncertaintyMs, 780);
  assert.equal(metric.data.clockConfidence, "LOW");
  assert.equal(metric.data.clockDominantSupport, 3);
  assert.equal(metric.data.clockCompetingSupport, 2);
  assert.equal(metric.data.clockClusterSeparationMs, 1000);
  assert.equal(metric.data.clockMedianRttMs, 95);
  assert.equal(metric.data.clockP95RttMs, 175);
  assert.equal(metric.data.clockSampleCount, 5);
  assert.equal(metric.data.clockObservationSpanMs, 6200);
  assert.equal(metric.data.clockSource, "APP_HEAD_HTTP_DATE");
});

test("a failed bootstrap sample falls back honestly instead of pretending a clock reading exists", async () => {
  const h = harness({ bootstrapFails: true });
  await h.orchestrator.start(config());
  const metric = h.events.find((event) => typeof event.data?.clockPhase === "string");
  assert.equal(metric.data.clockPhase, "bootstrap");
  assert.equal(metric.data.clockSource, "FALLBACK");
  assert.match(metric.message, /측정 실패/);
});

test("a failed bootstrap's honest uncertainty pushes armLead to the safety ceiling instead of a bare preOpenLeadMs", async () => {
  // Regression for a real bug found in review: FALLBACK previously reported
  // uncertaintyMs: 0 despite confidence "LOW", so armLead silently ignored
  // "we know nothing" and used preOpenLeadMs as if the clock were trusted.
  const h = harness({ bootstrapFails: true });
  await h.orchestrator.start(config({ preOpenLeadMs: 300 }));
  const armed = h.events.find((event) => event.data?.clockPhase === "armed");
  assert.equal(armed.data.clockArmLeadMs, 30_000);
});

test("the armed metric carries the computed armLead", async () => {
  const h = harness({ referenceEstimate: { uncertaintyMs: 200, p95RttMs: 50 } });
  await h.orchestrator.start(config({ preOpenLeadMs: 300 }));
  const armed = h.events.find((event) => event.data?.clockPhase === "armed");
  assert.equal(armed.data.clockArmLeadMs, 300 + 200 + 50);
});

test("slot watch is started once per run and stopped when the run finishes", async () => {
  const h = harness({ slotAfterCycles: 1 });
  await h.orchestrator.start(config());
  assert.equal(h.slotWatchCalls.started, 1);
  assert.equal(h.slotWatchCalls.stopped, 1);
});

test("an arrival during detection extends the scan burst and records xhr metrics", async () => {
  let arrivalAt = null;
  const h = harness({
    readSlots: (ctx) => {
      if (ctx.scans === 1) { ctx.fireArrival(); arrivalAt = ctx.now; return []; }
      if (arrivalAt !== null && ctx.now >= arrivalAt + 50) {
        return [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }];
      }
      return [];
    },
  });
  const result = await h.orchestrator.start(config());
  assert.equal(result.state, "DRY_RUN_COMPLETED");
  const detected = h.events.find((event) => event.data?.state === "SLOT_DETECTED");
  assert.equal(detected?.data?.xhrArrivalServerAtMs, arrivalAt);
  assert.ok(detected?.data?.arrivalToDetectMs >= 50, `arrivalToDetectMs=${detected?.data?.arrivalToDetectMs}`);
});

test("slot detection and click dispatch carry the monotonic run-elapsed frame, independent of wall-clock jumps", async () => {
  let jumped = false;
  const h = harness({
    slotAfterCycles: 2,
    onCalendarInspect: () => {
      if (jumped) return;
      jumped = true;
      h.jumpWall(5_000); // wall clock jumps; monotonic must not
    },
  });
  const result = await h.orchestrator.start(config({ dryRun: false }));
  assert.equal(result.state, "HANDED_OFF");
  const detected = h.events.find((event) => event.data?.state === "SLOT_DETECTED");
  const dispatched = h.events.find((event) => event.data?.state === "SLOT_CLICK_DISPATCHED");
  assert.equal(typeof detected?.data?.monoFromRunStartMs, "number");
  assert.equal(typeof dispatched?.data?.monoFromRunStartMs, "number");
  // Both frames advance by real (monotonic) elapsed time only — the 5s wall jump
  // must not appear here (it does appear in openDeltaMs, a separate frame).
  assert.ok(detected.data.monoFromRunStartMs < 2_000, `monoFromRunStartMs=${detected.data.monoFromRunStartMs}`);
});

test("slot detection and click dispatch carry the reference-clock estimate active at that moment", async () => {
  // The armed metric freezes the estimate at WAITING_FOR_OPEN entry (often only
  // 1 sample). On a long wait the rolling sampler keeps improving it, so the
  // detection events must carry the estimate that was actually active at
  // detection (confidence + uncertainty + wall offset), not the stale armed one.
  const h = harness({ slotAfterCycles: 1, referenceEstimate: { confidence: "MEDIUM", uncertaintyMs: 140, offsetCenterMs: 55 } });
  const result = await h.orchestrator.start(config({ dryRun: false }));
  assert.equal(result.state, "HANDED_OFF");
  const detected = h.events.find((event) => event.data?.state === "SLOT_DETECTED");
  const dispatched = h.events.find((event) => event.data?.state === "SLOT_CLICK_DISPATCHED");
  assert.equal(detected?.data?.clockConfidence, "MEDIUM");
  assert.equal(dispatched?.data?.clockConfidence, "MEDIUM");
  assert.equal(detected?.data?.clockUncertaintyMs, 140);
  assert.equal(dispatched?.data?.clockUncertaintyMs, 140);
  // clockOffsetMs at detection is the small wall delta (server − wall), 55 in
  // this fake where wall == monotonic — NOT the epoch-scale offsetCenterMs.
  assert.equal(detected?.data?.clockOffsetMs, 55);
});

test("the click carries its own arrival-to-click latency, distinct from arrival-to-detect", async () => {
  let arrivalAt = null;
  const h = harness({
    readSlots: (ctx) => {
      if (ctx.scans === 1) { ctx.fireArrival(); arrivalAt = ctx.now; return []; }
      if (arrivalAt !== null && ctx.now >= arrivalAt + 50) {
        return [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }];
      }
      return [];
    },
  });
  const result = await h.orchestrator.start(config({ dryRun: false }));
  assert.equal(result.state, "HANDED_OFF");
  const detected = h.events.find((event) => event.data?.state === "SLOT_DETECTED");
  const dispatched = h.events.find((event) => event.data?.state === "SLOT_CLICK_DISPATCHED");
  assert.ok(dispatched?.data?.arrivalToClickMs >= detected?.data?.arrivalToDetectMs,
    `arrivalToClickMs=${dispatched?.data?.arrivalToClickMs} arrivalToDetectMs=${detected?.data?.arrivalToDetectMs}`);
});

test("a live watch quiesces the next toggle until the timeout when no arrival comes", async () => {
  // 사이클1 스캔 중 도착 신호 1회(watch live 전환) 후 침묵 → 사이클2는
  // 그리드가 아니라 목표클릭+700ms까지 기다렸다가 다음 토글로 넘어가야 한다.
  const h = harness({
    readSlots: (ctx) => {
      if (ctx.scans === 1) ctx.fireArrival();
      return ctx.cycles >= 3 ? [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }] : [];
    },
  });
  const result = await h.orchestrator.start(config());
  assert.equal(result.state, "DRY_RUN_COMPLETED");
  const targets = h.dateClickTimes.filter((c) => c.date === "2026-07-30");
  const adjacents = h.dateClickTimes.filter((c) => c.date === "2026-07-29");
  assert.ok(adjacents.length >= 3 && targets.length >= 2, `clicks: adj=${adjacents.length} tgt=${targets.length}`);
  const gap = adjacents[2].at - targets[1].at;
  assert.ok(gap >= 700, `quiesce gap=${gap}`);
});

test("dry-run detects a prioritized slot without clicking", async () => {
  const h = harness({ slotAfterCycles: 2 });
  const result = await h.orchestrator.start(config());
  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.equal(h.slotClicks, 0);
  assert.deepEqual(h.dateClicks, ["2026-07-29", "2026-07-30", "2026-07-29", "2026-07-30"]);
  assert.equal(h.dateClickTimes.filter((click) => click.date === "2026-07-30").at(-1)?.at, 1_000);
  const detected = h.events.find((event) => event.data?.state === "SLOT_DETECTED");
  assert.equal(detected?.data?.timingStage, "slot_detected");
  assert.equal(detected?.data?.adjacentTimingServerAtMs, 960);
  assert.equal(detected?.data?.adjacentOpenDeltaMs, -40);
  assert.equal(detected?.data?.adjacentScheduleDriftMs, 0);
  assert.equal(detected?.data?.targetTimingServerAtMs, 1_000);
  assert.equal(detected?.data?.targetOpenDeltaMs, 0);
  assert.equal(detected?.data?.targetScheduleDriftMs, 0);
  assert.equal(detected?.data?.timingServerAtMs, 1_020);
  assert.equal(detected?.data?.openDeltaMs, 20);
  assert.deepEqual(h.traces.filter((trace) => trace.code === "DATE_TOGGLE_CYCLE").map((trace) => ({
    cycle: trace.options.attributes.cycle,
    result: trace.options.attributes.result,
  })), [
    { cycle: 1, result: "NO_SLOT" },
    { cycle: 2, result: "SLOT_FOUND" },
  ]);
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

test("wall-clock jumps do not move the server schedule after synchronization", async () => {
  let h;
  let jumped = false;
  h = harness({
    slotAfterCycles: 2,
    onCalendarInspect: () => {
      if (jumped) return;
      jumped = true;
      h.jumpWall(5_000);
    },
  });

  const result = await h.orchestrator.start(config());
  const lastTarget = h.dateClickTimes.filter((click) => click.date === "2026-07-30").at(-1);
  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.equal(lastTarget?.monotonicAt, 1_000);
  assert.equal(lastTarget?.at, 6_000);
});

test("auto entry opens the reservation, prepares date and person, then uses the existing safety check", async () => {
  let reservationOpen = false;
  let datePrepared = false;
  let personSelected = false;
  const actions = [];
  const h = harness({
    entry: {
      inspect: () => ({ reservationOpen, ctaAvailable: true, waitingOnly: false }),
      openReservation: () => {
        reservationOpen = true;
        actions.push("entry");
        return true;
      },
    },
    prepareTarget: () => {
      if (datePrepared) return { status: "ready", message: "목표 날짜가 준비됐습니다." };
      datePrepared = true;
      actions.push("date");
      return { status: "acted", message: "목표 날짜를 선택했습니다." };
    },
    person: {
      inspect: () => ({ ready: true, targetAvailable: true, targetSelected: personSelected }),
      select: () => {
        personSelected = true;
        actions.push("person");
        return true;
      },
    },
  });

  const result = await h.orchestrator.start(config({ entryMode: "auto" }));

  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.deepEqual(actions, ["entry", "date", "person"]);
  assert.deepEqual(h.events.filter((event) => event.kind === "state").map((event) => event.data?.state).slice(0, 8), [
    "CONFIGURED",
    "VALIDATING",
    "SYNCING_CLOCK",
    "ENTERING_RESERVATION",
    "SELECTING_DATE",
    "SELECTING_PERSON",
    "PREPARING_PAGE",
    "WAITING_FOR_OPEN",
  ]);
});

test("auto entry dismisses the promo interstitial and re-clicks the CTA", async () => {
  // Measured 2026-07-12 at ishizue: the promo interstitial swallows the first CTA click,
  // so the calendar only opens after dismissing the promo and clicking the CTA again.
  let reservationOpen = false;
  let promoVisible = false;
  const actions = [];
  const h = harness({
    entry: {
      inspect: () => ({ reservationOpen, ctaAvailable: true, waitingOnly: false }),
      openReservation: () => {
        actions.push("entry");
        if (actions.filter((a) => a === "entry").length === 1) promoVisible = true;
        else reservationOpen = true;
        return true;
      },
      dismissPromo: () => {
        if (!promoVisible) return false;
        promoVisible = false;
        actions.push("promo");
        return true;
      },
    },
  });

  const result = await h.orchestrator.start(config({ entryMode: "auto" }));

  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.deepEqual(actions, ["entry", "promo", "entry"]);
  assert.equal(h.events.some((event) => event.kind === "action" && /홍보 안내/.test(event.message)), true);
});

test("auto entry hands off safely when the restaurant is waiting-only", async () => {
  const h = harness({
    entry: {
      inspect: () => ({ reservationOpen: false, ctaAvailable: false, waitingOnly: true }),
      openReservation: () => false,
    },
  });

  const result = await h.orchestrator.start(config({ entryMode: "auto" }));

  assert.equal(result.state, "HANDED_OFF");
  assert.match(h.events.at(-1)?.message ?? "", /웨이팅/);
});

test("auto entry never substitutes an unavailable person count", async () => {
  let selections = 0;
  const h = harness({
    person: {
      inspect: () => ({ ready: true, targetAvailable: false, targetSelected: false }),
      select: () => {
        selections += 1;
        return true;
      },
    },
  });

  const result = await h.orchestrator.start(config({ entryMode: "auto", personCount: 20 }));

  assert.equal(result.state, "HANDED_OFF");
  assert.equal(selections, 0);
  assert.match(h.events.at(-1)?.message ?? "", /20명/);
});

test("actual mode clicks one slot and hands off at the reservation form", async () => {
  const h = harness();
  const result = await h.orchestrator.start(config({ dryRun: false }));
  assert.equal(result.state, "HANDED_OFF");
  assert.equal(h.slotClicks, 1);
  const dispatched = h.events.find((event) => event.data?.state === "SLOT_CLICK_DISPATCHED");
  assert.equal(typeof dispatched?.data?.openDeltaMs, "number");
  assert.equal(dispatched?.data?.openDeltaMs, dispatched?.serverAt - 1_000);
  assert.equal(dispatched?.data?.timingStage, "slot_click_dispatched");
  assert.equal(dispatched?.data?.timingServerAtMs, dispatched?.serverAt);
  assert.equal(dispatched?.data?.slotTransitionOutcome, "dispatched");
  assert.match(dispatched?.message ?? "", /클릭을 전달/);
  const confirmed = h.events.find((event) => event.data?.state === "SLOT_TRANSITION_CONFIRMED");
  assert.equal(confirmed?.data?.slotTransitionOutcome, "confirmed");
  assert.match(confirmed?.message ?? "", /후속 예약 화면/);
  assert.equal(h.events.some((event) => event.data?.state === "ADVANCING_RESERVATION"), true);
  const handedOff = h.events.at(-1);
  assert.equal(handedOff?.data?.state, "HANDED_OFF");
  assert.match(handedOff?.message ?? "", /예약 폼/);
  assert.equal(typeof handedOff?.data?.openDeltaMs, "number");
  assert.equal(typeof handedOff?.data?.timingServerAtMs, "number");
  assert.equal(handedOff?.data?.openDeltaMs, handedOff?.data?.timingServerAtMs - 1_000);
});

test("disabled post-slot automation confirms the transition without advancing", async () => {
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
  assert.equal(inspections, 1);
  assert.equal(h.events.some((event) => event.data?.state === "SLOT_TRANSITION_CONFIRMED"), true);
  assert.equal(h.events.some((event) => event.data?.state === "ADVANCING_RESERVATION"), false);
  assert.equal(h.events.at(-1)?.data?.slotTransitionOutcome, "confirmed");
  assert.match(h.events.at(-1)?.message ?? "", /후속 자동 진행이 꺼져/);
});

test("optional post-slot stages are advanced in observed order", async () => {
  const stages = [
    { kind: "table_type", options: ["홀", "바"] },
    { kind: "extras" },
    { kind: "menu", options: ["디너 오마카세"] },
    { kind: "seating_menu", options: ["카운터 디너 오마카세"] },
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
  assert.deepEqual(actions, ["table_type", "extras", "menu", "seating_menu", "deposit"]);
  assert.equal(h.events.some((event) => event.data?.postSlotStage === "menu" && "openDeltaMs" in event.data), false);
  assert.match(h.events.at(-1)?.message ?? "", /예약 폼/);
});

test("disabled payment automation advances earlier post-slot stages and hands off at payment", async () => {
  const stages = [
    { kind: "table_type", options: ["홀", "바"] },
    { kind: "deposit" },
  ];
  const actions = [];
  let index = 0;
  const h = harness({
    postSlot: {
      inspect: () => stages[index],
      advance: (stage, runConfig) => {
        actions.push(stage.kind);
        if (stage.kind === "deposit" && runConfig.paymentMethodAutoAdvance === false) {
          return { status: "blocked", message: "결제 방식 선택 화면은 자동 진행하지 않습니다." };
        }
        index += 1;
        return { status: "acted", message: `${stage.kind} 처리` };
      },
    },
  });

  const result = await h.orchestrator.start(config({
    dryRun: false,
    paymentMethodAutoAdvance: false,
  }));

  assert.equal(result.state, "HANDED_OFF");
  assert.deepEqual(actions, ["table_type", "deposit"]);
  assert.match(h.events.at(-1)?.message ?? "", /결제 방식 선택/);
});

test("unknown post-slot screens hand off with safe structural diagnostics", async () => {
  let advances = 0;
  const unknown = {
    kind: "unknown",
    label: "새로운 예약 단계",
    certainty: "unknown",
    strategy: "unknown-dialog-v1",
    evidence: ["unsupported dialog structure"],
    fingerprint: "ps-a1b2c3d4",
    diagnostics: {
      urlKind: "shop",
      label: "새로운 예약 단계",
      title: "고객 요청 확인",
      buttons: ["이전", "계속"],
      disabledButtonCount: 1,
      radioCount: 0,
      checkboxCount: 0,
      quantityControlCount: 0,
      zeroDepositControlCount: 0,
    },
  };
  const h = harness({
    postSlot: {
      inspect: () => unknown,
      advance: () => {
        advances += 1;
        return { status: "acted", message: "unexpected" };
      },
    },
  });

  const result = await h.orchestrator.start(config({ dryRun: false }));
  const handoff = h.events.at(-1);

  assert.equal(result.state, "HANDED_OFF");
  assert.equal(advances, 0);
  assert.equal(handoff?.data?.postSlotCertainty, "unknown");
  assert.equal(handoff?.data?.postSlotStrategy, "unknown-dialog-v1");
  assert.equal(handoff?.data?.postSlotFingerprint, "ps-a1b2c3d4");
  assert.equal(handoff?.data?.dialogTitle, "고객 요청 확인");
  assert.equal(handoff?.data?.dialogButtons, "이전 | 계속");
  assert.equal(handoff?.data?.slotTransitionOutcome, "unknown");
});

test("the post-slot timeout handoff records the last inspection diagnostics", async () => {
  // 화면이 dialog로 인식되지 않으면 waiting만 반복되다 시간초과 인계된다.
  // 그 인계 이벤트에 마지막 관찰 근거(urlKind 포함)가 남아야 원인을 추적할 수 있다.
  const waiting = {
    kind: "waiting",
    certainty: "unknown",
    strategy: "no-active-dialog-v1",
    evidence: ["no active dialog"],
    fingerprint: "ps-00000000",
    diagnostics: {
      urlKind: "other",
      label: "",
      title: "",
      buttons: [],
      disabledButtonCount: 0,
      radioCount: 0,
      checkboxCount: 0,
      quantityControlCount: 0,
      zeroDepositControlCount: 0,
    },
  };
  const h = harness({
    postSlot: {
      inspect: () => waiting,
      advance: () => ({ status: "acted", message: "unused" }),
    },
  });

  const result = await h.orchestrator.start(config({ dryRun: false }));
  const handoff = h.events.at(-1);

  assert.equal(result.state, "HANDED_OFF");
  assert.match(handoff?.message ?? "", /5초/);
  assert.equal(handoff?.data?.postSlotStage, "waiting");
  assert.equal(handoff?.data?.postSlotStrategy, "no-active-dialog-v1");
  assert.equal(handoff?.data?.dialogUrlKind, "other");
  assert.equal(handoff?.data?.slotTransitionOutcome, "timed_out");
});

test("a slot lost before dispatch is recorded as contention and returns to refresh", async () => {
  const h = harness({ clickResult: false, slotAfterCycles: 1 });

  const result = await h.orchestrator.start(config({ dryRun: false, stopAtMs: 1_500 }));

  assert.equal(result.state, "TIMED_OUT");
  const contention = h.events.find((event) => event.data?.slotTransitionOutcome === "contention_before_dispatch");
  assert.equal(contention?.data?.state, "REFRESHING_SLOTS");
  assert.match(contention?.message ?? "", /경합|사라/);
  assert.equal(h.events.some((event) => event.data?.state === "SLOT_CLICK_DISPATCHED"), false);
});

test("a promo notice appearing after form arrival is dismissed before handing off", async () => {
  // The promo dialog renders non-deterministically after the form loads, so the
  // orchestrator dwells on the form briefly instead of handing off on first sight.
  let inspections = 0;
  const actions = [];
  const h = harness({
    postSlot: {
      inspect: () => {
        inspections += 1;
        if (inspections < 10) return { kind: "form" };
        if (inspections === 10) return { kind: "form_notice" };
        return { kind: "form" };
      },
      advance: (stage) => {
        actions.push(stage.kind);
        return { status: "acted", message: "예약 폼 안내 창을 닫았습니다." };
      },
    },
  });

  const result = await h.orchestrator.start(config({ dryRun: false }));

  assert.equal(result.state, "HANDED_OFF");
  assert.deepEqual(actions, ["form_notice"]);
  assert.equal(h.events.some((event) => event.message === "예약 폼 안내 창을 닫았습니다."), true);
  assert.match(h.events.at(-1)?.message ?? "", /예약 폼/);
});

test("late form arrival receives the full promo grace period and keeps its arrival time", async () => {
  let h;
  let formSeenAt;
  let noticeDismissed = false;
  const actions = [];
  h = harness({
    postSlot: {
      inspect: () => {
        if (h.now < 5_600) return { kind: "waiting" };
        formSeenAt ??= h.now;
        if (!noticeDismissed && h.now >= 6_100) return { kind: "form_notice" };
        return { kind: "form" };
      },
      advance: (stage) => {
        actions.push(stage.kind);
        noticeDismissed = true;
        return { status: "acted", message: "예약 폼 안내 창을 닫았습니다." };
      },
    },
  });

  const result = await h.orchestrator.start(config({ dryRun: false }));
  const handoff = h.events.at(-1);

  assert.equal(result.state, "HANDED_OFF");
  assert.deepEqual(actions, ["form_notice"]);
  assert.ok(h.now >= 6_100);
  assert.equal(handoff?.data?.openDeltaMs, formSeenAt - 1_000);
  assert.equal(handoff?.data?.timingServerAtMs, formSeenAt);
});

test("post-slot waiting actions are retried instead of handing off", async () => {
  let advances = 0;
  const h = harness({
    postSlot: {
      inspect: () => advances >= 2 ? { kind: "form" } : { kind: "menu", options: ["디너"] },
      advance: () => {
        advances += 1;
        return advances === 1
          ? { status: "waiting", message: "확인 버튼 활성화 대기" }
          : { status: "acted", message: "메뉴 선택 완료" };
      },
    },
  });

  const result = await h.orchestrator.start(config({ dryRun: false }));

  assert.equal(result.state, "HANDED_OFF");
  assert.equal(advances, 2);
  assert.equal(h.events.some((event) => event.message === "확인 버튼 활성화 대기"), false);
});

test("the reference clock sampler starts once after bootstrap and stops before the toggle loop", async () => {
  const h = harness({ slotAfterCycles: 1 });
  await h.orchestrator.start(config());
  assert.equal(h.referenceClockCalls.started, 1);
  assert.equal(h.referenceClockCalls.stopped, 1);
});

test("a rolling reference-clock update during the wait refreshes the anchor immediately", async () => {
  // Simulates what the persistent sampler does: fire a fresh estimate mid-run
  // (here, from the confirmPageReady calendar check, before WAITING_FOR_OPEN)
  // and confirm the very next emitted event's serverAt reflects the new offset.
  let fired = false;
  const h = harness({
    slotAfterCycles: 1,
    onCalendarInspect: () => {
      if (fired) return;
      fired = true;
      h.fireReferenceEstimate({ offsetCenterMs: 500 });
    },
  });
  const result = await h.orchestrator.start(config());
  assert.equal(result.state, "DRY_RUN_COMPLETED");
  const waiting = h.events.find((event) => event.data?.state === "WAITING_FOR_OPEN");
  assert.ok(waiting);
  assert.equal(waiting.serverAt - waiting.at, 500);
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
    monotonicClock: { now: () => now },
    referenceClock: () => fakeReferenceClock({}).port,
    calendar: {
      inspect: () => ({ targetAvailable: true, targetSelected: !targetClicked, adjacentDate: "2026-07-29" }),
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
    monotonicClock: { now: () => 0 },
    referenceClock: () => fakeReferenceClock({}).port,
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

test("attaches a diagnostic snapshot on a waiting-only hand-off", async () => {
  const h = harness({
    entry: { inspect: () => ({ reservationOpen: false, ctaAvailable: false, waitingOnly: true }), openReservation: () => false },
  });
  const result = await h.orchestrator.start(config({ entryMode: "auto" }));
  assert.equal(result.state, "HANDED_OFF");
  const handoff = h.events.find((e) => e.data?.state === "HANDED_OFF");
  assert.equal(handoff?.data?.snapshotFingerprint, "ss-test");
  assert.equal(handoff?.data?.snapshotRunState, "ENTERING_RESERVATION");
});

test("normal form-arrival hand-off carries no snapshot", async () => {
  const h = harness({ slotAfterCycles: 1, postSlot: { inspect: () => ({ kind: "form" }), advance: () => ({ status: "blocked", message: "unused" }) } });
  const result = await h.orchestrator.start(config({ dryRun: false }));
  assert.equal(result.state, "HANDED_OFF");
  const handoff = h.events.find((e) => e.data?.state === "HANDED_OFF");
  assert.equal(handoff?.data?.snapshotFingerprint, undefined);
  assert.equal(handoff?.data?.postSlotStage, "form");
});

test("a throwing captureSnapshot does not mask the give-up", async () => {
  const h = harness({
    entry: { inspect: () => ({ reservationOpen: false, ctaAvailable: false, waitingOnly: true }), openReservation: () => false },
    captureSnapshot: () => { throw new Error("boom"); },
  });
  const result = await h.orchestrator.start(config({ entryMode: "auto" }));
  assert.equal(result.state, "HANDED_OFF");
  const handoff = h.events.find((e) => e.data?.state === "HANDED_OFF");
  assert.equal(handoff?.data?.snapshotFingerprint, undefined);
  assert.equal(handoff?.data?.snapshotRunState, "ENTERING_RESERVATION");
});

test("diagnostic failures persist breadcrumbs and link the terminal event", async () => {
  const calls = { breadcrumbs: [], failures: [], flushed: 0 };
  const diagnostics = {
    breadcrumb: (...args) => calls.breadcrumbs.push(args),
    failure: (...args) => { calls.failures.push(args); return "ds-final"; },
    forceFlush: async () => { calls.flushed += 1; },
  };
  const h = harness({
    diagnostics,
    entry: { inspect: () => ({ reservationOpen: false, ctaAvailable: false, waitingOnly: true }), openReservation: () => false },
  });
  const result = await h.orchestrator.start(config({ entryMode: "auto" }));
  const handoff = h.events.find((event) => event.data?.state === "HANDED_OFF");

  assert.equal(result.state, "HANDED_OFF");
  assert.ok(calls.breadcrumbs.some(([stage, trigger]) => stage === "ENTERING_RESERVATION" && trigger === "state"));
  assert.equal(calls.failures.length, 1);
  assert.equal(calls.failures[0][0], "ENTERING_RESERVATION");
  assert.equal(handoff?.data?.diagnosticSnapshotId, "ds-final");
  assert.equal(calls.flushed, 1);
});

test("normal form hand-off keeps breadcrumbs in memory and stores no failure snapshot", async () => {
  const calls = { breadcrumbs: [], failures: 0, flushed: 0 };
  const diagnostics = {
    breadcrumb: (stage) => calls.breadcrumbs.push(stage),
    failure: () => { calls.failures += 1; return "unexpected"; },
    forceFlush: async () => { calls.flushed += 1; },
  };
  const h = harness({ diagnostics, slotAfterCycles: 1 });
  const result = await h.orchestrator.start(config({ dryRun: false }));

  assert.equal(result.state, "HANDED_OFF");
  assert.equal(calls.failures, 0);
  assert.equal(calls.flushed, 1);
  assert.ok(calls.breadcrumbs.includes("SLOT_CLICK_DISPATCHED"));
  assert.ok(!calls.breadcrumbs.includes("REFRESHING_SLOTS"));
  assert.ok(!calls.breadcrumbs.includes("SLOT_DETECTED"));
});
