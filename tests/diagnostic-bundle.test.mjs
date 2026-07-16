import assert from "node:assert/strict";
import test from "node:test";
import { diagnosticBundle, diagnosticBundleFilename } from "../dist/sidepanel/diagnostics/bundle.js";

function unzipStored(bytes) {
  const files = new Map();
  const decoder = new TextDecoder();
  let offset = 0;
  while (new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true) === 0x04034b50) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 30);
    const size = view.getUint32(18, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    files.set(name, decoder.decode(bytes.slice(dataStart, dataStart + size)));
    offset = dataStart + size;
  }
  return files;
}

const run = {
  schemaVersion: 1, runId: "run-abc", startedAt: 1, finishedAt: 2, finalState: "FAILED",
  eventCount: 1, droppedCount: 0, extensionVersion: "0.2.0",
  config: {
    targetUrl: "https://app.catchtable.co.kr/ct/shop/kea", reservationDate: "2026-07-30",
    personCount: 2, openAtMs: 10, stopAtMs: 20, timeRange: { startMinutes: 1, endMinutes: 2 },
  },
};
const event = {
  schemaVersion: 1, runId: "run-abc", seq: 1, code: "RUN_FAILED", severity: "error", component: "content",
  localAt: 2, serverAt: null, state: "FAILED", message: "failure", attributes: { diagnosticSnapshotId: "ss-1" },
  error: { name: "Error", message: "boom", stack: "stack" },
};
const snapshot = {
  schemaVersion: 1, snapshotId: "ss-1", runId: "run-abc", capturedAt: 2, kind: "failure",
  stage: "SELECTING_DATE", adapter: "CalendarAdapter", trigger: "failure", reason: "failure",
  strategy: "calendar-dom-v2", confidence: null, evidence: [], queries: [], environment: { viewportWidth: 100 },
  headings: [], buttons: [], radios: [], checkboxes: [], surfaces: [], calendar: {}, slots: {},
  fingerprint: "fp", previousFingerprint: null, fragmentHtml: "<!doctype html><p>fixture</p>",
};

test("diagnostic bundle contains lossless events, snapshots, environment, CSV, and fragments", () => {
  const files = unzipStored(diagnosticBundle(run, [event], [snapshot], 3));
  assert.deepEqual([...files.keys()], [
    "manifest.json", "run.csv", "events.jsonl", "dom-snapshots.jsonl", "environment.json", "fragments/ss-1.html",
  ]);
  assert.match(files.get("events.jsonl"), /"stack":"stack"/);
  assert.match(files.get("dom-snapshots.jsonl"), /"fragmentFile":"fragments\/ss-1\.html"/);
  assert.doesNotMatch(files.get("dom-snapshots.jsonl"), /fragmentHtml/);
  assert.match(files.get("fragments/ss-1.html"), /fixture/);
  assert.match(files.get("run.csv"), /diagnosticSnapshotId/);
  assert.equal(JSON.parse(files.get("manifest.json")).snapshotCount, 1);
});
test("diagnostic bundle filename is filesystem safe", () => {
  assert.equal(diagnosticBundleFilename("run:a/b"), "catchtable-diagnostic-run_a_b.zip");
});
