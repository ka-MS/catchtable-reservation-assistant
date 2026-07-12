import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { TraceHistoryView } from "../dist/sidepanel/telemetry/trace-view.js";

function documentFixture() {
  return new JSDOM(`
    <select id="trace-run-select"></select>
    <button id="trace-run-delete"></button>
    <span id="trace-event-count"></span>
    <ol id="trace-event-list"><li class="event-empty"></li></ol>
  `).window.document;
}

function run(runId, startedAt = 1, finishedAt = null) {
  return {
    schemaVersion: 1,
    runId,
    startedAt,
    finishedAt,
    finalState: finishedAt === null ? "REFRESHING_SLOTS" : "FAILED",
    eventCount: 1,
    droppedCount: 0,
    extensionVersion: "0.2.0",
    config: { targetUrl: `https://app.catchtable.co.kr/ct/shop/${runId}`, reservationDate: "2026-07-30" },
  };
}

function event(runId, seq, code = "DATE_TOGGLE_CYCLE") {
  return {
    schemaVersion: 1,
    runId,
    seq,
    code,
    severity: "trace",
    component: "content",
    localAt: seq,
    serverAt: seq,
    state: "REFRESHING_SLOTS",
    message: `event ${seq}`,
    attributes: { cycle: seq, result: "NO_SLOT", slotScanCount: 1 },
  };
}

test("trace view renders run history and dispatches selection and deletion", () => {
  const document = documentFixture();
  const selected = [];
  const removed = [];
  const view = new TraceHistoryView(document, {
    select: (runId) => selected.push(runId),
    remove: (runId) => removed.push(runId),
  });
  view.renderRuns([run("run-2", 2), run("run-1", 1, 3)]);
  assert.equal(document.querySelectorAll("#trace-run-select option").length, 2);
  document.querySelector("#trace-run-select").value = "run-1";
  document.querySelector("#trace-run-select").dispatchEvent(new document.defaultView.Event("change"));
  document.querySelector("#trace-run-delete").click();
  assert.deepEqual(selected, ["run-1"]);
  assert.deepEqual(removed, ["run-1"]);
});

test("trace view appends live batches incrementally and caps the DOM at one hundred rows", () => {
  const document = documentFixture();
  const view = new TraceHistoryView(document, { select: () => undefined, remove: () => undefined });
  view.renderRuns([]);
  view.renderEvents([]);
  for (let seq = 1; seq <= 101; seq += 1) {
    view.appendLive({ type: "TRACE_LIVE_BATCH", run: run("run-live"), events: [event("run-live", seq)] });
  }
  assert.equal(document.querySelectorAll("#trace-event-list > li").length, 100);
  assert.match(document.querySelector("#trace-event-list > li")?.textContent ?? "", /event 101/);
  assert.equal(document.querySelector("#trace-event-count").textContent, "100개");
});
