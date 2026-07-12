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

test("clock sync detail shows phase, precision, and the per-sample breakdown past the attribute cap", () => {
  const document = documentFixture();
  const view = new TraceHistoryView(document, { select: () => undefined, remove: () => undefined });
  view.renderRuns([run("run-c", 1)]);
  view.renderEvents([{
    schemaVersion: 1, runId: "run-c", seq: 1, code: "CLOCK_SYNCED", severity: "trace",
    component: "content", localAt: 1, serverAt: 1, state: "SYNCING_CLOCK", message: "보정",
    attributes: {
      eventKind: "metric",
      clockOffsetMs: 1067.949951171875, clockSamples: 2, clockSpreadMs: 276.1,
      clockFallback: false, clockMethod: "boundary", clockPrecisionMs: 138.05,
      clockPhase: "final", clockSampleDetail: "o-44 l648 d0 | o1068 l95 d1000",
    },
  }]);
  const detail = document.querySelector("#trace-event-list .event-detail")?.textContent ?? "";
  assert.match(detail, /final/);
  assert.match(detail, /오프셋 1068ms/);
  assert.match(detail, /boundary ±138ms/);
  assert.match(detail, /샘플 o-44 l648 d0 \| o1068 l95 d1000/);
});

test("clock sync detail flags when fewer samples arrived than were used, hinting at fetch failures", () => {
  const document = documentFixture();
  const view = new TraceHistoryView(document, { select: () => undefined, remove: () => undefined });
  view.renderRuns([run("run-c", 1)]);
  view.renderEvents([{
    schemaVersion: 1, runId: "run-c", seq: 1, code: "CLOCK_SYNCED", severity: "trace",
    component: "content", localAt: 1, serverAt: 1, state: "SYNCING_CLOCK", message: "보정",
    attributes: {
      eventKind: "metric",
      clockOffsetMs: 1037, clockSamples: 3, clockCollectedSamples: 5, clockSpreadMs: 1489,
      clockFallback: false, clockMethod: "median", clockPrecisionMs: 536,
      clockPhase: "initial",
    },
  }]);
  const detail = document.querySelector("#trace-event-list .event-detail")?.textContent ?? "";
  assert.match(detail, /표본 5개 중 3개 사용/);
});

test("clock sync detail omits the sample section when no breakdown was recorded", () => {
  const document = documentFixture();
  const view = new TraceHistoryView(document, { select: () => undefined, remove: () => undefined });
  view.renderRuns([run("run-c", 1)]);
  view.renderEvents([{
    schemaVersion: 1, runId: "run-c", seq: 1, code: "CLOCK_SYNCED", severity: "trace",
    component: "content", localAt: 1, serverAt: 1, state: "SYNCING_CLOCK", message: "보정",
    attributes: {
      eventKind: "metric",
      clockOffsetMs: -43.625, clockSamples: 2, clockSpreadMs: 647.65,
      clockFallback: false, clockMethod: "boundary", clockPrecisionMs: 323.83,
      clockPhase: "initial",
    },
  }]);
  const detail = document.querySelector("#trace-event-list .event-detail")?.textContent ?? "";
  assert.match(detail, /initial · 오프셋 -44ms · boundary ±324ms/);
  assert.doesNotMatch(detail, /샘플/);
});

test("persisted trace detail surfaces snapshot identity fields (snippet, fingerprint, run-state)", () => {
  const document = documentFixture();
  const view = new TraceHistoryView(document, { select: () => undefined, remove: () => undefined });
  view.renderRuns([run("run-x", 1)]);
  view.renderEvents([{
    schemaVersion: 1, runId: "run-x", seq: 1, code: "RUN_TERMINATED", severity: "warn",
    component: "content", localAt: 1, serverAt: 1, state: "HANDED_OFF", message: "인계",
    attributes: {
      eventKind: "state", state: "HANDED_OFF",
      snapshotUrlKind: "shop", snapshotHeadings: "", snapshotButtons: "확인 | 취소",
      snapshotDisabledButtonCount: 1, snapshotDialogLabel: "", snapshotDialogTitle: "",
      snapshotTextSnippet: "추가 확인이 필요합니다", snapshotFingerprint: "ss-abc123",
      snapshotRunState: "ADVANCING_RESERVATION",
    },
  }]);
  const detail = document.querySelector("#trace-event-list .event-detail")?.textContent ?? "";
  assert.match(detail, /추가 확인이 필요합니다/);
  assert.match(detail, /ss-abc123/);
  assert.match(detail, /ADVANCING_RESERVATION/);
});
