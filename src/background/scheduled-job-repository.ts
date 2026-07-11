import {
  removeScheduledJob,
  sanitizeScheduledJobs,
  scheduleJob,
  type RemoveJobOutcome,
  type ScheduleJobOutcome,
} from "../shared/scheduled-jobs.js";
import type { ReservationConfig, ScheduledJob } from "../shared/types.js";

interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}

const STORAGE_KEY = "scheduledJobs";

export class ScheduledJobRepository {
  constructor(
    private readonly storage: StorageArea,
    private readonly createId: () => string,
    private readonly now: () => number,
  ) {}

  async read(): Promise<ScheduledJob[]> {
    const stored = await this.storage.get(STORAGE_KEY);
    return sanitizeScheduledJobs(stored[STORAGE_KEY]);
  }

  async write(jobs: ScheduledJob[]): Promise<void> {
    await this.storage.set({ [STORAGE_KEY]: jobs });
  }

  async schedule(input: { id: string | null; config: ReservationConfig }): Promise<ScheduleJobOutcome> {
    const outcome = scheduleJob(await this.read(), input, { createId: this.createId, nowMs: this.now() });
    if (outcome.ok) await this.write(outcome.jobs);
    return outcome;
  }

  async remove(id: string): Promise<RemoveJobOutcome> {
    const outcome = removeScheduledJob(await this.read(), id);
    if (outcome.ok) await this.write(outcome.jobs);
    return outcome;
  }

  async update(mutator: (jobs: ScheduledJob[]) => ScheduledJob[]): Promise<ScheduledJob[]> {
    const next = mutator(await this.read());
    await this.write(next);
    return next;
  }
}
