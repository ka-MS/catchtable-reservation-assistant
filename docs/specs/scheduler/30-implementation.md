# 예약 작업 스케줄러 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 여러 예약 작업을 저장하고 `chrome.alarms`로 오픈 75초 전에 무인 실행한다.

**Architecture:** 순수 로직(`shared/scheduled-jobs.ts`) → storage 저장소(`background/scheduled-job-repository.ts`) → 알람·실행 오케스트레이션(`background/scheduler.ts`) → Chrome API 배선(`background/index.ts`) → 사이드패널 3화면(홈/폼/실행) 순으로 쌓는다. 정각 정밀 타이밍은 기존 Content Script 오케스트레이터가 그대로 담당한다.

**Tech Stack:** TypeScript(MV3 확장), node:test, chrome.alarms/tabs/windows/storage.

## Global Constraints

- 설계 문서: `docs/specs/scheduler/20-design.md`
- 병합 게이트: WSL에서 `npm run check` + `git diff --check` 통과 (`wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check"`)
- 스케줄 작업의 `entryMode`는 `auto`만 허용
- `ALARM_LEAD_MS = 75_000`, 활성 작업 한도 10개
- 실행 탭은 활성 탭 + 포커스 창으로 연다(타이머 스로틀링 회피)
- 기존 스타일 준수: 한국어 오류 메시지, 의존성 주입 패턴, 순수 함수 우선

---

### Task 1: 공유 데이터 모델과 순수 함수

**Files:**
- Modify: `src/shared/types.ts`
- Create: `src/shared/scheduled-jobs.ts`
- Test: `tests/scheduled-jobs.test.mjs`

**Interfaces:**
- Produces: `ScheduledJob`, `ScheduledJobStatus`, `ScheduledJobResult`, `ActiveRun.scheduledJobId?`, `PanelCommand`의 `SCHEDULE_JOB`/`DELETE_JOB`, `SCHEDULED_JOB_LIMIT`, `ALARM_LEAD_MS`, `occupancyWindow`, `findScheduleConflict`, `scheduleJob`, `removeScheduledJob`, `markJobRunning`, `markJobMissed`, `finishJob`, `sanitizeScheduledJobs`, `reconcileJobs`

- [ ] **Step 1: types.ts에 타입 추가**

`SavedConfig` 뒤에 추가:

```ts
export type ScheduledJobStatus = "scheduled" | "running" | "finished" | "missed";

export interface ScheduledJobResult {
  state: RunState;
  message: string;
  finishedAt: number;
}

export interface ScheduledJob {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: ScheduledJobStatus;
  config: ReservationConfig;
  result: ScheduledJobResult | null;
}
```

`ActiveRun`에 `scheduledJobId?: string;` 추가. `PanelCommand`에 다음 두 variant 추가:

```ts
  | { type: "SCHEDULE_JOB"; id: string | null; config: ReservationConfig }
  | { type: "DELETE_JOB"; id: string }
```

