import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRunRows, parseCsv } from "../scripts/analyze-empty-early-exit.mjs";

function row(overrides = {}) {
  return {
    code: "",
    serverAtMs: "",
    configJson: "",
    openAtMs: "",
    "attr.phase": "",
    "attr.classification": "",
    "attr.correlationQuality": "",
    "attr.wakeDiscardReason": "",
    "attr.cycle": "",
    "attr.targetClickedAt": "",
    "attr.targetPlannedAt": "",
    "attr.targetScheduleDriftMs": "",
    ...overrides,
  };
}

test("parseCsv preserves Excel-safe epoch values for numeric normalization", () => {
  const rows = parseCsv('openAtMs,configJson\n"=""1000""","{}"\n');
  assert.equal(rows[0].openAtMs, '="1000"');
});

test("active EXACT EMPTY produces a timing-clean counterfactual", () => {
  const rows = [
    row({ openAtMs: '="10000"', configJson: '{"toggleIntervalMs":150}' }),
    row({
      code: "AVAILABILITY_SHADOW",
      serverAtMs: '="10100"',
      "attr.phase": "body",
      "attr.classification": "EMPTY",
      "attr.correlationQuality": "EXACT",
      "attr.wakeDiscardReason": "no_matching_slot",
      "attr.cycle": "1",
    }),
    row({
      code: "DATE_TOGGLE_CYCLE",
      serverAtMs: '="10340"',
      "attr.cycle": "1",
      "attr.targetClickedAt": "10000",
    }),
    row({
      code: "DATE_TOGGLE_CYCLE",
      serverAtMs: '="10510"',
      "attr.cycle": "2",
      "attr.targetClickedAt": "10450",
      "attr.targetPlannedAt": "10450",
      "attr.targetScheduleDriftMs": "0",
    }),
  ];

  const result = analyzeRunRows(rows, "visible-run");
  assert.equal(result.exactEmptyCount, 1);
  assert.equal(result.eligibleCount, 1);
  assert.deepEqual(result.events[0], {
    runDirectory: "visible-run",
    cycle: 1,
    documentedEnvironmentExcluded: false,
    timingClean: true,
    bodyAfterTargetMs: 100,
    remainingUntilCycleEndMs: 240,
    actualNextTargetFromBodyMs: 350,
    hypotheticalNextTargetFromBodyMs: 50,
    theoreticalAdvanceMs: 300,
    nextTargetScheduleDriftMs: 0,
  });
});

test("inactive, STRONG, and stalled EMPTY events are not timing-clean candidates", () => {
  const first = row({ openAtMs: '="10000"', configJson: '{"toggleIntervalMs":150}' });
  const current = row({
    code: "DATE_TOGGLE_CYCLE",
    serverAtMs: '="11000"',
    "attr.cycle": "1",
    "attr.targetClickedAt": "10000",
  });
  const next = row({
    code: "DATE_TOGGLE_CYCLE",
    serverAtMs: '="11200"',
    "attr.cycle": "2",
    "attr.targetClickedAt": "11150",
    "attr.targetPlannedAt": "11150",
  });
  const empty = (quality, reason) => row({
    code: "AVAILABILITY_SHADOW",
    serverAtMs: '="10100"',
    "attr.phase": "body",
    "attr.classification": "EMPTY",
    "attr.correlationQuality": quality,
    "attr.wakeDiscardReason": reason,
    "attr.cycle": "1",
  });

  const result = analyzeRunRows([
    first,
    empty("EXACT", "inactive_cycle"),
    empty("STRONG", "no_matching_slot"),
    empty("EXACT", "no_matching_slot"),
    current,
    next,
  ], "visible-run");

  assert.equal(result.exactEmptyCount, 2);
  assert.equal(result.eligibleCount, 1);
  assert.equal(result.events[0].timingClean, false);
});
