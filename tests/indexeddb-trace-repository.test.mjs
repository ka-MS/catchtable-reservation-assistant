import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { IndexedDbTraceRepository } from "../dist/background/telemetry/indexeddb-repository.js";
import { TraceIngestor } from "../dist/background/telemetry/trace-ingestor.js";

const config = {
  targetUrl: "https://app.catchtable.co.kr/ct/shop/kea",
  openAtMs: 10_000,
  reservationDate: "2026-07-30",
  personCount: 2,
  timeRange: { startMinutes: 1080, endMinutes: 1200 },
  priorityTimes: [1140],
  postSlotEnabled: false,
  tablePreference: "any",
  menuKeyword: "",
  stopAtMs: 20_000,
  entryMode: "auto",
  dryRun: false,
  preOpenLeadMs: 3000,
  toggleIntervalMs: 150,
};

function descriptor(runId, startedAt) {
  return { schemaVersion: 1, runId, startedAt, config };
}

function event(runId, seq, state = null) {
  return {
    schemaVersion: 1,
    runId,
    seq,
    code: state === "FAILED" ? "RUN_FAILED" : "STATE_CHANGED",
    severity: state === "FAILED" ? "error" : "trace",
    component: "content",
    localAt: seq,
    serverAt: null,
    state,
    message: `event ${seq}`,
    attributes: {},
  };
}

test("repository stores idempotent batches, reads runs and deletes details", async () => {
  await new Promise((resolve) => {
    const deletion = indexedDB.deleteDatabase("catchtable-reserve-telemetry");
    deletion.onsuccess = deletion.onerror = deletion.onblocked = resolve;
  });
  const repository = new IndexedDbTraceRepository(indexedDB);
  const run = descriptor("run-1", 100);
  await repository.append(run, [event("run-1", 1), event("run-1", 2, "FAILED")], "0.2.0");
  await repository.append(run, [event("run-1", 2, "FAILED")], "0.2.0");

  const runs = await repository.listRuns(20);
  assert.equal(runs.length, 1);
  assert.equal(runs[0].finalState, "FAILED");
  assert.equal(runs[0].eventCount, 2);
  assert.equal((await repository.readEvents("run-1", 100)).length, 2);

  await repository.deleteRun("run-1");
  assert.equal((await repository.listRuns(20)).length, 0);
  assert.equal((await repository.readEvents("run-1", 100)).length, 0);
});

test("repository prunes old runs and their events", async () => {
  const repository = new IndexedDbTraceRepository(indexedDB);
  for (let index = 1; index <= 3; index += 1) {
    await repository.append(descriptor(`run-${index}`, index), [event(`run-${index}`, 1)], "0.2.0");
  }
  await repository.prune(2);
  assert.deepEqual((await repository.listRuns(20)).map((run) => run.runId), ["run-3", "run-2"]);
  assert.equal((await repository.readEvents("run-1", 100)).length, 0);

  const published = [];
  const ingestor = new TraceIngestor(repository, { publish: (batch) => published.push(batch) }, () => "0.2.0");
  await ingestor.recordBackgroundTerminal("run-3", 3, config, "STOPPED", "탭이 닫혔습니다.");
  const terminalEvents = await repository.readEvents("run-3", 100);
  assert.equal(terminalEvents.at(-1).seq, 2);
  assert.equal(terminalEvents.at(-1).state, "STOPPED");
  assert.equal(published.at(-1).events[0].component, "background");
});
