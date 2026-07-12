import assert from "node:assert/strict";
import test from "node:test";
import { BatchTraceProcessor } from "../dist/content/telemetry/batch-processor.js";

function event(seq, code = "STATE_CHANGED") {
  return {
    schemaVersion: 1,
    runId: "run-1",
    seq,
    code,
    severity: code === "RUN_FAILED" ? "error" : "trace",
    component: "content",
    localAt: seq,
    serverAt: null,
    state: null,
    message: code,
    attributes: {},
  };
}

function harness(options = { delayMs: 250, batchSize: 2, traceQueueSize: 4 }) {
  let ack = () => undefined;
  const batches = [];
  const callbacks = new Map();
  const delays = [];
  let timerId = 0;
  const transport = {
    send: (batch) => batches.push(batch),
    setAckHandler: (handler) => { ack = handler; },
  };
  const timer = {
    set: (callback, delay) => {
      const id = ++timerId;
      callbacks.set(id, callback);
      delays.push(delay);
      return id;
    },
    clear: (id) => callbacks.delete(id),
  };
  const processor = new BatchTraceProcessor(transport, () => `batch-${batches.length + 1}`, timer, options);
  processor.startRun({ schemaVersion: 1, runId: "run-1", startedAt: 0, config: {} });
  return { processor, batches, ack, callbacks, delays };
}

test("processor schedules an immediate batch without sending inside record and retains events until ACK", () => {
  const h = harness();
  h.processor.record(event(1));
  assert.equal(h.batches.length, 0);
  h.processor.record(event(2));
  assert.equal(h.batches.length, 0);
  [...h.callbacks.values()][0]();
  assert.equal(h.batches.length, 1);
  assert.deepEqual(h.batches[0].events.map((item) => item.seq), [1, 2]);

  h.processor.record(event(3));
  assert.equal(h.delays.at(-1), 250);

  h.ack("run-1", 2);
  assert.equal(h.batches.length, 2);
});

test("processor retries an unacknowledged batch and advances after ACK", () => {
  const h = harness();
  h.processor.record(event(1));
  h.processor.flush();
  [...h.callbacks.values()][0]();
  assert.equal(h.batches.length, 2);
  assert.deepEqual(h.batches[1].events.map((item) => item.seq), [1]);

  h.ack("run-1", 1);
  h.processor.record(event(2));
  h.processor.flush();
  assert.deepEqual(h.batches.at(-1).events.map((item) => item.seq), [2]);
});

test("queue overflow drops ordinary trace before critical events", () => {
  const h = harness({ delayMs: 250, batchSize: 20, traceQueueSize: 2 });
  h.processor.record(event(1));
  h.processor.record(event(2, "RUN_FAILED"));
  h.processor.record(event(3));
  h.processor.flush();
  assert.deepEqual(h.batches[0].events.map((item) => item.code), ["RUN_FAILED", "STATE_CHANGED"]);
  assert.equal(h.batches[0].events[1].attributes.droppedTraceCount, 1);
});

test("forceFlush completes when storage acknowledges synchronously", async () => {
  let ack = () => undefined;
  const processor = new BatchTraceProcessor({
    setAckHandler: (handler) => { ack = handler; },
    send: (batch) => ack(batch.run.runId, batch.lastSeq),
  }, () => "batch", { set: () => 1, clear: () => undefined });
  processor.startRun({ schemaVersion: 1, runId: "run-1", startedAt: 0, config: {} });
  processor.record(event(1, "RUN_TERMINATED"));
  await processor.forceFlush(10);
});
