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
  const delta = event.data?.openDeltaMs;
  const timingServerAt = typeof event.data?.timingServerAtMs === "number"
    ? event.data.timingServerAtMs
    : event.serverAt;
  if (timingServerAt === null || typeof delta !== "number") return event.message;
  const rounded = Math.round(delta);
  const sign = rounded >= 0 ? "+" : "";
  return `${event.message} · 서버 ${formatEventTime(timingServerAt)} (${sign}${rounded}ms)`;
}