- [ ] **Step 2: 실패하는 테스트 작성** — `tests/scheduled-jobs.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  ALARM_LEAD_MS,
  findScheduleConflict,
  finishJob,
  markJobMissed,
  markJobRunning,
  reconcileJobs,
  removeScheduledJob,
  sanitizeScheduledJobs,
  scheduleJob,
} from "../dist/shared/scheduled-jobs.js";

const BASE_OPEN = 1_800_000_000_000;

function config(overrides = {}) {
  return {
    targetUrl: "https://app.catchtable.co.kr/ct/shop/test",
    openAtMs: BASE_OPEN,
    reservationDate: "2026-08-01",
    personCount: 2,
    timeRange: { startMinutes: 1080, endMinutes: 1200 },
    priorityTimes: [],
    postSlotEnabled: false,
    tablePreference: "any",
    menuKeyword: "",
    stopAtMs: BASE_OPEN + 600_000,
    entryMode: "auto",
    dryRun: false,
    preOpenLeadMs: 3_000,
    toggleIntervalMs: 150,
    clockSampleCount: 9,
    ...overrides,
  };
}

function job(overrides = {}) {
  return {
    id: "job-1",
    createdAt: 1,
    updatedAt: 1,
    status: "scheduled",
    config: config(),
    result: null,
    ...overrides,
  };
}

const NOW = BASE_OPEN - 3_600_000;

test("scheduleJob creates a new scheduled job", () => {
  const outcome = scheduleJob([], { id: null, config: config() }, { createId: () => "new-id", nowMs: NOW });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.job.id, "new-id");
  assert.equal(outcome.job.status, "scheduled");
  assert.equal(outcome.jobs.length, 1);
});

test("scheduleJob rejects prepared entry mode", () => {
  const outcome = scheduleJob([], { id: null, config: config({ entryMode: "prepared" }) }, { createId: () => "x", nowMs: NOW });
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /자동 페이지 준비/);
});

test("scheduleJob rejects overlapping occupancy windows", () => {
  const existing = job();
  const overlapping = config({ openAtMs: BASE_OPEN + 60_000, stopAtMs: BASE_OPEN + 660_000 });
  const outcome = scheduleJob([existing], { id: null, config: overlapping }, { createId: () => "x", nowMs: NOW });
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /겹치/);
});

test("scheduleJob allows disjoint windows", () => {
  const existing = job();
  const later = config({ openAtMs: BASE_OPEN + 700_000 + ALARM_LEAD_MS, stopAtMs: BASE_OPEN + 1_400_000 });
  const outcome = scheduleJob([existing], { id: null, config: later }, { createId: () => "x", nowMs: NOW });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.jobs.length, 2);
});

test("scheduleJob updates an existing job in place", () => {
  const existing = job();
  const outcome = scheduleJob([existing], { id: "job-1", config: config({ personCount: 4 }) }, { createId: () => "x", nowMs: NOW });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.job.id, "job-1");
  assert.equal(outcome.job.config.personCount, 4);
  assert.equal(outcome.jobs.length, 1);
});

test("scheduleJob rejects editing a running job", () => {
  const outcome = scheduleJob([job({ status: "running" })], { id: "job-1", config: config() }, { createId: () => "x", nowMs: NOW });
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /실행 중/);
});

test("scheduleJob enforces the active job limit", () => {
  const jobs = Array.from({ length: 10 }, (_, index) => job({
    id: `job-${index}`,
    config: config({
      openAtMs: BASE_OPEN + index * 1_000_000,
      stopAtMs: BASE_OPEN + index * 1_000_000 + 600_000,
    }),
  }));
  const extra = config({ openAtMs: BASE_OPEN + 20_000_000, stopAtMs: BASE_OPEN + 20_600_000 });
  const outcome = scheduleJob(jobs, { id: null, config: extra }, { createId: () => "x", nowMs: NOW });
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /최대 10개/);
});

test("removeScheduledJob rejects running jobs and removes others", () => {
  const running = removeScheduledJob([job({ status: "running" })], "job-1");
  assert.equal(running.ok, false);
  const done = removeScheduledJob([job({ status: "finished" })], "job-1");
  assert.equal(done.ok, true);
  assert.equal(done.jobs.length, 0);
});

test("status helpers transition a single job", () => {
  const running = markJobRunning([job()], "job-1", 50);
  assert.equal(running[0].status, "running");
  const missed = markJobMissed([job()], "job-1", 60);
  assert.equal(missed[0].status, "missed");
  const finished = finishJob([job({ status: "running" })], "job-1", { state: "HANDED_OFF", message: "폼 도착", finishedAt: 70 });
  assert.equal(finished[0].status, "finished");
  assert.equal(finished[0].result.state, "HANDED_OFF");
});

test("sanitizeScheduledJobs drops malformed entries", () => {
  const good = job();
  const sanitized = sanitizeScheduledJobs([good, null, { id: 3 }, { ...good, id: "bad", status: "unknown" }]);
  assert.deepEqual(sanitized.map((item) => item.id), ["job-1"]);
});

test("reconcileJobs reschedules future jobs and marks passed ones missed", () => {
  const future = job();
  const passed = job({ id: "job-2", status: "running", config: config({ openAtMs: NOW - 700_000, stopAtMs: NOW - 100_000 }) });
  const imminent = job({ id: "job-3", config: config({ openAtMs: NOW + 10_000, stopAtMs: NOW + 610_000 }) });
  const plan = reconcileJobs([future, passed, imminent], NOW);
  assert.deepEqual(plan.alarms, [
    { jobId: "job-1", whenMs: BASE_OPEN - ALARM_LEAD_MS },
    { jobId: "job-3", whenMs: NOW },
  ]);
  assert.deepEqual(plan.missed.map((item) => item.id), ["job-2"]);
  assert.equal(plan.jobs.find((item) => item.id === "job-2").status, "missed");
});
```

- [ ] **Step 3: 실행해 실패 확인**

Run: `wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run build && node --test tests/scheduled-jobs.test.mjs"`
Expected: FAIL (`Cannot find module .../dist/shared/scheduled-jobs.js`)

- [ ] **Step 4: `src/shared/scheduled-jobs.ts` 구현**

```ts
import { validateReservationConfig } from "./config.js";
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
      const config = candidate.config as ReservationConfig;
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
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run build && node --test tests/scheduled-jobs.test.mjs"`
Expected: PASS (전체)

- [ ] **Step 6: Commit** — `feat: add scheduled job model and pure scheduling logic`

---

### Task 2: ScheduledJobRepository

**Files:**
- Create: `src/background/scheduled-job-repository.ts`
- Test: `tests/scheduled-job-repository.test.mjs`

**Interfaces:**
- Consumes: Task 1의 순수 함수 전부
- Produces: `ScheduledJobRepository` 클래스 — `read(): Promise<ScheduledJob[]>`, `write(jobs): Promise<void>`, `schedule(input): Promise<ScheduleJobOutcome>`, `remove(id): Promise<RemoveJobOutcome>`, `update(mutator): Promise<ScheduledJob[]>`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/scheduled-job-repository.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";
import { ScheduledJobRepository } from "../dist/background/scheduled-job-repository.js";

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get: async (key) => ({ [key]: data[key] }),
    set: async (values) => Object.assign(data, values),
  };
}

const OPEN = 1_800_000_000_000;

