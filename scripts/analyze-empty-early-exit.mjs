import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { nextTogglePlan } from "../dist/shared/toggle-schedule.js";

const root = path.resolve("docs/evidence/live-runs");
const QUIESCE_TIMEOUT_MS = 700;
const MAX_TARGET_SCHEDULE_DRIFT_MS = 100;
const DOCUMENTED_ENVIRONMENT_EXCLUSIONS = new Set([
  "nuwa-run-5881d898-a394-4244-a694-07e2d5ea0205",
  "nuwa-run-8984299b-a323-4278-a799-4da514d9c20a",
  "nuwa-run-b413a0d5-d2ed-4642-bee3-d4aea20d04ac",
]);

export function parseCsv(source) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const [headers, ...values] = rows;
  return values.filter((value) => value.some(Boolean)).map((value) => Object.fromEntries(
    headers.map((header, index) => [header, value[index] ?? ""]),
  ));
}

function number(value) {
  if (value === "" || value === undefined || value === null) return null;
  const normalized = String(value).replace(/^="/, "").replace(/"$/, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function nearestRank(values, percentile) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

function distribution(values) {
  const finite = values.filter(Number.isFinite);
  return {
    n: finite.length,
    min: nearestRank(finite, 0),
    p50: nearestRank(finite, 0.5),
    p95: nearestRank(finite, 0.95),
    max: nearestRank(finite, 1),
  };
}

function isExactEmpty(row) {
  return row.code === "AVAILABILITY_SHADOW"
    && row["attr.phase"] === "body"
    && row["attr.classification"] === "EMPTY"
    && row["attr.correlationQuality"] === "EXACT";
}

export function analyzeRunRows(rows, runDirectory) {
  const first = rows[0];
  const config = JSON.parse(first.configJson);
  const openAtMs = number(first.openAtMs);
  const cycleRows = new Map(rows
    .filter((row) => row.code === "DATE_TOGGLE_CYCLE")
    .map((row) => [number(row["attr.cycle"]), row]));
  const exactEmpty = rows.filter(isExactEmpty);
  const eligible = exactEmpty.filter((row) => row["attr.wakeDiscardReason"] === "no_matching_slot");

  return {
    runDirectory,
    exactEmptyCount: exactEmpty.length,
    eligibleCount: eligible.length,
    inactiveOrOtherCount: exactEmpty.length - eligible.length,
    events: eligible.map((row) => {
      const cycle = number(row["attr.cycle"]);
      const current = cycleRows.get(cycle);
      const next = cycleRows.get(cycle + 1);
      const bodyAtMs = number(row.serverAtMs);
      const targetClickedAtMs = number(current?.["attr.targetClickedAt"]);
      const cycleEndedAtMs = number(current?.serverAtMs);
      const nextTargetClickedAtMs = number(next?.["attr.targetClickedAt"]);
      const nextTargetPlannedAtMs = number(next?.["attr.targetPlannedAt"]);
      const nextTargetScheduleDriftMs = number(next?.["attr.targetScheduleDriftMs"])
        ?? (nextTargetClickedAtMs === null || nextTargetPlannedAtMs === null
          ? null
          : nextTargetClickedAtMs - nextTargetPlannedAtMs);
      const hypothetical = bodyAtMs === null || openAtMs === null
        ? null
        : nextTogglePlan(bodyAtMs, openAtMs, config.toggleIntervalMs).targetClickAtMs;
      const remainingUntilCycleEndMs = bodyAtMs === null || cycleEndedAtMs === null
        ? null
        : cycleEndedAtMs - bodyAtMs;
      const documentedEnvironmentExcluded = DOCUMENTED_ENVIRONMENT_EXCLUSIONS.has(runDirectory);
      const timingClean = !documentedEnvironmentExcluded
        && remainingUntilCycleEndMs !== null
        && remainingUntilCycleEndMs >= 0
        && remainingUntilCycleEndMs <= QUIESCE_TIMEOUT_MS
        && nextTargetScheduleDriftMs !== null
        && Math.abs(nextTargetScheduleDriftMs) <= MAX_TARGET_SCHEDULE_DRIFT_MS;
      return {
        runDirectory,
        cycle,
        documentedEnvironmentExcluded,
        timingClean,
        bodyAfterTargetMs: bodyAtMs === null || targetClickedAtMs === null
          ? null
          : bodyAtMs - targetClickedAtMs,
        remainingUntilCycleEndMs,
        actualNextTargetFromBodyMs: bodyAtMs === null || nextTargetClickedAtMs === null
          ? null
          : nextTargetClickedAtMs - bodyAtMs,
        hypotheticalNextTargetFromBodyMs: bodyAtMs === null || hypothetical === null
          ? null
          : hypothetical - bodyAtMs,
        theoreticalAdvanceMs: nextTargetClickedAtMs === null || hypothetical === null
          ? null
          : nextTargetClickedAtMs - hypothetical,
        nextTargetScheduleDriftMs,
      };
    }),
  };
}

function aggregate(events) {
  return {
    eventCount: events.length,
    runCount: new Set(events.map((event) => event.runDirectory)).size,
    bodyAfterTargetMs: distribution(events.map((event) => event.bodyAfterTargetMs)),
    remainingUntilCycleEndMs: distribution(events.map((event) => event.remainingUntilCycleEndMs)),
    actualNextTargetFromBodyMs: distribution(events.map((event) => event.actualNextTargetFromBodyMs)),
    hypotheticalNextTargetFromBodyMs: distribution(events.map((event) => event.hypotheticalNextTargetFromBodyMs)),
    theoreticalAdvanceMs: distribution(events.map((event) => event.theoreticalAdvanceMs)),
  };
}

async function findRunFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return findRunFiles(target);
    return entry.isFile() && entry.name === "run.csv" ? [target] : [];
  }));
  return nested.flat();
}

export async function analyzeEvidence(directory = root) {
  const files = (await findRunFiles(directory)).sort();
  const runs = await Promise.all(files.map(async (file) => analyzeRunRows(
    parseCsv(await readFile(file, "utf8")),
    path.basename(path.dirname(file)),
  )));
  const events = runs.flatMap((run) => run.events);
  const documentedEnvironmentClean = events.filter((event) => !event.documentedEnvironmentExcluded);
  const timingClean = events.filter((event) => event.timingClean);
  return {
    generatedFrom: path.relative(process.cwd(), directory),
    generatedAt: new Date().toISOString(),
    methodology: {
      eligible: "EXACT EMPTY whose historical wakeDiscardReason is no_matching_slot (active cycle)",
      documentedEnvironmentExclusions: [...DOCUMENTED_ENVIRONMENT_EXCLUSIONS],
      timingClean: `documented environment clean + 0..${QUIESCE_TIMEOUT_MS}ms cycle remainder + |next target schedule drift| <= ${MAX_TARGET_SCHEDULE_DRIFT_MS}ms`,
      percentile: "nearest-rank",
      caveat: "Counterfactual reuses historical response timing; it cannot predict changed server behavior after request cadence changes.",
    },
    runCount: runs.length,
    exactEmptyCount: runs.reduce((sum, run) => sum + run.exactEmptyCount, 0),
    eligibleCount: events.length,
    inactiveOrOtherCount: runs.reduce((sum, run) => sum + run.inactiveOrOtherCount, 0),
    allEligible: aggregate(events),
    documentedEnvironmentClean: aggregate(documentedEnvironmentClean),
    timingClean: aggregate(timingClean),
    runs,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(`${JSON.stringify(await analyzeEvidence(), null, 2)}\n`);
}
