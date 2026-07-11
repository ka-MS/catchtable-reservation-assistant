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