function config(overrides = {}) {
  return {
    targetUrl: "https://app.catchtable.co.kr/ct/shop/test",
    openAtMs: OPEN,
    reservationDate: "2026-08-01",
    personCount: 2,
    timeRange: { startMinutes: 1080, endMinutes: 1200 },
    priorityTimes: [],
    postSlotEnabled: false,
    tablePreference: "any",
    menuKeyword: "",
    stopAtMs: OPEN + 600_000,
    entryMode: "auto",
    dryRun: false,
    preOpenLeadMs: 3_000,
    toggleIntervalMs: 150,
    clockSampleCount: 9,
    ...overrides,
  };
}

test("schedule persists a new job and read returns it", async () => {
  const storage = memoryStorage();
  const repository = new ScheduledJobRepository(storage, () => "id-1", () => OPEN - 3_600_000);
  const outcome = await repository.schedule({ id: null, config: config() });
  assert.equal(outcome.ok, true);
  const jobs = await repository.read();
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, "id-1");
});

test("remove deletes a stored job", async () => {
  const storage = memoryStorage();
  const repository = new ScheduledJobRepository(storage, () => "id-1", () => OPEN - 3_600_000);
  await repository.schedule({ id: null, config: config() });
  const outcome = await repository.remove("id-1");
  assert.equal(outcome.ok, true);
  assert.deepEqual(await repository.read(), []);
});

test("update applies a mutator over sanitized jobs", async () => {
  const storage = memoryStorage({ scheduledJobs: "corrupted" });
  const repository = new ScheduledJobRepository(storage, () => "id-1", () => OPEN - 3_600_000);
  const jobs = await repository.update((items) => items);
  assert.deepEqual(jobs, []);
});
```

- [ ] **Step 2: 실행해 실패 확인**

Run: `wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run build && node --test tests/scheduled-job-repository.test.mjs"`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현** — `src/background/scheduled-job-repository.ts`

```ts
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
```

- [ ] **Step 4: 테스트 통과 확인** — 같은 명령, Expected: PASS

- [ ] **Step 5: Commit** — `feat: persist scheduled jobs in extension storage`

---

### Task 3: JobScheduler (알람·실행 오케스트레이션)

**Files:**
- Create: `src/background/scheduler.ts`
- Test: `tests/job-scheduler.test.mjs`

**Interfaces:**
- Consumes: `ScheduledJobRepository`, `reconcileJobs`, `markJobRunning`, `markJobMissed`, `finishJob`, `ALARM_LEAD_MS`
- Produces: `JOB_ALARM_PREFIX = "job:"`, `JobScheduler` 클래스 — `schedule(id, config): Promise<CommandResponse>`, `delete(id): Promise<CommandResponse>`, `reconcile(): Promise<void>`, `onAlarm(name): Promise<void>`, `onRunTerminal(jobId, state, message): Promise<void>`
- `LaunchResult = { ok: true } | { ok: false; kind: "busy" | "failed"; error: string }` — Task 4의 `launchScheduledJob`이 이 계약을 구현

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/job-scheduler.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";
import { ScheduledJobRepository } from "../dist/background/scheduled-job-repository.js";
import { JOB_ALARM_PREFIX, JobScheduler } from "../dist/background/scheduler.js";

const OPEN = 1_800_000_000_000;
const NOW = OPEN - 3_600_000;

function config(overrides = {}) {
  return {
    targetUrl: "https://app.catchtable.co.kr/ct/shop/test",
    openAtMs: OPEN,
    reservationDate: "2026-08-01",
    personCount: 2,
    timeRange: { startMinutes: 1080, endMinutes: 1200 },
    priorityTimes: [],
    postSlotEnabled: false,
    tablePreference: "any",
    menuKeyword: "",
    stopAtMs: OPEN + 600_000,
    entryMode: "auto",
    dryRun: false,
    preOpenLeadMs: 3_000,
    toggleIntervalMs: 150,
    clockSampleCount: 9,
    ...overrides,
  };
}

function harness({ launch, nowMs = NOW } = {}) {
  const data = {};
  const storage = {
    get: async (key) => ({ [key]: data[key] }),
    set: async (values) => Object.assign(data, values),
  };
  let idCount = 0;
  const repository = new ScheduledJobRepository(storage, () => `id-${++idCount}`, () => nowMs);
  const created = [];
  const cleared = [];
  const notifications = [];
  const scheduler = new JobScheduler({
    repository,
    alarms: {
      create: (name, info) => created.push({ name, when: info.when }),
      clear: async (name) => (cleared.push(name), true),
    },
    launch: launch ?? (async () => ({ ok: true })),
    notify: (message) => notifications.push(message),
    now: () => nowMs,
  });
  return { scheduler, repository, created, cleared, notifications };
}

test("schedule stores the job and registers its alarm", async () => {
  const { scheduler, created } = harness();
  const response = await scheduler.schedule(null, config());
  assert.equal(response.ok, true);
  assert.deepEqual(created, [{ name: `${JOB_ALARM_PREFIX}id-1`, when: OPEN - 75_000 }]);
});

test("schedule surfaces validation errors", async () => {
  const { scheduler, created } = harness();
  const response = await scheduler.schedule(null, config({ entryMode: "prepared" }));
  assert.equal(response.ok, false);
  assert.equal(created.length, 0);
});

