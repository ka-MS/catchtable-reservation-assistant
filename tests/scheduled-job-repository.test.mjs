import assert from "node:assert/strict";
import test from "node:test";
import { ScheduledJobRepository } from "../dist/background/scheduled-job-repository.js";

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: async (key) => ({ [key]: data[key] }),
    set: async (values) => Object.assign(data, values),
  };
}

const OPEN = 1_800_000_000_000;

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
    clockSampleCount: 9,
    ...overrides,
  };
}

test("schedule persists a new job and read returns it", async () => {
  const storage = memoryStorage();
  const repository = new ScheduledJobRepository(storage, () => "id-1", () => OPEN - 3_600_000);
  const outcome = await repository.schedule({ id: null, config: config() });
  assert.equal(outcome.ok, true);
  const jobs = await repository.read();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, "id-1");
});

test("remove deletes a stored job", async () => {
  const storage = memoryStorage();
  const repository = new ScheduledJobRepository(storage, () => "id-1", () => OPEN - 3_600_000);
  await repository.schedule({ id: null, config: config() });
  const outcome = await repository.remove("id-1");
  assert.equal(outcome.ok, true);
  assert.deepEqual(await repository.read(), []);
});

test("update applies a mutator over sanitized jobs", async () => {
  const storage = memoryStorage({ scheduledJobs: "corrupted" });
  const repository = new ScheduledJobRepository(storage, () => "id-1", () => OPEN - 3_600_000);
  const jobs = await repository.update((items) => items);
  assert.deepEqual(jobs, []);
});
