import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { TraceHistoryView } from "../dist/sidepanel/telemetry/trace-view.js";

function documentFixture() {
  return new JSDOM(`
    <select id="trace-run-select"></select>
    <button id="trace-run-export"></button>
    <button id="trace-run-diagnostic"></button>
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
  const downloaded = [];
  const diagnosed = [];
  const removed = [];
  const view = new TraceHistoryView(document, {
    select: (runId) => selected.push(runId),
    download: (selectedRun) => downloaded.push(selectedRun.runId),
    diagnostic: (selectedRun) => diagnosed.push(selectedRun.runId),
    remove: (runId) => removed.push(runId),
  });
  view.renderRuns([run("run-2", 2), run("run-1", 1, 3)]);
  assert.equal(document.querySelectorAll("#trace-run-select option").length, 2);
  assert.equal(document.querySelector("#trace-run-export").disabled, true);
  assert.equal(document.querySelector("#trace-run-diagnostic").disabled, true);
  document.querySelector("#trace-run-select").value = "run-1";
  document.querySelector("#trace-run-select").dispatchEvent(new document.defaultView.Event("change"));
  assert.equal(document.querySelector("#trace-run-export").disabled, false);
  assert.equal(document.querySelector("#trace-run-diagnostic").disabled, false);
  document.querySelector("#trace-run-export").click();
  document.querySelector("#trace-run-diagnostic").click();
  document.querySelector("#trace-run-delete").click();
  assert.deepEqual(selected, ["run-1"]);
  assert.deepEqual(downloaded, ["run-1"]);
  assert.deepEqual(diagnosed, ["run-1"]);
  assert.deepEqual(removed, ["run-1"]);
});

test("trace view appends live batches incrementally and caps the DOM at one hundred rows", () => {
  const document = documentFixture();
  const view = new TraceHistoryView(document, { select: () => undefined, download: () => undefined, remove: () => undefined });
  view.renderRuns([]);
  view.renderEvents([]);
  for (let seq = 1; seq <= 101; seq += 1) {
    view.appendLive({ type: "TRACE_LIVE_BATCH", run: run("run-live"), events: [event("run-live", seq)] });
  }
  assert.equal(document.querySelectorAll("#trace-event-list > li").length, 100);
  assert.match(document.querySelector("#trace-event-list > li")?.textContent ?? "", /event 101/);
  assert.equal(document.querySelector("#trace-event-count").textContent, "100개");
});

test("raw clock samples stay export-only and do not replace operational trace rows", () => {
  const document = documentFixture();
  const view = new TraceHistoryView(document, { select: () => undefined, download: () => undefined, diagnostic: () => undefined, remove: () => undefined });
  const operational = event("run-clock", 1);
  const raw = event("run-clock", 2, "CLOCK_SAMPLE");
  view.renderRuns([run("run-clock", 1)]);
  view.renderEvents([operational, raw]);
  assert.equal(document.querySelectorAll("#trace-event-list > li").length, 1);
  assert.match(document.querySelector("#trace-event-list > li")?.textContent ?? "", /event 1/);
  view.appendLive({ type: "TRACE_LIVE_BATCH", run: run("run-clock"), events: [raw] });
  assert.equal(document.querySelectorAll("#trace-event-list > li").length, 1);
  assert.equal(document.querySelector("#trace-event-count").textContent, "1개");
});

test("clock sync detail shows phase, offset, uncertainty, confidence, and RTT/sample stats", () => {
  const document = documentFixture();
  const view = new TraceHistoryView(document, { select: () => undefined, download: () => undefined, remove: () => undefined });
  view.renderRuns([run("run-c", 1)]);
  view.renderEvents([{
    schemaVersion: 1, runId: "run-c", seq: 1, code: "CLOCK_SYNCED", severity: "trace",
    component: "content", localAt: 1, serverAt: 1, state: "WAITING_FOR_OPEN", message: "진입 시점 결정",
    attributes: {
      eventKind: "metric",
      clockPhase: "armed", clockOffsetMs: 1068, clockUncertaintyMs: 138,
      clockConfidence: "HIGH", clockDominantSupport: 5, clockCompetingSupport: 0,
      clockClusterSeparationMs: -1, clockMedianRttMs: 62, clockP95RttMs: 95,
      clockSampleCount: 5, clockObservationSpanMs: 6200, clockSource: "APP_HEAD_HTTP_DATE",
      clockArmLeadMs: 550,
    },
  }]);
  const detail = document.querySelector("#trace-event-list .event-detail")?.textContent ?? "";
  assert.match(detail, /armed/);
  assert.match(detail, /오프셋 1068ms ±138ms/);
  assert.match(detail, /HIGH/);
  assert.match(detail, /표본 5/);
  assert.match(detail, /armLead 550ms/);
});

test("clock sync detail flags a competing cluster with its separation", () => {
  const document = documentFixture();
  const view = new TraceHistoryView(document, { select: () => undefined, download: () => undefined, remove: () => undefined });
  view.renderRuns([run("run-c", 1)]);
  view.renderEvents([{
    schemaVersion: 1, runId: "run-c", seq: 1, code: "CLOCK_SYNCED", severity: "trace",
    component: "content", localAt: 1, serverAt: 1, state: "SYNCING_CLOCK", message: "보정",
    attributes: {
      eventKind: "metric",
      clockPhase: "bootstrap", clockOffsetMs: 2630, clockUncertaintyMs: 1350,
      clockConfidence: "LOW", clockDominantSupport: 3, clockCompetingSupport: 2,
      clockClusterSeparationMs: 1350, clockMedianRttMs: 40, clockP95RttMs: 40,
      clockSampleCount: 5, clockObservationSpanMs: 3440, clockSource: "APP_HEAD_HTTP_DATE",
    },
  }]);
  const detail = document.querySelector("#trace-event-list .event-detail")?.textContent ?? "";
  assert.match(detail, /LOW/);
  assert.match(detail, /경쟁 2\(간격 1350ms\)/);
  assert.doesNotMatch(detail, /armLead/);
});

test("clock sync detail reports a failed bootstrap honestly via the FALLBACK source", () => {
  const document = documentFixture();
  const view = new TraceHistoryView(document, { select: () => undefined, download: () => undefined, remove: () => undefined });
  view.renderRuns([run("run-c", 1)]);
  view.renderEvents([{
    schemaVersion: 1, runId: "run-c", seq: 1, code: "CLOCK_SYNCED", severity: "trace",
    component: "content", localAt: 1, serverAt: 1, state: "SYNCING_CLOCK", message: "시계 측정 실패",
    attributes: {
      eventKind: "metric",
      clockPhase: "bootstrap", clockOffsetMs: 0, clockUncertaintyMs: 0,
      clockConfidence: "LOW", clockDominantSupport: 0, clockCompetingSupport: 0,
      clockClusterSeparationMs: -1, clockMedianRttMs: 0, clockP95RttMs: 0,
      clockSampleCount: 0, clockObservationSpanMs: 0, clockSource: "FALLBACK",
    },
  }]);
  const detail = document.querySelector("#trace-event-list .event-detail")?.textContent ?? "";
  assert.match(detail, /FALLBACK/);
});

test("persisted trace detail surfaces snapshot identity fields (snippet, fingerprint, run-state)", () => {
  const document = documentFixture();
  const view = new TraceHistoryView(document, { select: () => undefined, download: () => undefined, remove: () => undefined });
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
