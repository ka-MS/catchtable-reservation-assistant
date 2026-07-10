import assert from "node:assert/strict";
import test from "node:test";
import { appendRunEvent, SerialTaskQueue } from "../dist/background/storage.js";

test("run events are kept as a bounded ring buffer", () => {
  const events = Array.from({ length: 300 }, (_, index) => ({ runId: "run", at: index }));
  const next = appendRunEvent(events, { runId: "run", at: 300 }, 300);
  assert.equal(next.length, 300);
  assert.equal(next[0].at, 1);
  assert.equal(next.at(-1).at, 300);
});

test("new run events discard logs from the previous run", () => {
  const next = appendRunEvent([{ runId: "old", at: 1 }], { runId: "new", at: 2 }, 300);
  assert.deepEqual(next, [{ runId: "new", at: 2 }]);
});

test("storage tasks are serialized in arrival order", async () => {
  const queue = new SerialTaskQueue();
  const order = [];
  const first = queue.enqueue(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push("first");
  });
  const second = queue.enqueue(async () => {
    order.push("second");
  });
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first", "second"]);
});
