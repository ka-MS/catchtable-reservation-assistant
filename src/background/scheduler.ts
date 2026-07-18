import {
  ALARM_LEAD_MS,
  finishJob,
  markJobMissed,
  markJobRunning,
  reconcileJobs,
} from "../shared/scheduled-jobs.js";
import type { CommandResponse, ReservationConfig, RunState, ScheduledJob } from "../shared/types.js";
import type { ScheduledJobRepository } from "./scheduled-job-repository.js";

export const JOB_ALARM_PREFIX = "job:";

export type LaunchResult =
  | { ok: true }
  | { ok: false; kind: "busy" | "failed"; error: string };

interface JobSchedulerDependencies {
  repository: ScheduledJobRepository;
  alarms: {
    create(name: string, info: { when: number }): void;
    clear(name: string): Promise<boolean>;
  };
  launch(job: ScheduledJob): Promise<LaunchResult>;
  notify(message: string): void;
  now(): number;
}

export class JobScheduler {
  constructor(private readonly dependencies: JobSchedulerDependencies) {}

  private alarmAt(config: ReservationConfig): number {
    return Math.max(this.dependencies.now(), config.openAtMs - ALARM_LEAD_MS);
  }

  async schedule(id: string | null, config: ReservationConfig): Promise<CommandResponse> {
    const outcome = await this.dependencies.repository.schedule({ id, config });
    if (!outcome.ok) return { ok: false, error: outcome.error };
    this.dependencies.alarms.create(`${JOB_ALARM_PREFIX}${outcome.job.id}`, { when: this.alarmAt(config) });
    return { ok: true };
  }

  async delete(id: string): Promise<CommandResponse> {
    const outcome = await this.dependencies.repository.remove(id);
    if (!outcome.ok) return { ok: false, error: outcome.error };
    await this.dependencies.alarms.clear(`${JOB_ALARM_PREFIX}${id}`);
    return { ok: true };
  }

  async reconcile(): Promise<void> {
    const plan = reconcileJobs(await this.dependencies.repository.read(), this.dependencies.now());
    await this.dependencies.repository.write(plan.jobs);
    for (const alarm of plan.alarms) {
      this.dependencies.alarms.create(`${JOB_ALARM_PREFIX}${alarm.jobId}`, { when: alarm.whenMs });
    }
    for (const job of plan.missed) {
      this.dependencies.notify(`${job.config.reservationDate} 예약 작업이 실행되지 못했습니다.`);
    }
  }

  async onAlarm(name: string): Promise<void> {
    if (!name.startsWith(JOB_ALARM_PREFIX)) return;
    const id = name.slice(JOB_ALARM_PREFIX.length);
    const nowMs = this.dependencies.now();
    const jobs = await this.dependencies.repository.read();
    const job = jobs.find((item) => item.id === id);
    if (!job || job.status !== "scheduled") return;
    if (nowMs >= job.config.stopAtMs) {
      await this.dependencies.repository.write(markJobMissed(jobs, id, nowMs));
      this.dependencies.notify(`${job.config.reservationDate} 예약 작업이 실행 시각을 놓쳤습니다.`);
      return;
    }
    await this.dependencies.repository.write(markJobRunning(jobs, id, nowMs));
    const result = await this.dependencies.launch(job);
    if (result.ok) return;
    if (result.kind === "busy") {
      await this.dependencies.repository.update((current) => markJobMissed(current, id, this.dependencies.now()));
      this.dependencies.notify(`${job.config.reservationDate} 예약 작업을 시작하지 못했습니다: ${result.error}`);
      return;
    }
    await this.dependencies.repository.update((current) => finishJob(current, id, {
      state: "FAILED",
      message: result.error,
      finishedAt: this.dependencies.now(),
    }, this.dependencies.now()));
    this.dependencies.notify(`${job.config.reservationDate} 예약 작업 시작에 실패했습니다: ${result.error}`);
  }

}
