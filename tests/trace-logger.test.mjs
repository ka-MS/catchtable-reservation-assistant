import assert from "node:assert/strict";
import test from "node:test";
import { BatchTraceProcessor } from "../dist/content/telemetry/batch-processor.js";
import { TraceLogger } from "../dist/content/telemetry/trace-logger.js";

const config = {
  targetUrl: "https://app.catchtable.co.kr/ct/shop/kea?token=secret#section",
  openAtMs: 10_000,
  reservationDate: "2026-07-30",
  personCount: 2,
  timeRange: { startMinutes: 1080, endMinutes: 1200 },
  priorityTimes: [],
  postSlotEnabled: false,
  tablePreference: "any",
  menuKeyword: "",
  stopAtMs: 20_000,
  entryMode: "auto",
  dryRun: false,
  preOpenLeadMs: 3000,
  toggleIntervalMs: 150,
};

test("trace logger strips URL query and bounds error and attribute data", () => {
  let ack = () => undefined;
  const batches = [];
  const processor = new BatchTraceProcessor({
    send: (batch) => batches.push(batch),
    setAckHandler: (handler) => { ack = handler; },
  }, () => "batch", {
    set: () => 1,
    clear: () => undefined,
  });
  const logger = new TraceLogger(processor, () => 1_000);
  logger.start("run-1", config);
  const error = new Error("failure");
  error.stack = "x".repeat(10_000);
  logger.record("RUN_FAILED", "error", "failed", { error, attributes: { detail: "y".repeat(1_000) } });
  processor.flush();

  assert.equal(batches[0].run.config.targetUrl, "https://app.catchtable.co.kr/ct/shop/kea");
  assert.equal(batches[0].events.at(-1).attributes.detail.length, 500);
  assert.equal(batches[0].events.at(-1).error.stack.length, 8_192);
  ack("run-1", batches[0].lastSeq);
});
