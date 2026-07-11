import type { RunEvent } from "../shared/types.js";

export function formatEventTime(timestamp: number): string {
  const date = new Date(timestamp);
  const seconds = date.toLocaleTimeString("ko-KR", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${seconds}.${String(date.getMilliseconds()).padStart(3, "0")}`;
}

function signedMilliseconds(value: number): string {
  const rounded = Math.round(value);
  return `${rounded >= 0 ? "+" : ""}${rounded}ms`;
}

function timingLine(label: string, at: unknown, openDelta: unknown, scheduleDrift?: unknown): string | null {
  if (typeof at !== "number" || typeof openDelta !== "number") return null;
  const schedule = typeof scheduleDrift === "number" ? ` · 계획 ${signedMilliseconds(scheduleDrift)}` : "";
  return `${label} 서버 ${formatEventTime(at)} · 오픈 ${signedMilliseconds(openDelta)}${schedule}`;
}

export function formatEventDetail(event: RunEvent): string {
  const data = event.data;
  const lines: string[] = [];
  const adjacent = timingLine("인접", data?.adjacentTimingServerAtMs, data?.adjacentOpenDeltaMs, data?.adjacentScheduleDriftMs);
  const target = timingLine("목표", data?.targetTimingServerAtMs, data?.targetOpenDeltaMs, data?.targetScheduleDriftMs);
  if (adjacent) lines.push(adjacent);
  if (target) lines.push(target);

  const timingServerAt = typeof data?.timingServerAtMs === "number" ? data.timingServerAtMs : event.serverAt;
  const stageLabel = data?.timingStage === "slot_detected"
    ? "감지"
    : data?.timingStage === "target_date_click"
      ? "목표"
      : "";
  const primary = timingLine(stageLabel, timingServerAt, data?.openDeltaMs, data?.scheduleDriftMs);
  if (primary) lines.push(primary.trimStart());
  if (typeof data?.clockOffsetMs === "number") lines.push(`오프셋 ${Number(data.clockOffsetMs).toFixed(0)}ms`);
  return lines.join("\n");
}

export function formatEventMessage(event: RunEvent): string {
  let message = event.message;
  if (event.data?.postSlotCertainty === "unknown") {
    const title = event.data.dialogTitle || event.data.dialogLabel || "제목 없음";
    const buttons = event.data.dialogButtons || "없음";
    const radios = event.data.dialogRadioCount ?? 0;
    const checkboxes = event.data.dialogCheckboxCount ?? 0;
    const quantities = event.data.dialogQuantityControlCount ?? 0;
    message += ` · 진단: ${title} · 버튼 ${buttons} · radio ${radios} · checkbox ${checkboxes} · quantity ${quantities}`;
  }
  const delta = event.data?.openDeltaMs;
  const timingServerAt = typeof event.data?.timingServerAtMs === "number"
    ? event.data.timingServerAtMs
    : event.serverAt;
  if (timingServerAt === null || typeof delta !== "number") return message;
  const rounded = Math.round(delta);
  const sign = rounded >= 0 ? "+" : "";
  return `${message} · 서버 ${formatEventTime(timingServerAt)} (${sign}${rounded}ms)`;
}
