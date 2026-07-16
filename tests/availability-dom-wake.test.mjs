import assert from "node:assert/strict";
import test from "node:test";
import { AvailabilityDomWake } from "../dist/content/availability-dom-wake.js";

function offer(overrides = {}) {
  return {
    cycle: 3,
    requestSequence: 7,
    quality: "EXACT",
    stale: false,
    classification: "POPULATED",
    allowEmptyExit: false,
    selectedMinutes: 1140,
    responseCompletedMonoMs: 1_020,
    payloadClassifiedMonoMs: 1_023,
    bridgeReceivedMonoMs: 1_025,
    wakeAtMonoMs: 1_026,
    ...overrides,
  };
}

test("current-cycle EXACT and STRONG matching bodies become wake signals", () => {
  const wake = new AvailabilityDomWake();
  wake.beginCycle(3);

  const exact = wake.offer(offer());
  assert.equal(exact.accepted, true);
  assert.equal(exact.signal?.kind, "scan_wake");
  assert.equal(exact.signal?.requestSequence, 7);
  assert.equal(wake.consume(3)?.quality, "EXACT");

  const strong = wake.offer(offer({ requestSequence: 8, quality: "STRONG" }));
  assert.equal(strong.accepted, true);
  assert.equal(wake.consume(3)?.quality, "STRONG");
});

test("WEAK and NONE bodies never enter the control wake path", () => {
  const wake = new AvailabilityDomWake();
  wake.beginCycle(3);

  assert.deepEqual(wake.offer(offer({ quality: "WEAK" })), {
    accepted: false,
    discardReason: "untrusted_quality",
    signal: null,
  });
  assert.equal(wake.offer(offer({ quality: "NONE" })).discardReason, "untrusted_quality");
  assert.equal(wake.consume(3), null);
});

test("stale, duplicate, and old-cycle bodies are discarded", () => {
  const wake = new AvailabilityDomWake();
  wake.beginCycle(3);

  assert.equal(wake.offer(offer({ stale: true })).discardReason, "stale_sequence");
  assert.equal(wake.offer(offer({ cycle: 2 })).discardReason, "inactive_cycle");
  assert.equal(wake.offer(offer()).accepted, true);
  assert.equal(wake.offer(offer()).discardReason, "duplicate_sequence");
  assert.equal(wake.offer(offer({ requestSequence: 6 })).discardReason, "duplicate_sequence");
});

test("observe mode EMPTY and missing matching slots use the fallback path", () => {
  const wake = new AvailabilityDomWake();
  wake.beginCycle(3);

  assert.equal(wake.offer(offer({
    classification: "EMPTY",
    selectedMinutes: null,
  })).discardReason, "no_matching_slot");
  assert.equal(wake.offer(offer({
    classification: "POPULATED",
    selectedMinutes: null,
  })).discardReason, "no_matching_slot");
  assert.equal(wake.offer(offer({ wakeAtMonoMs: Number.NaN })).discardReason, "malformed_signal");
  assert.equal(wake.offer(offer({ selectedMinutes: 2_000 })).discardReason, "malformed_signal");
  assert.equal(wake.consume(3), null);
});

test("current-cycle EXACT EMPTY becomes an early-exit signal only when enabled", () => {
  const wake = new AvailabilityDomWake();
  wake.beginCycle(3);

  const decision = wake.offer(offer({
    classification: "EMPTY",
    allowEmptyExit: true,
    selectedMinutes: null,
  }));

  assert.equal(decision.accepted, true);
  assert.deepEqual(decision.signal, {
    kind: "empty_exit",
    cycle: 3,
    requestSequence: 7,
    quality: "EXACT",
    selectedMinutes: null,
    responseCompletedMonoMs: 1_020,
    payloadClassifiedMonoMs: 1_023,
    bridgeReceivedMonoMs: 1_025,
    wakeAtMonoMs: 1_026,
  });
  assert.equal(wake.consume(3)?.kind, "empty_exit");
});

test("STRONG EMPTY never enters the control path", () => {
  const wake = new AvailabilityDomWake();
  wake.beginCycle(3);

  const decision = wake.offer(offer({
    classification: "EMPTY",
    allowEmptyExit: true,
    quality: "STRONG",
    selectedMinutes: null,
  }));

  assert.equal(decision.accepted, false);
  assert.equal(decision.discardReason, "untrusted_quality");
  assert.equal(wake.consume(3), null);
});

test("an accepted body interrupts an in-flight fallback sleep", async () => {
  const wake = new AvailabilityDomWake();
  wake.beginCycle(3);
  const controller = new AbortController();
  let sleepResolved = false;
  let resolveSleep;
  const sleep = () => new Promise((resolve) => {
    resolveSleep = () => {
      sleepResolved = true;
      resolve(true);
    };
  });

  const waiting = wake.wait(3, 25, sleep, controller.signal);
  const decision = wake.offer(offer());
  assert.equal(decision.accepted, true);
  const result = await waiting;

  assert.equal(result.kind, "wake");
  assert.equal(result.signal.requestSequence, 7);
  assert.equal(sleepResolved, false);
  resolveSleep();
});

test("an accepted EMPTY interrupts an in-flight fallback sleep", async () => {
  const wake = new AvailabilityDomWake();
  wake.beginCycle(3);
  const controller = new AbortController();
  let resolveSleep;
  const sleep = () => new Promise((resolve) => {
    resolveSleep = () => resolve(true);
  });

  const waiting = wake.wait(3, 25, sleep, controller.signal);
  const decision = wake.offer(offer({
    classification: "EMPTY",
    allowEmptyExit: true,
    selectedMinutes: null,
  }));
  const result = await waiting;

  assert.equal(decision.accepted, true);
  assert.equal(result.kind, "wake");
  assert.equal(result.signal.kind, "empty_exit");
  resolveSleep();
});

test("ending or replacing a cycle clears pending and waiting signals", async () => {
  const wake = new AvailabilityDomWake();
  wake.beginCycle(3);
  wake.offer(offer());
  wake.endCycle(3);
  assert.equal(wake.consume(3), null);

  const controller = new AbortController();
  const waiting = wake.wait(3, 25, async () => true, controller.signal);
  wake.beginCycle(4);
  assert.equal((await waiting).kind, "elapsed");
  assert.equal(wake.offer(offer()).discardReason, "inactive_cycle");
});