test("delete clears the alarm and removes the job", async () => {
  const { scheduler, repository, cleared } = harness();
  await scheduler.schedule(null, config());
  const response = await scheduler.delete("id-1");
  assert.equal(response.ok, true);
  assert.deepEqual(cleared, [`${JOB_ALARM_PREFIX}id-1`]);
  assert.deepEqual(await repository.read(), []);
});

test("onAlarm launches a scheduled job and marks it running", async () => {
  const launched = [];
  const { scheduler, repository } = harness({ launch: async (job) => (launched.push(job.id), { ok: true }) });
  await scheduler.schedule(null, config());
  await scheduler.onAlarm(`${JOB_ALARM_PREFIX}id-1`);
  assert.deepEqual(launched, ["id-1"]);
  assert.equal((await repository.read())[0].status, "running");
});

test("onAlarm marks the job missed when a run is already active", async () => {
  const { scheduler, repository, notifications } = harness({
    launch: async () => ({ ok: false, kind: "busy", error: "이미 실행 중" }),
  });
  await scheduler.schedule(null, config());
  await scheduler.onAlarm(`${JOB_ALARM_PREFIX}id-1`);
  assert.equal((await repository.read())[0].status, "missed");
  assert.equal(notifications.length, 1);
});

test("onAlarm records a launch failure as a failed finish", async () => {
  const { scheduler, repository, notifications } = harness({
    launch: async () => ({ ok: false, kind: "failed", error: "탭 생성 실패" }),
  });
  await scheduler.schedule(null, config());
  await scheduler.onAlarm(`${JOB_ALARM_PREFIX}id-1`);
  const [job] = await repository.read();
  assert.equal(job.status, "finished");
  assert.equal(job.result.state, "FAILED");
  assert.equal(notifications.length, 1);
});

test("onAlarm ignores unknown or non-scheduled jobs", async () => {
  const launched = [];
  const { scheduler } = harness({ launch: async () => (launched.push(1), { ok: true }) });
  await scheduler.onAlarm("unrelated");
  await scheduler.onAlarm(`${JOB_ALARM_PREFIX}ghost`);
  assert.equal(launched.length, 0);
});

test("onRunTerminal records the run result", async () => {
  const { scheduler, repository } = harness();
  await scheduler.schedule(null, config());
  await scheduler.onAlarm(`${JOB_ALARM_PREFIX}id-1`);
  await scheduler.onRunTerminal("id-1", "HANDED_OFF", "예약 폼에 도착했습니다.");
  const [job] = await repository.read();
  assert.equal(job.status, "finished");
  assert.equal(job.result.state, "HANDED_OFF");
});

