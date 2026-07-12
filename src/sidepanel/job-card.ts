import type { RunState, ScheduledJob } from "../shared/types.js";

export interface JobCardModel {
  title: string;
  summary: string;
  openAtText: string;
  createdAtText: string;
  statusLabel: string;
  statusTone: "scheduled" | "running" | "success" | "error" | "missed";
  detail: string;
  canEdit: boolean;
  canDelete: boolean;
  showLog: boolean;
}

const SUCCESS_STATES = new Set<RunState>(["COMPLETED", "HANDED_OFF", "DRY_RUN_COMPLETED"]);

function shopSlug(targetUrl: string): string {
  try {
    const segments = new URL(targetUrl).pathname.split("/").filter(Boolean);
    return segments.at(-1) ?? targetUrl;
  } catch {
    return targetUrl;
  }
}

function minutesToLabel(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function dateLabel(value: string): string {
  const [, month, day] = value.split("-");
  return `${Number(month)}월 ${Number(day)}일`;
}

function dateTimeLabel(ms: number): string {
  const date = new Date(ms);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function remaining(openAtMs: number, nowMs: number): string {
  const diff = openAtMs - nowMs;
  if (diff < 60_000) return "곧 오픈";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `오픈까지 ${minutes}분`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `오픈까지 ${hours}시간 ${minutes % 60}분`;
  return `오픈까지 ${Math.floor(hours / 24)}일 ${hours % 24}시간`;
}

export function jobCardModel(job: ScheduledJob, nowMs: number): JobCardModel {
  const config = job.config;
  const base = {
    title: shopSlug(config.targetUrl),
    summary: `${dateLabel(config.reservationDate)} · ${config.personCount}명 · ${minutesToLabel(config.timeRange.startMinutes)}–${minutesToLabel(config.timeRange.endMinutes)}`,
    openAtText: `오픈 ${dateTimeLabel(config.openAtMs)}`,
    createdAtText: `등록 ${dateTimeLabel(job.createdAt)}`,
  };
  if (job.status === "running") {
    return { ...base, statusLabel: "실행 중", statusTone: "running", detail: "예약을 진행하고 있습니다.", canEdit: false, canDelete: false, showLog: true };
  }
  if (job.status === "missed") {
    return { ...base, statusLabel: "놓침", statusTone: "missed", detail: "실행 시각을 놓쳤습니다.", canEdit: true, canDelete: true, showLog: false };
  }
  if (job.status === "finished") {
    const state = job.result?.state ?? "FAILED";
    const success = SUCCESS_STATES.has(state);
    return {
      ...base,
      statusLabel: success ? "완료" : state === "STOPPED" ? "중지" : "실패",
      statusTone: success ? "success" : "error",
      detail: job.result?.message ?? "",
      canEdit: true,
      canDelete: true,
      showLog: false,
    };
  }
  return { ...base, statusLabel: "예정", statusTone: "scheduled", detail: remaining(config.openAtMs, nowMs), canEdit: true, canDelete: true, showLog: false };
}
