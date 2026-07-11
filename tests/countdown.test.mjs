import assert from "node:assert/strict";
import test from "node:test";
import { countdownModel } from "../dist/sidepanel/countdown.js";

const HOUR = 3_600_000;

function model(overrides = {}) {
  return countdownModel({
    nowMs: 1_000_000,
    openAtMs: 1_000_000 + 103_000,
    offsetMs: null,
    activeStage: null,
    ...overrides,
  });
}

test("countdown hides without an open time", () => {
  assert.equal(model({ openAtMs: null }).visible, false);
});

test("countdown before open uses the local clock when no offset is measured", () => {
  const result = model();
  assert.equal(result.visible, true);
  assert.equal(result.mode, "countdown");
  assert.equal(result.text, "오픈까지 0:01:43");
  assert.equal(result.detail, "로컬 시계 기준");
  assert.equal(result.urgent, false);
});

test("countdown applies the measured server offset", () => {
  // server is 43 seconds ahead: only 1 minute remains on the server clock
  const result = model({ offsetMs: 43_000 });
  assert.equal(result.text, "오픈까지 0:01:00");
  assert.equal(result.detail, "서버 시계 기준");
});

test("countdown under one minute is urgent", () => {
  const result = model({ openAtMs: 1_000_000 + 59_000 });
  assert.equal(result.urgent, true);
});

test("countdown over a day includes the day count", () => {
  const result = model({ openAtMs: 1_000_000 + 25 * HOUR + 5_000 });
  assert.equal(result.text, "오픈까지 1일 1:00:05");
});

test("an active post-open stage replaces the countdown", () => {
  const result = model({ openAtMs: 1_000_000 - 5_000, activeStage: "슬롯 탐색" });
  assert.equal(result.mode, "stage");
  assert.equal(result.text, "슬롯 탐색");
  assert.equal(result.detail, "");
});

test("a passed open time without a run shows the elapsed time", () => {
  const result = model({ openAtMs: 1_000_000 - 103_000 });
  assert.equal(result.mode, "elapsed");
  assert.equal(result.text, "오픈 경과 +0:01:43");
});