test("reconcile re-registers alarms and notifies missed jobs", async () => {
  const { scheduler, repository, created, notifications } = harness();
  await scheduler.schedule(null, config());
  await repository.update((jobs) => jobs.map((job) => ({ ...job, status: "running" })));
  created.length = 0;
  await scheduler.reconcile();
  assert.deepEqual(created, [{ name: `${JOB_ALARM_PREFIX}id-1`, when: OPEN - 75_000 }]);
  assert.equal((await repository.read())[0].status, "scheduled");
  assert.equal(notifications.length, 0);
});
```

- [ ] **Step 2: 실행해 실패 확인** — Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현** — `src/background/scheduler.ts`

```ts
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

  async onRunTerminal(jobId: string, state: RunState, message: string): Promise<void> {
    const nowMs = this.dependencies.now();
    await this.dependencies.repository.update((jobs) => finishJob(jobs, jobId, {
      state,
      message,
      finishedAt: nowMs,
    }, nowMs));
  }
}
```

- [ ] **Step 4: 테스트 통과 확인** — Expected: PASS

- [ ] **Step 5: Commit** — `feat: orchestrate scheduled jobs with per-job alarms`

---

### Task 4: Background 배선과 manifest

**Files:**
- Modify: `manifest.json` (permissions에 `"alarms"`)
- Modify: `src/background/index.ts`

**Interfaces:**
- Consumes: `JobScheduler`, `ScheduledJobRepository`, `JOB_ALARM_PREFIX`, `LaunchResult`
- Produces: 없음(최상위 배선). 기존 `startRun` 동작은 변하지 않아야 한다.

- [ ] **Step 1: manifest.json 수정**

```json
"permissions": ["storage", "tabs", "sidePanel", "scripting", "notifications", "alarms"],
```

- [ ] **Step 2: index.ts 리팩터링 — `runOnTab` 추출**

`startRun`의 pendingRun 생성부터 START 전송·오류 처리까지를 추출한다. `startRun`은 검증→중복 실행 확인→활성 탭 조회→prepared URL 확인 후 `runOnTab(tab, config)`을 호출한다.

```ts
async function runOnTab(
  tab: { id: number; url?: string },
  config: ReservationConfig,
  scheduledJobId?: string,
): Promise<CommandResponse> {
  const now = Date.now();
  const pendingRunId = `pending-${crypto.randomUUID()}`;
  const needsNavigation = config.entryMode === "auto" && !sameRestaurant(tab.url, config.targetUrl);
  const pendingRun: ActiveRun = {
    runId: pendingRunId,
    tabId: tab.id,
    state: needsNavigation ? "NAVIGATING" : "CONFIGURED",
    startedAt: now,
    updatedAt: now,
    ...(scheduledJobId === undefined ? {} : { scheduledJobId }),
  };
  // 이하 기존 startRun 본문 그대로 (storage set, history 저장, assertPending, navigateTab, ensureContent, START, catch/finally)
}
```

주의: `assertPending`과 CONFIGURED 갱신 시 `...pendingRun` 스프레드가 scheduledJobId를 자동 승계한다.

- [ ] **Step 3: 스케줄 실행 경로 `launchScheduledJob` 추가**

```ts
async function launchScheduledJob(job: ScheduledJob): Promise<LaunchResult> {
  const validationErrors = validateReservationConfig(job.config, Date.now());
  if (validationErrors.length > 0) return { ok: false, kind: "failed", error: validationErrors.join(" ") };
  const stored = await chrome.storage.local.get("activeRun") as { activeRun?: ActiveRun | null };
  if (stored.activeRun && !TERMINAL_STATES.has(stored.activeRun.state)) {
    return { ok: false, kind: "busy", error: "이미 실행 중인 작업이 있습니다." };
  }
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.create({ url: job.config.targetUrl, active: true });
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "예약 실행 탭을 만들 수 없습니다.";
    return { ok: false, kind: "failed", error: message };
  }
  if (tab.id === undefined) return { ok: false, kind: "failed", error: "예약 실행 탭을 만들 수 없습니다." };
  const response = await runOnTab({ id: tab.id, url: undefined }, job.config, job.id);
  if (response.ok) return { ok: true };
  return { ok: false, kind: "failed", error: response.error ?? "실행을 시작할 수 없습니다." };
}
```

`url: undefined`로 넘겨 `needsNavigation`을 강제한다 — `navigateTab`이 로드 완료를 기다린다(생성 탭이 로딩 중일 때 조기 주입 방지).

- [ ] **Step 4: 스케줄러 인스턴스와 리스너 배선**

```ts
const jobWrites = new SerialTaskQueue();
const scheduledJobs = new ScheduledJobRepository({
  get: (key) => chrome.storage.local.get(key),
  set: (values) => chrome.storage.local.set(values),
}, () => crypto.randomUUID(), () => Date.now());
const jobScheduler = new JobScheduler({
  repository: scheduledJobs,
  alarms: {
    create: (name, info) => chrome.alarms.create(name, info),
    clear: (name) => chrome.alarms.clear(name),
  },
  launch: launchScheduledJob,
  notify: (message) => {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("assets/icon-128.png"),
      title: "Catchtable Reserve",
      message,
    }, () => {
      if (chrome.runtime.lastError) {
        console.warn("운영체제 알림을 표시하지 못했습니다.", chrome.runtime.lastError.message);
      }
    });
  },
  now: () => Date.now(),
});

chrome.alarms.onAlarm.addListener((alarm) => {
  void jobWrites.enqueue(() => jobScheduler.onAlarm(alarm.name)).catch((error) => {
    console.error("예약 작업 알람 처리에 실패했습니다.", error);
  });
});
chrome.runtime.onStartup.addListener(() => {
  void jobWrites.enqueue(() => jobScheduler.reconcile()).catch((error) => {
    console.error("예약 작업 복구에 실패했습니다.", error);
  });
});
chrome.runtime.onInstalled.addListener(() => {
  void jobWrites.enqueue(() => jobScheduler.reconcile()).catch((error) => {
    console.error("예약 작업 복구에 실패했습니다.", error);
  });
});
```

메시지 리스너에 추가:

```ts
  if (message.type === "SCHEDULE_JOB") {
    void jobWrites.enqueue(() => jobScheduler.schedule(message.id, message.config)).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "예약 작업을 저장할 수 없습니다." });
    });
    return true;
  }
  if (message.type === "DELETE_JOB") {
    void jobWrites.enqueue(() => jobScheduler.delete(message.id)).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "예약 작업을 삭제할 수 없습니다." });
    });
    return true;
  }
```

- [ ] **Step 5: recordEvent에서 scheduledJobId 승계와 터미널 귀속**

`recordEvent`의 `activeRun` 조립에 `scheduledJobId: previous?.scheduledJobId,`를 추가하고, 터미널 처리 블록에 추가:

```ts
  if (event.kind === "state" && TERMINAL_STATES.has(state) && activeRun.scheduledJobId) {
    const jobId = activeRun.scheduledJobId;
    void jobWrites.enqueue(() => jobScheduler.onRunTerminal(jobId, state, event.message)).catch((error) => {
      console.error("예약 작업 결과를 기록하지 못했습니다.", error);
    });
  }
```

- [ ] **Step 6: 전체 게이트 확인**

Run: `wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check"`
Expected: PASS (기존 테스트 전부 + 신규 테스트)

- [ ] **Step 7: Commit** — `feat: launch scheduled jobs unattended from background alarms`

---

### Task 5: 작업 카드 뷰 모델

**Files:**
- Create: `src/sidepanel/job-card.ts`
- Test: `tests/job-card.test.mjs`

