import type { RunEvent, ScheduledJob } from "../shared/types.js";

export interface JobListModel {
  active: ScheduledJob[];
  done: ScheduledJob[];
  doneLabel: string;
}

export function jobListModel(jobs: ScheduledJob[]): JobListModel {
  const active = jobs.filter((job) => job.status === "scheduled" || job.status === "running");
  const done = jobs
    .filter((job) => job.status === "finished" || job.status === "missed")
    .sort((left, right) => right.updatedAt - left.updatedAt);
  return { active, done, doneLabel: `완료된 작업 ${done.length}개` };
}

export interface MiniLogModel {
  entries: RunEvent[];
  emptyText: string | null;
}

export function miniLogModel(events: RunEvent[]): MiniLogModel {
  const entries = events.slice(-3).reverse();
  return { entries, emptyText: entries.length === 0 ? "아직 실행 기록이 없습니다." : null };
}
