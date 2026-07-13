import assert from "node:assert/strict";
import test from "node:test";
import { AvailabilityCorrelationTracker } from "../dist/content/availability-correlation.js";

function event(overrides = {}) {
  return {
    source: "ct-reserve-main",
    type: "AVAILABILITY_SHADOW_EVENT",
    schemaVersion: 2,
    channelId: "channel-1",
    sequence: 7,
    cycle: null,
    targetClickMonoMs: null,
    requestDate: "260801",
    personCount: 2,
    classification: "POPULATED",
    availableMinutes: [1140],
    responseStatus: 200,
    requestSentMonoMs: 120,
    responseCompletedMonoMs: 150,
    bodyReadCompletedMonoMs: 151,
    payloadClassifiedMonoMs: 152,
    bridgeReceivedMonoMs: 155,
    ...overrides,
  };
}

function cycle(cycleNumber, clickAt) {
  return {
    cycle: cycleNumber,
    targetDate: "2026-08-01",
    personCount: 2,
    targetClickMonoMs: clickAt,
    mutationGenerationAtTargetClick: cycleNumber * 10,
  };
}

test("an explicit MAIN marker produces an exact cycle correlation", () => {
  const tracker = new AvailabilityCorrelationTracker();
  tracker.registerCycle(cycle(3, 100));
  const result = tracker.correlateBody(event({ cycle: 3, targetClickMonoMs: 100 }), 1140);
  assert.equal(result.quality, "EXACT");
  assert.equal(result.cycle, 3);
  assert.equal(result.correlationId, "cycle:3:request:7");
});

test("timestamp fallback distinguishes strong, weak, and none without cross-cycle storage", () => {
  const strongTracker = new AvailabilityCorrelationTracker();
  strongTracker.registerCycle(cycle(1, 100));
  assert.equal(strongTracker.correlateBody(event(), 1140).quality, "STRONG");

  const weakTracker = new AvailabilityCorrelationTracker();
  weakTracker.registerCycle(cycle(1, 100));
  weakTracker.registerCycle(cycle(2, 110));
  const weak = weakTracker.correlateBody(event(), 1140);
  assert.equal(weak.quality, "WEAK");
  assert.equal(weak.cycle, null);

  const noneTracker = new AvailabilityCorrelationTracker();
  noneTracker.registerCycle(cycle(1, 1_000));
  assert.equal(noneTracker.correlateBody(event(), 1140).quality, "NONE");
});

test("DOM comparison uses only the same cycle body and exposes bridge/response timing", () => {
  const tracker = new AvailabilityCorrelationTracker();
  tracker.registerCycle(cycle(4, 100));
  tracker.correlateBody(event({ cycle: 4, targetClickMonoMs: 100 }), 1140);
  const result = tracker.correlateDom(4, 1140, 180, { generation: 42, lastMutationMonoMs: 170 });
  assert.equal(result.quality, "EXACT");
  assert.equal(result.correlationId, "cycle:4:request:7");
  assert.equal(result.bridgeToDomMs, 25);
  assert.equal(result.targetResponseToDomMs, 30);
  assert.equal(result.mutationObservedAfterTarget, true);
  assert.equal(tracker.correlateDom(5, 1140, 190, { generation: 43, lastMutationMonoMs: 185 }).quality, "NONE");
});

test("older request sequences cannot replace a cycle's latest body", () => {
  const tracker = new AvailabilityCorrelationTracker();
  tracker.registerCycle(cycle(2, 100));
  tracker.correlateBody(event({ cycle: 2, sequence: 8, targetClickMonoMs: 100 }), 1140);
  const stale = tracker.correlateBody(event({ cycle: 2, sequence: 7, targetClickMonoMs: 100 }), 1140);
  assert.equal(stale.stale, true);
  assert.equal(tracker.correlateDom(2, 1140, 200, { generation: 21, lastMutationMonoMs: 190 }).requestSequence, 8);
});

test("a body arriving after DOM observation still produces a same-cycle comparison", () => {
  const tracker = new AvailabilityCorrelationTracker();
  tracker.registerCycle(cycle(6, 100));
  const earlyDom = tracker.correlateDom(6, 1140, 160, { generation: 61, lastMutationMonoMs: 150 });
  assert.equal(earlyDom.quality, "NONE");

  const body = tracker.correlateBody(event({ cycle: 6, targetClickMonoMs: 100 }), 1140);
  assert.equal(body.lateDomCorrelation?.quality, "EXACT");
  assert.equal(body.lateDomCorrelation?.correlationId, "cycle:6:request:7");
  assert.equal(body.lateDomCorrelation?.agreement, true);
  assert.equal(body.lateDomCorrelation?.bridgeToDomMs, 5);
});