**Interfaces:**
- Consumes: `ScheduledJob`
- Produces: `jobCardModel(job: ScheduledJob, nowMs: number): JobCardModel` — `{ title, summary, openAtText, statusLabel, statusTone: "scheduled" | "running" | "success" | "error" | "missed", detail, canEdit, canDelete, showLog }`

- [ ] **Step 1: 실패하는 테스트 작성** — `tests/job-card.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";
import { jobCardModel } from "../dist/sidepanel/job-card.js";

const OPEN = Date.UTC(2026, 7, 1, 1, 0, 0); // 로컬 포맷 검증은 상대 시간만 사용

function job(overrides = {}) {
  return {
    id: "job-1",
    createdAt: 1,
    updatedAt: 1,
    status: "scheduled",
    config: {
      targetUrl: "https://app.catchtable.co.kr/ct/shop/sushi-koji",
      openAtMs: OPEN,
      reservationDate: "2026-08-15",
      personCount: 2,
      timeRange: { startMinutes: 1080, endMinutes: 1200 },
      priorityTimes: [],
      postSlotEnabled: false,
      tablePreference: "any",
      menuKeyword: "",
      stopAtMs: OPEN + 600_000,
      entryMode: "auto",
      dryRun: false,
      preOpenLeadMs: 3_000,
      toggleIntervalMs: 150,
      clockSampleCount: 9,
    },
    result: null,
    ...overrides,
  };
}

test("scheduled job shows shop slug, summary, and remaining time", () => {
  const model = jobCardModel(job(), OPEN - 90_061_000); // 1일 1시간 1분 1초 전
  assert.equal(model.title, "sushi-koji");
  assert.equal(model.summary, "8월 15일 · 2명 · 18:00–20:00");
  assert.equal(model.statusLabel, "예정");
  assert.equal(model.statusTone, "scheduled");
  assert.equal(model.detail, "오픈까지 1일 1시간");
  assert.equal(model.canEdit, true);
  assert.equal(model.canDelete, true);
  assert.equal(model.showLog, false);
});

test("imminent job shows minutes", () => {
  assert.equal(jobCardModel(job(), OPEN - 300_000).detail, "오픈까지 5분");
  assert.equal(jobCardModel(job(), OPEN - 30_000).detail, "곧 오픈");
});

test("running job exposes the log action and blocks edits", () => {
  const model = jobCardModel(job({ status: "running" }), OPEN);
  assert.equal(model.statusLabel, "실행 중");
  assert.equal(model.statusTone, "running");
  assert.equal(model.canEdit, false);
  assert.equal(model.canDelete, false);
  assert.equal(model.showLog, true);
});

test("finished job maps result state to label and tone", () => {
  const handedOff = jobCardModel(job({
    status: "finished",
    result: { state: "HANDED_OFF", message: "예약 폼에 도착했습니다.", finishedAt: OPEN + 1_000 },
  }), OPEN + 2_000);
  assert.equal(handedOff.statusLabel, "완료");
  assert.equal(handedOff.statusTone, "success");
  assert.equal(handedOff.detail, "예약 폼에 도착했습니다.");
  const failed = jobCardModel(job({
    status: "finished",
    result: { state: "FAILED", message: "탭 생성 실패", finishedAt: OPEN + 1_000 },
  }), OPEN + 2_000);
  assert.equal(failed.statusLabel, "실패");
  assert.equal(failed.statusTone, "error");
});

test("missed job explains the miss", () => {
  const model = jobCardModel(job({ status: "missed" }), OPEN + 2_000);
  assert.equal(model.statusLabel, "놓침");
  assert.equal(model.statusTone, "missed");
  assert.equal(model.detail, "실행 시각을 놓쳤습니다.");
});
```

- [ ] **Step 2: 실행해 실패 확인** — Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현** — `src/sidepanel/job-card.ts`

```ts
import type { RunState, ScheduledJob } from "../shared/types.js";

export interface JobCardModel {
  title: string;
  summary: string;
  openAtText: string;
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

function openAtLabel(openAtMs: number): string {
  const date = new Date(openAtMs);
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
    openAtText: `오픈 ${openAtLabel(config.openAtMs)}`,
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
```

- [ ] **Step 4: 테스트 통과 확인** — Expected: PASS

- [ ] **Step 5: Commit** — `feat: add scheduled job card view model`

---

### Task 6: 사이드패널 3화면 전환과 작업 목록 UI

**Files:**
- Modify: `src/sidepanel/sidepanel.html`
- Modify: `src/sidepanel/sidepanel.css`
- Modify: `src/sidepanel/index.ts`

**Interfaces:**
- Consumes: `jobCardModel`, `sanitizeScheduledJobs`, `SCHEDULE_JOB`/`DELETE_JOB` 커맨드
- Produces: 없음(최상위 UI)

- [ ] **Step 1: HTML 재구성**

`<main>` 내용을 세 개의 view 섹션으로 감싼다.

