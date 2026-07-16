import assert from "node:assert/strict";
import test from "node:test";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { IndexedDbTraceRepository } from "../dist/background/telemetry/indexeddb-repository.js";

globalThis.IDBKeyRange = IDBKeyRange;

const config = {
  targetUrl: "https://app.catchtable.co.kr/ct/shop/kea",
  openAtMs: 10_000,
  reservationDate: "2026-07-30",
  personCount: 2,
  timeRange: { startMinutes: 1080, endMinutes: 1200 },
  priorityTimes: [],
  postSlotEnabled: false,
  tablePreference: "any",
  menuKeyword: "",
  stopAtMs: 20_000,
  entryMode: "auto",
  dryRun: false,
  preOpenLeadMs: 3000,
  toggleIntervalMs: 150,
};

function openV1(factory) {
  return new Promise((resolve, reject) => {
    const request = factory.open("catchtable-reserve-telemetry", 1);
    request.onupgradeneeded = () => {
      const runs = request.result.createObjectStore("runs", { keyPath: "runId" });
      runs.createIndex("startedAt", "startedAt");
      const events = request.result.createObjectStore("events", { keyPath: ["runId", "seq"] });
      events.createIndex("runId", "runId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
}

function runRecord(runId) {
  return {
    schemaVersion: 1, runId, startedAt: 1, finishedAt: null, finalState: null,
    eventCount: 1, droppedCount: 0, extensionVersion: "0.2.0", config,
  };
}

function traceEvent(runId) {
  return {
    schemaVersion: 1, runId, seq: 1, code: "RUN_STARTED", severity: "info", component: "content",
    localAt: 1, serverAt: null, state: null, message: "started", attributes: {},
  };
}

function snapshot(runId, snapshotId, capturedAt) {
  return {
    schemaVersion: 1, snapshotId, runId, capturedAt, kind: "failure", stage: "SELECTING_DATE",
    adapter: "CalendarAdapter", trigger: "failure", reason: "failed", strategy: "calendar-dom-v2",
    confidence: null, evidence: [], queries: [], environment: {}, headings: [], buttons: [], radios: [],
    checkboxes: [], surfaces: [], calendar: {}, slots: {}, fingerprint: snapshotId, previousFingerprint: null,
  };
}

test("v1 to v2 upgrade preserves runs and events and adds snapshots", async () => {
  const factory = new IDBFactory();
  const database = await openV1(factory);
  const transaction = database.transaction(["runs", "events"], "readwrite");
  transaction.objectStore("runs").put(runRecord("run-old"));
  transaction.objectStore("events").put(traceEvent("run-old"));
  await transactionDone(transaction);
  database.close();

  const repository = new IndexedDbTraceRepository(factory);
  assert.equal((await repository.listRuns(20))[0].runId, "run-old");
  assert.equal((await repository.readEvents("run-old", 10))[0].message, "started");
  await repository.saveSnapshots([snapshot("run-old", "ss-1", 2)]);
  assert.equal((await repository.readSnapshots("run-old")).length, 1);
});

test("snapshot storage is idempotent, ordered, and cascades with run deletion", async () => {
  const factory = new IDBFactory();
  const repository = new IndexedDbTraceRepository(factory);
  const descriptor = { schemaVersion: 1, runId: "run-1", startedAt: 1, config };
  await repository.append(descriptor, [traceEvent("run-1")], "0.2.0");
  await repository.saveSnapshots([
    snapshot("run-1", "ss-2", 3),
    snapshot("run-1", "ss-1", 2),
    snapshot("run-1", "ss-2", 3),
  ]);
  assert.deepEqual((await repository.readSnapshots("run-1")).map((item) => item.snapshotId), ["ss-1", "ss-2"]);

  await repository.deleteRun("run-1");
  assert.equal((await repository.readSnapshots("run-1")).length, 0);
});
