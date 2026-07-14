import assert from "node:assert/strict";
import test from "node:test";
import { traceCsv, traceCsvFilename } from "../dist/sidepanel/telemetry/trace-csv.js";

const epoch = Date.UTC(2026, 6, 14, 5, 40, 22, 72) + 0.85;

const run = {
  schemaVersion: 1,
  runId: "run-abc",
  startedAt: epoch,
  finishedAt: epoch + 1_000,
  finalState: "HANDED_OFF",
  eventCount: 1,
  droppedCount: 0,
  extensionVersion: "0.2.0",
  config: {
    targetUrl: "https://app.catchtable.co.kr/ct/shop/nuwa",
    reservationDate: "2026-08-02",
    personCount: 2,
    openAtMs: epoch + 10_000,
    stopAtMs: epoch + 20_000,
    timeRange: { startMinutes: 1020, endMinutes: 1200 },
  },
};

const event = {
  schemaVersion: 1,
  runId: "run-abc",
  seq: 1,
  code: "AVAILABILITY_SHADOW",
  severity: "trace",
  component: "content",
  localAt: epoch,
  serverAt: epoch + 50,
  state: "REFRESHING_SLOTS",
  message: "쉼표, 따옴표 \"와\n개행",
  attributes: {
    cycle: 3,
    note: "값,\"인용\"",
    responseCompletedMonoMs: 123.45,
  },
};

test("trace CSV keeps raw epochs, adds KST timestamps, and escapes dynamic attributes", () => {
  const csv = traceCsv(run, [event]);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /localAtMs,localAtKst,serverAtMs,serverAtKst/);
  assert.match(csv, /attr\.cycle,attr\.note,attr\.responseCompletedMonoMs/);
  assert.match(csv, /"=""1784007622072\.85""","=""2026-07-14 14:40:22\.072"""/);
  assert.doesNotMatch(csv, /,1784007622072\.85,/);
  assert.doesNotMatch(csv, /,2026-07-14 14:40:22\.072,/);
  assert.match(csv, /"쉼표, 따옴표 ""와\n개행"/);
  assert.match(csv, /"값,""인용"""/);
  assert.match(csv, /123\.45/);
});

test("trace CSV filename uses the shop, reservation date, and run id", () => {
  assert.equal(traceCsvFilename(run), "catchtable_nuwa_2026-08-02_run-abc.csv");
});
