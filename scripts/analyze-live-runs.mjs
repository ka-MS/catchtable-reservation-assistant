import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = path.resolve("docs/evidence/live-runs");

function parseCsv(source) {
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
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
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

async function findRunFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return findRunFiles(target);
    return entry.isFile() && entry.name === "run.csv" ? [target] : [];
  }));
  return nested.flat();
}

function number(value) {
  if (value === "" || value === undefined || value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function last(values) {
  return values.length === 0 ? null : values[values.length - 1];
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
    p25: nearestRank(finite, 0.25),
    p50: nearestRank(finite, 0.5),
    p75: nearestRank(finite, 0.75),
    p90: nearestRank(finite, 0.9),
    p95: nearestRank(finite, 0.95),
    max: nearestRank(finite, 1),
  };
}

function traceOutcome(terminal) {
  const message = terminal?.message ?? "";
  const state = terminal?.state ?? "";
  if (message.includes("예약 폼에 도착했습니다")) return "FORM_REACHED";
  if (message.includes("알 수 없는 단계")) return "UNSUPPORTED_POST_SLOT";
  if (message.includes("슬롯 클릭 후 후속 예약 화면을 5초 안에")) return "SLOT_TRANSITION_TIMEOUT";
  if (message.includes("후속 예약 화면을 5초 안에")) return "POST_SLOT_TIMEOUT";
  if (message.includes("목표 월 또는 날짜 선택 상태")) return "DATE_PREPARATION_FAILURE";
  if (message.includes("예약하기 클릭 후 달력 화면")
    || message.includes("예약하기 버튼을 찾을 수 없습니다")) return "ENTRY_FAILURE";
  if (state === "STOPPED" && message.includes("설정한 식당을 벗어났습니다")) return "NAVIGATION_STOP";
  if (state === "STOPPED" && message.includes("사용자가 실행을 중지했습니다")) return "USER_STOPPED";
  return "UNCLASSIFIED";
}

function counts(values, key) {
  return Object.fromEntries([...new Set(values.map((value) => value[key]))]
    .sort()
    .map((name) => [name, values.filter((value) => value[key] === name).length]));
}

function aggregate(runs) {
  const matching = runs.filter((run) => run.matchingBodyCount > 0);
  const populated = runs.filter((run) => run.populatedBodyCount > 0);
  const accepted = runs.filter((run) => run.wakeAcceptedCount > 0);
  const clicked = runs.filter((run) => run.clickOpenDeltaMs !== null);
  const wakeResults = runs.flatMap((run) => run.wakeResults);
  const timing = (scope) => ({
    openToDetectMs: distribution(scope.map((run) => run.detectOpenDeltaMs)),
    openToClickMs: distribution(scope.map((run) => run.clickOpenDeltaMs)),
    targetClickToDetectMs: distribution(scope.map((run) => run.targetClickToDetectMs)),
    detectToDispatchMs: distribution(scope.map((run) => run.detectToDispatchMs)),
  });
  return {
    runCount: runs.length,
    droppedZeroCount: runs.filter((run) => run.droppedCount === 0).length,
    seqCompleteCount: runs.filter((run) => run.seqComplete).length,
    populatedBodyRunCount: populated.length,
    matchingBodyRunCount: matching.length,
    wakeAcceptedRunCount: accepted.length,
    inactiveCycleRunCount: runs.filter((run) => run.inactiveCycleCount > 0).length,
    slotDetectedRunCount: runs.filter((run) => run.detectOpenDeltaMs !== null).length,
    slotClickedRunCount: clicked.length,
    transitionConfirmedRunCount: runs.filter((run) => run.transitionOutcomes.includes("confirmed")).length,
    wakeResultCount: wakeResults.length,
    wakeCandidateFoundCount: wakeResults.filter((result) => result.candidateFound).length,
    wakeFallbackUsedCount: wakeResults.filter((result) => result.fallbackUsed).length,
    traceOutcomes: counts(runs, "traceOutcome"),
    configGroups: counts(runs.map((run) => ({
      key: `${run.config.preOpenLeadMs}/${run.config.toggleIntervalMs}/${run.config.clockSampleCount ?? "legacy"}`,
    })), "key"),
    timing: {
      ...timing(runs),
      responseToDomMs: distribution(wakeResults.map((result) => result.responseToDomMs)),
      bridgeToDomMs: distribution(wakeResults.map((result) => result.bridgeToDomMs)),
      wakeToDomMs: distribution(wakeResults.map((result) => result.wakeToDomMs)),
    },
    byWakePath: {
      accepted: { runCount: accepted.length, timing: timing(accepted) },
      inactiveCycle: {
        runCount: runs.filter((run) => run.inactiveCycleCount > 0).length,
        timing: timing(runs.filter((run) => run.inactiveCycleCount > 0)),
      },
    },
  };
}

async function analyze(file) {
  const rows = parseCsv(await readFile(file, "utf8"));
  const first = rows[0];
  const config = JSON.parse(first.configJson);
  const terminal = last(rows.filter((row) => row.code === "RUN_TERMINATED"));
  const populatedBodies = rows.filter((row) => row.code === "AVAILABILITY_SHADOW"
    && row["attr.phase"] === "body"
    && ["EXACT", "STRONG"].includes(row["attr.correlationQuality"])
    && row["attr.classification"] === "POPULATED");
  const matchingBodies = populatedBodies.filter((row) => row["attr.selectedMinutes"] !== "");
  const detected = last(rows.filter((row) => row.code === "STATE_CHANGED"
    && row["attr.timingStage"] === "slot_detected"));
  const clicked = last(rows.filter((row) => row.code === "STATE_CHANGED"
    && row["attr.timingStage"] === "slot_click_dispatched"));
  const transitionOutcomes = [...new Set(rows.map((row) => row["attr.slotTransitionOutcome"]).filter(Boolean))];
  const wakeResults = rows.filter((row) => row.code === "AVAILABILITY_SHADOW"
      && row["attr.phase"] === "wake_result")
    .map((row) => ({
      cycle: number(row["attr.cycle"]),
      candidateFound: row["attr.wakeCandidateFound"] === "true",
      fallbackUsed: row["attr.wakeFallbackUsed"] === "true",
      scanCount: number(row["attr.wakeScanCount"]),
      bodyToWakeMs: number(row["attr.bodyToWakeMs"]),
      responseToDomMs: number(row["attr.responseToDomMs"]),
      wakeToDomMs: number(row["attr.wakeToDomMs"]),
    }))
    .map((result) => ({
      ...result,
      bridgeToDomMs: result.bodyToWakeMs === null || result.wakeToDomMs === null
        ? null
        : result.bodyToWakeMs + result.wakeToDomMs,
    }));
  const seq = rows.map((row) => number(row.seq)).filter((value) => value !== null);
  const seqComplete = seq.length === Number(first.eventCount)
    && seq.every((value, index) => value === index + 1);
  const runDirectory = path.basename(path.dirname(file));
  const date = path.basename(path.dirname(path.dirname(file)));
  const selectedMinutes = number(last(rows.filter((row) => row.code === "SLOT_CLICKED"))?.["attr.slotMinutes"]);
  const slotWithinRange = selectedMinutes === null || (
    selectedMinutes >= config.timeRange.startMinutes && selectedMinutes <= config.timeRange.endMinutes
  );
  return {
    date,
    runDirectory,
    runId: first.runId,
    restaurant: new URL(first.targetUrl).pathname.split("/").filter(Boolean).at(-1),
    reservationDate: first.reservationDate,
    extensionVersion: first.extensionVersion,
    finalState: first.finalState,
    eventCount: Number(first.eventCount),
    droppedCount: Number(first.droppedCount),
    seqComplete,
    config: {
      preOpenLeadMs: config.preOpenLeadMs,
      toggleIntervalMs: config.toggleIntervalMs,
      clockSampleCount: config.clockSampleCount ?? null,
      personCount: config.personCount,
      timeRange: config.timeRange,
    },
    traceOutcome: traceOutcome(terminal),
    terminalMessage: terminal?.message ?? null,
    populatedBodyCount: populatedBodies.length,
    matchingBodyCount: matchingBodies.length,
    wakeAcceptedCount: matchingBodies.filter((row) => row["attr.wakeAccepted"] === "true").length,
    inactiveCycleCount: matchingBodies.filter((row) => row["attr.wakeDiscardReason"] === "inactive_cycle").length,
    wakeResults,
    transitionOutcomes,
    detectOpenDeltaMs: number(detected?.["attr.openDeltaMs"]),
    clickOpenDeltaMs: number(clicked?.["attr.openDeltaMs"]),
    targetClickToDetectMs: detected === null
      || number(detected["attr.openDeltaMs"]) === null
      || number(detected["attr.targetOpenDeltaMs"]) === null
      ? null
      : number(detected["attr.openDeltaMs"]) - number(detected["attr.targetOpenDeltaMs"]),
    detectToDispatchMs: detected === null || clicked === null
      ? null
      : number(clicked["attr.openDeltaMs"]) - number(detected["attr.openDeltaMs"]),
    selectedMinutes,
    slotWithinRange,
  };
}

const files = (await findRunFiles(root)).sort();
const runs = await Promise.all(files.map(analyze));
const result = {
  generatedFrom: path.relative(process.cwd(), root),
  generatedAt: new Date().toISOString(),
  methodology: {
    percentile: "nearest-rank",
    matchingBody: "EXACT|STRONG + POPULATED + selectedMinutes != null",
    warning: "attr.matchesTarget is intentionally not used because it only reflects correlation quality.",
  },
  all: aggregate(runs),
  byDate: Object.fromEntries([...new Set(runs.map((run) => run.date))].sort()
    .map((date) => [date, aggregate(runs.filter((run) => run.date === date))])),
  invariants: {
    eventCountAndSeqComplete: runs.every((run) => run.seqComplete),
    droppedZero: runs.every((run) => run.droppedCount === 0),
    clickedSlotsWithinConfiguredRange: runs.every((run) => run.slotWithinRange),
  },
  runs,
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
