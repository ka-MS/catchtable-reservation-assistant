import assert from "node:assert/strict";
import test from "node:test";
import { DiagnosticRecorder } from "../dist/content/diagnostics/recorder.js";

function snapshot(input, index) {
  return {
    schemaVersion: 1,
    snapshotId: `ss-${index}`,
    runId: input.runId,
    capturedAt: index,
    kind: input.kind,
    stage: input.stage,
    adapter: "test",
    trigger: input.trigger,
    reason: input.reason,
    strategy: null,
    confidence: null,
    evidence: [],
    queries: [],
    environment: {},
    headings: [],
    buttons: [],
    radios: [],
    checkboxes: [],
    surfaces: [],
    calendar: {},
    slots: {},
    fingerprint: `fp-${index}`,
    previousFingerprint: input.previousFingerprint ?? null,
  };
}

test("recorder persists only the latest three breadcrumbs plus failure", async () => {
  let index = 0;
  const saved = [];
  const recorder = new DiagnosticRecorder(
    (input) => snapshot(input, ++index),
    { save: async (_runId, snapshots) => saved.push(snapshots) },
  );
  recorder.start("run-1");
  recorder.breadcrumb("CONFIGURED", "state", "one");
  recorder.breadcrumb("VALIDATING", "state", "two");
  recorder.breadcrumb("SYNCING_CLOCK", "state", "three");
  recorder.breadcrumb("ENTERING_RESERVATION", "action", "four");
  const id = recorder.failure("ENTERING_RESERVATION", "failed");
  await recorder.forceFlush();

  assert.equal(id, "ss-5");
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].map((item) => item.reason), ["two", "three", "four", "failed"]);
  assert.equal(saved[0][0].previousFingerprint, "fp-1");
  assert.equal(saved[0][3].previousFingerprint, "fp-4");
});
test("recorder discards normal runs and records a failure only once", async () => {
  let index = 0;
  const saved = [];
  const recorder = new DiagnosticRecorder(
    (input) => snapshot(input, ++index),
    { save: async (_runId, snapshots) => saved.push(snapshots) },
  );
  recorder.start("normal");
  recorder.breadcrumb("CONFIGURED", "state", "normal");
  recorder.reset();
  assert.equal(saved.length, 0);

  recorder.start("failed");
  assert.ok(recorder.failure("SELECTING_DATE", "first"));
  assert.equal(recorder.failure("SELECTING_DATE", "second"), null);
  await recorder.forceFlush();
  assert.equal(saved.length, 1);
});
