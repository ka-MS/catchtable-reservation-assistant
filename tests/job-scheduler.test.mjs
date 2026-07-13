import assert from "node:assert/strict";
import test from "node:test";
import { ScheduledJobRepository } from "../dist/background/scheduled-job-repository.js";
import { JOB_ALARM_PREFIX, JobScheduler } from "../dist/background/scheduler.js";

const OPEN = 1_800_000_000_000;
const NOW = OPEN - 3_600_000;

function config(overrides = {}) {
  return {
    targetUrl: "https://app.catchtable.co.kr/ct/shop/test",
    openAtMs: OPEN,
    reservationDate: "2026-08-01",
    personCount: 2,
    timeRange: { startMinutes: 1080, endMinutes: 1200 },
    priorityTimes: [],
    postSlotEnabled: false,
    tablePreference: "any",
    menuKeyword: "",
    stopAtMs: OPEN + 600_000,
    entryMode: "auto",
    dryRun: false,
    preOpenLeadMs: 3_000,
    toggleIntervalMs: 150,
    ...overrides,
  };
}

function harness({ launch, nowMs = NOW } = {}) {
  const data = {};
  const storage = {
    get: async (key) => ({ [key]: data[key] }),
    set: async (values) => Object.assign(data, values),
  };
  let idCount = 0;
  const repository = new ScheduledJobRepository(storage, () => `id-${++idCount}`, () => nowMs);
  const created = [];
  const cleared = [];
  const notifications = [];
  const scheduler = new JobScheduler({
    repository,
    alarms: {
      create: (name, info) => created.push({ name, when: info.when }),
      clear: async (name) => (cleared.push(name), true),
    },
    launch: launch ?? (async () => ({ ok: true })),
    notify: (message) => notifications.push(message),
    now: () => nowMs,
  });
  return { scheduler, repository, created, cleared, notifications };
}

test("schedule stores the job and registers its alarm", async () => {
  const { scheduler, created } = harness();
  const response = await scheduler.schedule(null, config());
  assert.equal(response.ok, true);
  assert.deepEqual(created, [{ name: `${JOB_ALARM_PREFIX}id-1`, when: OPEN - 75_000 }]);
});

test("schedule surfaces validation errors", async () => {
  const { scheduler, created } = harness();
  const response = await scheduler.schedule(null, config({ entryMode: "prepared" }));
  assert.equal(response.ok, false);
  assert.equal(created.length, 0);
});

test("delete clears the alarm and removes the job", async () => {
  const { scheduler, repository, cleared } = harness();
  await scheduler.schedule(null, config());
  const response = await scheduler.delete("id-1");
  assert.equal(response.ok, true);
  assert.deepEqual(cleared, [`${JOB_ALARM_PREFIX}id-1`]);
  assert.deepEqual(await repository.read(), []);
});

test("onAlarm launches a scheduled job and marks it running", async () => {
  const launched = [];
  const { scheduler, repository } = harness({ launch: async (job) => (launched.push(job.id), { ok: true }) });
  await scheduler.schedule(null, config());
  await scheduler.onAlarm(`${JOB_ALARM_PREFIX}id-1`);
  assert.deepEqual(launched, ["id-1"]);
  assert.equal((await repository.read())[0].status, "running");
});

test("onAlarm marks the job missed when a run is already active", async () => {
  const { scheduler, repository, notifications } = harness({
    launch: async () => ({ ok: false, kind: "busy", error: "이미 실행 중" }),
  });
  await scheduler.schedule(null, config());
  await scheduler.onAlarm(`${JOB_ALARM_PREFIX}id-1`);
  assert.equal((await repository.read())[0].status, "missed");
  assert.equal(notifications.length, 1);
});

test("onAlarm records a launch failure as a failed finish", async () => {
  const { scheduler, repository, notifications } = harness({
    launch: async () => ({ ok: false, kind: "failed", error: "탭 생성 실패" }),
  });
  await scheduler.schedule(null, config());
  await scheduler.onAlarm(`${JOB_ALARM_PREFIX}id-1`);
  const [job] = await repository.read();
  assert.equal(job.status, "finished");
  assert.equal(job.result.state, "FAILED");
  assert.equal(notifications.length, 1);
});

test("onAlarm ignores unknown or non-scheduled jobs", async () => {
  const launched = [];
  const { scheduler } = harness({ launch: async () => (launched.push(1), { ok: true }) });
  await scheduler.onAlarm("unrelated");
  await scheduler.onAlarm(`${JOB_ALARM_PREFIX}ghost`);
  assert.equal(launched.length, 0);
});

test("onRunTerminal records the run result", async () => {
  const { scheduler, repository } = harness();
  await scheduler.schedule(null, config());
  await scheduler.onAlarm(`${JOB_ALARM_PREFIX}id-1`);
  await scheduler.onRunTerminal("id-1", "HANDED_OFF", "예약 폼에 도착했습니다.");
  const [job] = await repository.read();
  assert.equal(job.status, "finished");
  assert.equal(job.result.state, "HANDED_OFF");
});

test("reconcile re-registers alarms and notifies missed jobs", async () => {
  const { scheduler, repository, created, notifications } = harness();
  await scheduler.schedule(null, config());
  await repository.update((jobs) => jobs.map((job) => ({ ...job, status: "running" })));
  created.length = 0;
  await scheduler.reconcile();
  assert.deepEqual(created, [{ name: `${JOB_ALARM_PREFIX}id-1`, when: OPEN - 75_000 }]);
  assert.equal((await repository.read())[0].status, "scheduled");
  assert.equal(notifications.length, 0);
});
