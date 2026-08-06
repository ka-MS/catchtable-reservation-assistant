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

/** 폼 인계 사유를 한 줄로 분해한다 — 어느 비교가 깨졌는지 로그에서 바로 읽기 위한 것이다. */
function formIntentLine(data: RunEvent["data"]): string | null {
  if (typeof data?.formUnknownCode !== "string") return null;
  const mark = (label: string, value: unknown): string =>
    typeof value === "boolean" ? `${label} ${value ? "일치" : "불일치"}` : "";
  const parts = [
    mark("매장", data.formShopNameMatch),
    mark("날짜", data.formDateMatch),
    mark("인원", data.formPersonMatch),
    typeof data.formFinalButtonCount === "number" ? `최종버튼 ${data.formFinalButtonCount}개` : "",
    typeof data.formAmounts === "string" && data.formAmounts ? `금액 ${data.formAmounts}` : "",
  ].filter(Boolean);
  return parts.length > 0 ? `폼 판정(${data.formUnknownCode}): ${parts.join(" · ")}` : null;
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
    : data?.timingStage === "slot_click_dispatched"
      ? "클릭"
    : data?.timingStage === "target_date_click"
      ? "목표"
      : "";
  const primary = timingLine(stageLabel, timingServerAt, data?.openDeltaMs, data?.scheduleDriftMs);
  if (primary) lines.push(primary.trimStart());
  if (typeof data?.clockOffsetMs === "number") lines.push(`오프셋 ${Number(data.clockOffsetMs).toFixed(0)}ms`);
  if (typeof data?.snapshotFingerprint === "string") {
    // 예약 폼처럼 dialog가 없는 화면은 heading이 유일한 제목 단서다. 이게 없으면
    // 매장명이 있는데도 "제목 없음"으로 표시된다.
    const firstHeading = String(data.snapshotHeadings ?? "").split(" | ")[0];
    const title = data.snapshotDialogTitle || data.snapshotDialogLabel || firstHeading || "제목 없음";
    const buttons = data.snapshotButtons || "없음";
    const snippet = typeof data.snapshotTextSnippet === "string" && data.snapshotTextSnippet
      ? ` · "${String(data.snapshotTextSnippet).slice(0, 40)}"`
      : "";
    lines.push(`스냅샷: ${title} · 버튼 ${buttons}${snippet}`);
  }
  const intentLine = formIntentLine(data);
  if (intentLine) lines.push(intentLine);
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
