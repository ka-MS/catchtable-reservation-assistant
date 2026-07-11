import assert from "node:assert/strict";
import test from "node:test";
import { jobListModel, miniLogModel } from "../dist/sidepanel/job-list-model.js";

function job(overrides = {}) {
  return {
    id: "job-1",
    createdAt: 1,
    updatedAt: 1,
    status: "scheduled",
    config: { openAtMs: 1_000 },
    result: null,
    ...overrides,
  };
}

test("jobListModel splits active and done jobs", () => {
  const model = jobListModel([
    job({ id: "a", status: "scheduled", config: { openAtMs: 1_000 } }),
    job({ id: "b", status: "running", config: { openAtMs: 2_000 } }),
    job({ id: "c", status: "finished", updatedAt: 10 }),
    job({ id: "d", status: "missed", updatedAt: 30 }),
  ]);
  assert.deepEqual(model.active.map((item) => item.id), ["a", "b"]);
  assert.deepEqual(model.done.map((item) => item.id), ["d", "c"]);
  assert.equal(model.doneLabel, "완료된 작업 2개");
});

test("jobListModel keeps active order and sorts done by updatedAt desc", () => {
  const model = jobListModel([
    job({ id: "old", status: "finished", updatedAt: 5 }),
    job({ id: "new", status: "finished", updatedAt: 50 }),
  ]);
  assert.deepEqual(model.done.map((item) => item.id), ["new", "old"]);
  assert.deepEqual(model.active, []);
});

test("miniLogModel returns the latest three events newest first", () => {
  const events = [1, 2, 3, 4, 5].map((index) => ({ at: index, runId: "r", kind: "state", message: `m${index}` }));
  const model = miniLogModel(events);
  assert.deepEqual(model.entries.map((event) => event.message), ["m5", "m4", "m3"]);
  assert.equal(model.emptyText, null);
});

test("miniLogModel exposes an empty message when there are no events", () => {
  const model = miniLogModel([]);
  assert.deepEqual(model.entries, []);
  assert.equal(model.emptyText, "아직 실행 기록이 없습니다.");
});
