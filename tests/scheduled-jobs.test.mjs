import assert from "node:assert/strict";
import test from "node:test";
import {
  ALARM_LEAD_MS,
  finishJob,
  markJobMissed,
  markJobRunning,
  reconcileJobs,
  removeScheduledJob,
  sanitizeScheduledJobs,
  scheduleJob,
} from "../dist/shared/scheduled-jobs.js";

const BASE_OPEN = 1_800_000_000_000;

function config(overrides = {}) {
  return {
    targetUrl: "https://app.catchtable.co.kr/ct/shop/test",
    openAtMs: BASE_OPEN,
    reservationDate: "2026-08-01",
    personCount: 2,
    timeRange: { startMinutes: 1080, endMinutes: 1200 },
    priorityTimes: [],
    postSlotEnabled: false,
    tablePreference: "any",
    menuKeyword: "",
    stopAtMs: BASE_OPEN + 600_000,
    entryMode: "auto",
    dryRun: false,
    preOpenLeadMs: 3_000,
    toggleIntervalMs: 150,
    clockSampleCount: 9,
    ...overrides,
  };
}

function job(overrides = {}) {
  return {
    id: "job-1",
    createdAt: 1,
    updatedAt: 1,
    status: "scheduled",
    config: config(),
    result: null,
    ...overrides,
  };
}

const NOW = BASE_OPEN - 3_600_000;

test("scheduleJob creates a new scheduled job", () => {
  const outcome = scheduleJob([], { id: null, config: config() }, { createId: () => "new-id", nowMs: NOW });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.job.id, "new-id");
  assert.equal(outcome.job.status, "scheduled");
  assert.equal(outcome.jobs.length, 1);
});

test("scheduleJob rejects prepared entry mode", () => {
  const outcome = scheduleJob([], { id: null, config: config({ entryMode: "prepared" }) }, { createId: () => "x", nowMs: NOW });
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /자동 페이지 준비/);
});

test("scheduleJob rejects overlapping occupancy windows", () => {
  const existing = job();
  const overlapping = config({ openAtMs: BASE_OPEN + 60_000, stopAtMs: BASE_OPEN + 660_000 });
  const outcome = scheduleJob([existing], { id: null, config: overlapping }, { createId: () => "x", nowMs: NOW });
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /겹치/);
});

test("scheduleJob allows disjoint windows", () => {
  const existing = job();
  const later = config({ openAtMs: BASE_OPEN + 700_000 + ALARM_LEAD_MS, stopAtMs: BASE_OPEN + 1_400_000 });
  const outcome = scheduleJob([existing], { id: null, config: later }, { createId: () => "x", nowMs: NOW });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.jobs.length, 2);
});

test("scheduleJob updates an existing job in place", () => {
  const existing = job();
  const outcome = scheduleJob([existing], { id: "job-1", config: config({ personCount: 4 }) }, { createId: () => "x", nowMs: NOW });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.job.id, "job-1");
  assert.equal(outcome.job.config.personCount, 4);
  assert.equal(outcome.jobs.length, 1);
});

test("scheduleJob rejects editing a running job", () => {
  const outcome = scheduleJob([job({ status: "running" })], { id: "job-1", config: config() }, { createId: () => "x", nowMs: NOW });
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /실행 중/);
});

test("scheduleJob enforces the active job limit", () => {
  const jobs = Array.from({ length: 10 }, (_, index) => job({
    id: `job-${index}`,
    config: config({
      openAtMs: BASE_OPEN + index * 1_000_000,
      stopAtMs: BASE_OPEN + index * 1_000_000 + 600_000,
    }),
  }));
  const extra = config({ openAtMs: BASE_OPEN + 20_000_000, stopAtMs: BASE_OPEN + 20_600_000 });
  const outcome = scheduleJob(jobs, { id: null, config: extra }, { createId: () => "x", nowMs: NOW });
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /최대 10개/);
});

test("removeScheduledJob rejects running jobs and removes others", () => {
  const running = removeScheduledJob([job({ status: "running" })], "job-1");
  assert.equal(running.ok, false);
  const done = removeScheduledJob([job({ status: "finished" })], "job-1");
  assert.equal(done.ok, true);
  assert.equal(done.jobs.length, 0);
});

test("status helpers transition a single job", () => {
  const running = markJobRunning([job()], "job-1", 50);
  assert.equal(running[0].status, "running");
  const missed = markJobMissed([job()], "job-1", 60);
  assert.equal(missed[0].status, "missed");
  const finished = finishJob([job({ status: "running" })], "job-1", { state: "HANDED_OFF", message: "폼 도착", finishedAt: 70 }, 70);
  assert.equal(finished[0].status, "finished");
  assert.equal(finished[0].result.state, "HANDED_OFF");
});

test("sanitizeScheduledJobs drops malformed entries", () => {
  const good = job();
  const sanitized = sanitizeScheduledJobs([good, null, { id: 3 }, { ...good, id: "bad", status: "unknown" }]);
  assert.deepEqual(sanitized.map((item) => item.id), ["job-1"]);
});

test("reconcileJobs reschedules future jobs and marks passed ones missed", () => {
  const future = job();
  const passed = job({ id: "job-2", status: "running", config: config({ openAtMs: NOW - 700_000, stopAtMs: NOW - 100_000 }) });
  const imminent = job({ id: "job-3", config: config({ openAtMs: NOW + 10_000, stopAtMs: NOW + 610_000 }) });
  const plan = reconcileJobs([future, passed, imminent], NOW);
  assert.deepEqual(plan.alarms, [
    { jobId: "job-1", whenMs: BASE_OPEN - ALARM_LEAD_MS },
    { jobId: "job-3", whenMs: NOW },
  ]);
  assert.deepEqual(plan.missed.map((item) => item.id), ["job-2"]);
  assert.equal(plan.jobs.find((item) => item.id === "job-2").status, "missed");
});
