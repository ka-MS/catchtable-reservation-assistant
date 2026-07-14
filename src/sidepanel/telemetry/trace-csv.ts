import type { TraceEvent, TraceRunRecord } from "../../shared/telemetry/types.js";

const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;

function kst(epochMs: number | null): string {
  if (epochMs === null || !Number.isFinite(epochMs)) return "";
  return new Date(epochMs + KST_OFFSET_MS).toISOString().slice(0, 23).replace("T", " ");
}

function excelText(value: string): string {
  return value === "" ? "" : `="${value}"`;
}

function excelEpoch(epochMs: number | null): string {
  return epochMs === null || !Number.isFinite(epochMs) ? "" : excelText(String(epochMs));
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function shopSlug(run: TraceRunRecord): string {
  try {
    return new URL(run.config.targetUrl).pathname.split("/").filter(Boolean).at(-1) ?? "restaurant";
  } catch {
    return "restaurant";
  }
}

export function traceCsvFilename(run: TraceRunRecord): string {
  const raw = `catchtable_${shopSlug(run)}_${run.config.reservationDate}_${run.runId}.csv`;
  return raw.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function traceCsv(run: TraceRunRecord, events: TraceEvent[]): string {
  const attributeKeys = [...new Set(events.flatMap((event) => Object.keys(event.attributes)))].sort();
  const headers = [
    "runId", "extensionVersion", "startedAtMs", "startedAtKst", "finishedAtMs", "finishedAtKst",
    "finalState", "eventCount", "droppedCount", "targetUrl", "reservationDate", "personCount",
    "openAtMs", "openAtKst", "stopAtMs", "stopAtKst", "timeRangeStartMinutes", "timeRangeEndMinutes",
    "configJson", "seq", "code", "severity", "component", "localAtMs", "localAtKst", "serverAtMs",
    "serverAtKst", "state", "message", "errorName", "errorMessage", "errorStack",
    ...attributeKeys.map((key) => `attr.${key}`),
  ];
  const rows = events.map((event) => [
    run.runId,
    run.extensionVersion,
    excelEpoch(run.startedAt),
    excelText(kst(run.startedAt)),
    excelEpoch(run.finishedAt),
    excelText(kst(run.finishedAt)),
    run.finalState,
    run.eventCount,
    run.droppedCount,
    run.config.targetUrl,
    run.config.reservationDate,
    run.config.personCount,
    excelEpoch(run.config.openAtMs),
    excelText(kst(run.config.openAtMs)),
    excelEpoch(run.config.stopAtMs),
    excelText(kst(run.config.stopAtMs)),
    run.config.timeRange.startMinutes,
    run.config.timeRange.endMinutes,
    JSON.stringify(run.config),
    event.seq,
    event.code,
    event.severity,
    event.component,
    excelEpoch(event.localAt),
    excelText(kst(event.localAt)),
    excelEpoch(event.serverAt),
    excelText(kst(event.serverAt)),
    event.state,
    event.message,
    event.error?.name,
    event.error?.message,
    event.error?.stack,
    ...attributeKeys.map((key) => event.attributes[key]),
  ]);
  return `\uFEFF${[headers, ...rows].map((row) => row.map(cell).join(",")).join("\r\n")}`;
}
