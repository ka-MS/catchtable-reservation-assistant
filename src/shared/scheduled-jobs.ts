import { normalizeReservationConfig, validateReservationConfig } from "./config.js";
import type { ReservationConfig, ScheduledJob, ScheduledJobResult, ScheduledJobStatus } from "./types.js";

export const SCHEDULED_JOB_LIMIT = 10;
export const FINISHED_JOB_KEEP = 20;
export const ALARM_LEAD_MS = 75_000;

const STATUSES = new Set<ScheduledJobStatus>(["scheduled", "running", "finished", "missed"]);

function isActive(job: ScheduledJob): boolean {
  return job.status === "scheduled" || job.status === "running";
}

export function occupancyWindow(config: ReservationConfig): { startMs: number; endMs: number } {
  return { startMs: config.openAtMs - ALARM_LEAD_MS, endMs: config.stopAtMs };
}

export function findScheduleConflict(
  jobs: ScheduledJob[],
  candidate: ReservationConfig,
  excludeId: string | null,
): ScheduledJob | null {
  const window = occupancyWindow(candidate);
  return jobs.find((job) => {
    if (job.id === excludeId || !isActive(job)) return false;
    const other = occupancyWindow(job.config);
    return other.startMs < window.endMs && window.startMs < other.endMs;
  }) ?? null;
}

function sortJobs(jobs: ScheduledJob[]): ScheduledJob[] {
  return [...jobs].sort((left, right) => left.config.openAtMs - right.config.openAtMs);
}

function pruneFinished(jobs: ScheduledJob[]): ScheduledJob[] {
  const done = jobs.filter((job) => !isActive(job)).sort((left, right) => right.updatedAt - left.updatedAt);
  const keep = new Set(done.slice(0, FINISHED_JOB_KEEP).map((job) => job.id));
  return jobs.filter((job) => isActive(job) || keep.has(job.id));
}

export type ScheduleJobOutcome =
  | { ok: true; jobs: ScheduledJob[]; job: ScheduledJob }
  | { ok: false; error: string };

export function scheduleJob(
  jobs: ScheduledJob[],
  input: { id: string | null; config: ReservationConfig },
  metadata: { createId: () => string; nowMs: number },
): ScheduleJobOutcome {
  const errors = validateReservationConfig(input.config, metadata.nowMs);
  if (input.config.entryMode !== "auto") errors.push("예약 작업은 자동 페이지 준비 방식만 지원합니다.");
  if (errors.length > 0) return { ok: false, error: errors.join(" ") };
  const existing = input.id === null ? undefined : jobs.find((job) => job.id === input.id);
  if (input.id !== null && !existing) return { ok: false, error: "수정할 예약 작업을 찾을 수 없습니다." };
  if (existing?.status === "running") return { ok: false, error: "실행 중인 작업은 수정할 수 없습니다." };
  const conflict = findScheduleConflict(jobs, input.config, input.id);
  if (conflict) {
    return { ok: false, error: `실행 시간이 겹치는 작업이 있습니다: ${conflict.config.reservationDate} 예약.` };
  }
  const others = jobs.filter((job) => job.id !== input.id);
  if (others.filter(isActive).length >= SCHEDULED_JOB_LIMIT) {
    return { ok: false, error: `예약 작업은 최대 ${SCHEDULED_JOB_LIMIT}개까지 등록할 수 있습니다.` };
  }
  const job: ScheduledJob = {
    id: existing?.id ?? metadata.createId(),
    createdAt: existing?.createdAt ?? metadata.nowMs,
    updatedAt: metadata.nowMs,
    status: "scheduled",
    config: input.config,
    result: null,
  };
  return { ok: true, jobs: sortJobs(pruneFinished([...others, job])), job };
}

export type RemoveJobOutcome =
  | { ok: true; jobs: ScheduledJob[] }
  | { ok: false; error: string };

export function removeScheduledJob(jobs: ScheduledJob[], id: string): RemoveJobOutcome {
  const target = jobs.find((job) => job.id === id);
  if (!target) return { ok: false, error: "삭제할 예약 작업을 찾을 수 없습니다." };
  if (target.status === "running") return { ok: false, error: "실행 중인 작업은 먼저 중지한 뒤 삭제하세요." };
  return { ok: true, jobs: jobs.filter((job) => job.id !== id) };
}

function transition(jobs: ScheduledJob[], id: string, change: Partial<ScheduledJob>, nowMs: number): ScheduledJob[] {
  return jobs.map((job) => (job.id === id ? { ...job, ...change, updatedAt: nowMs } : job));
}

export function markJobRunning(jobs: ScheduledJob[], id: string, nowMs: number): ScheduledJob[] {
  return transition(jobs, id, { status: "running" }, nowMs);
}

export function markJobMissed(jobs: ScheduledJob[], id: string, nowMs: number): ScheduledJob[] {
  return transition(jobs, id, { status: "missed" }, nowMs);
}

export function finishJob(jobs: ScheduledJob[], id: string, result: ScheduledJobResult, nowMs: number): ScheduledJob[] {
  return transition(jobs, id, { status: "finished", result }, nowMs);
}

export function sanitizeScheduledJobs(value: unknown): ScheduledJob[] {
  if (!Array.isArray(value)) return [];
  const valid = value.flatMap((item): ScheduledJob[] => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<ScheduledJob>;
    if (typeof candidate.id !== "string"
      || !Number.isFinite(candidate.createdAt)
      || !Number.isFinite(candidate.updatedAt)
      || !STATUSES.has(candidate.status as ScheduledJobStatus)
      || typeof candidate.config !== "object"
      || candidate.config === null) {
      return [];
    }
    try {
      const config = normalizeReservationConfig(candidate.config as ReservationConfig);
      if (validateReservationConfig(config, Number.NEGATIVE_INFINITY).length > 0) return [];
      const result = candidate.result;
      const validResult = result && typeof result === "object"
        && typeof (result as ScheduledJobResult).state === "string"
        && typeof (result as ScheduledJobResult).message === "string"
        && Number.isFinite((result as ScheduledJobResult).finishedAt)
        ? result as ScheduledJobResult
        : null;
      return [{
        id: candidate.id,
        createdAt: candidate.createdAt as number,
        updatedAt: candidate.updatedAt as number,
        status: candidate.status as ScheduledJobStatus,
        config,
        result: validResult,
      }];
    } catch {
      return [];
    }
  });
  return sortJobs(valid);
}

export interface ReconcilePlan {
  jobs: ScheduledJob[];
  alarms: Array<{ jobId: string; whenMs: number }>;
  missed: ScheduledJob[];
}

export function reconcileJobs(jobs: ScheduledJob[], nowMs: number): ReconcilePlan {
  const next: ScheduledJob[] = [];
  const alarms: Array<{ jobId: string; whenMs: number }> = [];
  const missed: ScheduledJob[] = [];
  for (const job of jobs) {
    if (!isActive(job)) {
      next.push(job);
      continue;
    }
    if (nowMs >= job.config.stopAtMs) {
      const missedJob: ScheduledJob = { ...job, status: "missed", updatedAt: nowMs };
      next.push(missedJob);
      missed.push(missedJob);
      continue;
    }
    next.push(job.status === "running" ? { ...job, status: "scheduled", updatedAt: nowMs } : job);
    alarms.push({ jobId: job.id, whenMs: Math.max(nowMs, job.config.openAtMs - ALARM_LEAD_MS) });
  }
  return { jobs: next, alarms, missed };
}