```html
<main>
  <section id="view-home" class="view">
    <button id="new-job" class="primary wide-button" type="button">새 예약 작업</button>
    <ol id="job-list" class="job-list" aria-label="예약 작업 목록"></ol>
  </section>

  <section id="view-form" class="view" hidden>
    <form id="reservation-form"><!-- 기존 fieldset 전체 그대로 이동 --></form>
  </section>

  <section id="view-run" class="view" hidden>
    <section class="runtime panel-card"><!-- 기존 실행 기록 섹션 그대로 이동 --></section>
  </section>
</main>

<footer class="action-bar">
  <p id="form-error" class="error" role="alert"></p>
  <button id="back-home" class="secondary" type="button" hidden>목록으로</button>
  <button id="save-job" class="primary" type="button" hidden>예약 저장</button>
  <button id="start" class="primary" type="submit" form="reservation-form" hidden>지금 시작</button>
  <button id="stop" class="secondary" type="button" hidden disabled>실행 중지</button>
</footer>
```

- [ ] **Step 2: CSS 추가** — `sidepanel.css` 끝에 작업 카드 스타일

```css
.view[hidden] { display: none; }
.wide-button { width: 100%; }
.job-list { list-style: none; margin: 12px 0 0; padding: 0; display: grid; gap: 10px; }
.job-empty { color: var(--text-dim, #8b8f98); text-align: center; padding: 28px 0; }
.job-card { border: 1px solid rgba(120, 130, 150, 0.25); border-radius: 12px; padding: 12px 14px; display: grid; gap: 6px; }
.job-card-header { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.job-card-title { font-weight: 700; }
.job-status { font-size: 12px; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.job-status[data-tone="scheduled"] { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
.job-status[data-tone="running"] { background: rgba(249, 115, 22, 0.15); color: #f97316; }
.job-status[data-tone="success"] { background: rgba(34, 197, 94, 0.15); color: #22c55e; }
.job-status[data-tone="error"] { background: rgba(239, 68, 68, 0.15); color: #ef4444; }
.job-status[data-tone="missed"] { background: rgba(148, 163, 184, 0.2); color: #94a3b8; }
.job-card-meta { font-size: 13px; color: var(--text-dim, #8b8f98); display: grid; gap: 2px; }
.job-card-detail { font-size: 13px; }
.job-card-actions { display: flex; gap: 8px; margin-top: 4px; }
.job-card-actions button { font-size: 12px; padding: 4px 10px; }
```

(기존 CSS 변수·버튼 클래스와 톤을 맞추되, 프로젝트에 이미 있는 변수명이 다르면 그 변수를 따른다.)

- [ ] **Step 3: index.ts — 화면 전환 상태와 작업 목록 렌더**

추가 요소 참조:

```ts
const viewHome = byId<HTMLElement>("view-home");
const viewForm = byId<HTMLElement>("view-form");
const viewRun = byId<HTMLElement>("view-run");
const newJobButton = byId<HTMLButtonElement>("new-job");
const jobList = byId<HTMLOListElement>("job-list");
const backHomeButton = byId<HTMLButtonElement>("back-home");
const saveJobButton = byId<HTMLButtonElement>("save-job");
```

상태와 전환:

```ts
type PanelView = "home" | "form" | "run";
let currentView: PanelView = "home";
let editingJobId: string | null = null;
let scheduledJobsState: ScheduledJob[] = [];
let runConfigOpenAtMs: number | null = null;
let wasRunning = false;

function setView(view: PanelView): void {
  currentView = view;
  viewHome.hidden = view !== "home";
  viewForm.hidden = view !== "form";
  viewRun.hidden = view !== "run";
  backHomeButton.hidden = view === "home";
  saveJobButton.hidden = view !== "form";
  const running = latestActiveRun !== null && latestActiveRun !== undefined && !TERMINAL.has(latestActiveRun.state);
  startButton.hidden = view !== "form" || running;
  stopButton.hidden = view !== "run";
  formError.textContent = "";
  renderCountdown();
}
```

카운트다운 소스 교체 — `renderCountdown` 첫 줄의 `openAt` 계산을 다음 함수 호출로 대체:

```ts
function countdownOpenAtMs(): number | null {
  if (currentView === "form") {
    return fields.openAt.value ? localInputToEpoch(fields.openAt.value) : null;
  }
  if (currentView === "run") return runConfigOpenAtMs;
  const nextJob = scheduledJobsState.find((job) => job.status === "scheduled");
  return nextJob ? nextJob.config.openAtMs : null;
}
```

작업 목록 렌더:

```ts
function renderJobs(): void {
  jobList.replaceChildren();
  if (scheduledJobsState.length === 0) {
    const empty = document.createElement("li");
    empty.className = "job-empty";
    empty.textContent = "등록된 예약 작업이 없습니다.";
    jobList.append(empty);
    return;
  }
  scheduledJobsState.forEach((job) => {
    const model = jobCardModel(job, Date.now());
    const item = document.createElement("li");
    item.className = "job-card";
    const header = document.createElement("div");
    header.className = "job-card-header";
    const title = document.createElement("span");
    title.className = "job-card-title";
    title.textContent = model.title;
    const status = document.createElement("span");
    status.className = "job-status";
    status.dataset.tone = model.statusTone;
    status.textContent = model.statusLabel;
    header.append(title, status);
    const meta = document.createElement("div");
    meta.className = "job-card-meta";
    const summary = document.createElement("span");
    summary.textContent = model.summary;
    const openAt = document.createElement("span");
    openAt.textContent = model.openAtText;
    meta.append(summary, openAt);
    const detail = document.createElement("span");
    detail.className = "job-card-detail";
    detail.textContent = model.detail;
    const actions = document.createElement("div");
    actions.className = "job-card-actions";
    if (model.showLog) {
      const logButton = document.createElement("button");
      logButton.type = "button";
      logButton.textContent = "로그 보기";
      logButton.addEventListener("click", () => setView("run"));
      actions.append(logButton);
    }
    if (model.canEdit) {
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.textContent = "편집";
      editButton.addEventListener("click", () => {
        editingJobId = job.id;
        applyValues(valuesFromConfig(job.config));
        setView("form");
      });
      actions.append(editButton);
    }
    if (model.canDelete) {
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.textContent = "삭제";
      deleteButton.addEventListener("click", async () => {
        if (!window.confirm(`${model.title} 예약 작업을 삭제할까요?`)) return;
        const response = await send({ type: "DELETE_JOB", id: job.id });
        if (!response.ok) formError.textContent = response.error ?? "예약 작업을 삭제할 수 없습니다.";
      });
      actions.append(deleteButton);
    }
    item.append(header, meta, detail, actions);
    jobList.append(item);
  });
}
```

- [ ] **Step 4: index.ts — 버튼·저장·자동 전환 배선**

```ts
newJobButton.addEventListener("click", () => {
  editingJobId = null;
  setView("form");
});
backHomeButton.addEventListener("click", () => {
  editingJobId = null;
  setView("home");
});
saveJobButton.addEventListener("click", async () => {
  formError.textContent = "";
  saveJobButton.disabled = true;
  try {
    const config = configFromFormValues(readValues(), Date.now());
    const response = await send({ type: "SCHEDULE_JOB", id: editingJobId, config });
    if (!response.ok) throw new Error(response.error ?? "예약 작업을 저장할 수 없습니다.");
    editingJobId = null;
    setView("home");
  } catch (error) {
    formError.textContent = error instanceof Error ? error.message : "입력값을 확인하세요.";
  } finally {
    saveJobButton.disabled = false;
  }
});
```

`renderRuntime` 끝에 자동 전환 추가(실행 시작 순간에만 1회):

```ts
  if (running && !wasRunning) setView("run");
  wasRunning = running;
```

주의: `renderRuntime` 내 기존 `startButton.hidden = running;`은 `startButton.hidden = running || currentView !== "form";`로 바꾼다. `stopButton.disabled = !running;`은 유지.

기존 폼 submit 성공 시(`PANEL_START`) `setView("run")` 호출을 추가한다.

- [ ] **Step 5: index.ts — storage 연동**

`chrome.storage.onChanged` 리스너에 추가:

```ts
  if (changes.scheduledJobs) {
    scheduledJobsState = sanitizeScheduledJobs(changes.scheduledJobs.newValue);
    renderJobs();
    renderCountdown();
  }
  if (changes.reservationConfig) {
    const next = changes.reservationConfig.newValue as ReservationConfig | undefined;
    runConfigOpenAtMs = next ? next.openAtMs : null;
  }
```

초기 로드 `chrome.storage.local.get([...])`에 `"scheduledJobs"` 키를 추가하고:

```ts
  scheduledJobsState = sanitizeScheduledJobs(stored.scheduledJobs);
  runConfigOpenAtMs = config ? config.openAtMs : null;
  renderJobs();
  setView("home");
```

작업 카드의 남은 시간 갱신을 위해 `setInterval(renderCountdown, 500)` 옆에 `setInterval(renderJobs, 30_000)`을 추가한다.

import 추가: `sanitizeScheduledJobs`(shared/scheduled-jobs.js), `jobCardModel`(./job-card.js), `ScheduledJob` 타입.

- [ ] **Step 6: 전체 게이트 확인**

Run: `wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check"`
Expected: PASS

- [ ] **Step 7: Commit** — `feat: split sidepanel into job list, form, and run views`

---

### Task 7: 최종 게이트·문서·수동 검증 목록

**Files:**
- Create: `docs/worklog/2026-07-11-14-job-scheduler.md`
- Modify: `docs/worklog/HANDOFF.md`
- Modify: `docs/plans/next-development.md` (#1 완료 표시)

- [ ] **Step 1: 최종 게이트**

Run: `wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check && git diff --check"`
Expected: PASS

- [ ] **Step 2: 워크로그 작성** — 수행 내용, 검증 결과, 사용자 수동 확인 항목:
  1. `chrome://extensions` 재로드 후 작업 등록 → 알람 등록 확인(`chrome://extensions` 서비스워커 콘솔에서 `chrome.alarms.getAll`)
  2. 가까운 시각(2~3분 뒤)으로 dry-run 작업 등록 → 무인 탭 생성·포커스·실행·결과 기록 확인
  3. Chrome 재시작 → 작업 복구(알람 재등록) 확인
  4. 겹치는 작업 등록 시 차단 메시지 확인

- [ ] **Step 3: HANDOFF 갱신** — 현재 상태·다음 작업을 스케줄러 검증으로 교체

- [ ] **Step 4: Commit** — `docs: record the job scheduler worklog and handoff`
