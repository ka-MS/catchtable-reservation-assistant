# Run Control Plane — Phase 1 구현 계획 (Data Plane 순수화)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 준비영역(예약창·월·날짜·인원)의 사실/분류/정책/행동/기록 책임을 분리한다 — 복붙 루프 3벌을 제네릭 runner 1개 + 선언적 StepSpec 4개로 통합하고, adapter에서 재시도 정책을 제거하며, 순수 결정 모듈을 신설한다. 사용자 가시 동작(메시지·오류 코드·상태 전이)은 보존한다.

**Architecture:** `docs/specs/run-control-plane/20-design.md` §4–5. Functional core(shared/run-control) + BoundedStepRunner(content/preparation) + 사실-only adapter. 실행영역(hot path: `waitForOpen` 이후)은 무변경.

**Tech Stack:** TypeScript strict, node:test + jsdom fixture, esbuild IIFE 번들.

## Global Constraints

- shared core는 `chrome.*`/`window`/`document` 참조 금지 (`docs/design/architecture.md`).
- adapter 외 모듈은 `querySelector` 호출 금지.
- `waitForOpen()` 이후 코드(토글·슬롯·post-slot)는 diff 0이어야 한다.
- 사용자 가시 메시지·`preparationErrorCode` 문자열·상태 전이 순서는 현행 유지 (아래 각 Task에 원문 명시).
- 각 Task 완료 시 `npm run check` 통과 후 커밋. 커밋 제목은 conventional prefix + 영어, 본문 없음.
- 테스트는 `dist/`를 import하므로 실행 전 `npm run build` 필수.
- 과거 실험 저장소 이름(금지 문자열, `scripts/check-independence.mjs` 참고)을 어떤 파일에도 쓰지 말 것.

---

## 파일 구조 (Phase 1 종료 시점)

```text
src/shared/run-control/decision.ts      # Cause·Action·decide()·메시지 표 (순수)
src/content/preparation/step-runner.ts  # BoundedStepRunner + StepSpec/StepReporter 계약
src/content/preparation/step-specs.ts   # entry/month/date/person StepSpec 팩토리
src/content/orchestrator.ts             # prepare* 3벌 → runner 호출로 교체 (축소)
src/content/adapter/calendar.ts         # 사실 관측 + 단일 클릭으로 축소 (정책 제거)
tests/run-control-decision.test.mjs
tests/preparation-step-runner.test.mjs
tests/preparation-step-specs.test.mjs
tests/calendar-adapter.test.mjs         # prepareTarget 테스트 → 사실 API 테스트로 갱신
tests/orchestrator.test.mjs             # 준비 단계 관련만 갱신, 실행 단계 무변경
```

---

### Task 1: 순수 결정 모듈 (shared/run-control)

**Files:**
- Create: `src/shared/run-control/decision.ts`
- Test: `tests/run-control-decision.test.mjs`

**Interfaces:**
- Consumes: `EntryMode` (`src/shared/types.ts`)
- Produces: `PreparationStage`, `PreparationCause`, `FailureVia`, `RecoveryAction`, `decide()`, `RESET_MIN_LEAD_MS` — Task 2~6과 Phase 2가 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// tests/run-control-decision.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { decide, RESET_MIN_LEAD_MS } from "../dist/shared/run-control/decision.js";

const openFar = { msToOpen: 120_000, msToStop: 600_000 };
const auto = { entryMode: "auto" };

test("정체 원인 + 예산 있음 + 오픈 여유 → RESET_PAGE", () => {
  assert.deepEqual(
    decide("DATE_SELECTION_STALLED", { resetCount: 0 }, openFar, auto),
    { kind: "RESET_PAGE", cause: "DATE_SELECTION_STALLED" },
  );
});

test("종결 원인은 항상 HANDOFF", () => {
  for (const cause of ["WAITING_ONLY", "PERSON_UNAVAILABLE", "DATE_UNAVAILABLE", "DATE_NOT_IN_CALENDAR", "MONTH_NAVIGATION_UNAVAILABLE"]) {
    assert.equal(decide(cause, { resetCount: 0 }, openFar, auto).kind, "HANDOFF");
  }
});

test("reset 예산 소진 → HANDOFF", () => {
  assert.equal(decide("ENTRY_TRANSITION_STALLED", { resetCount: 1 }, openFar, auto).kind, "HANDOFF");
});

test("오픈 임박(RESET_MIN_LEAD_MS 이하) → HANDOFF", () => {
  const imminent = { msToOpen: RESET_MIN_LEAD_MS, msToStop: 600_000 };
  assert.equal(decide("DATE_SELECTION_STALLED", { resetCount: 0 }, imminent, auto).kind, "HANDOFF");
});

test("stopAt 임박 → HANDOFF", () => {
  const closing = { msToOpen: 120_000, msToStop: RESET_MIN_LEAD_MS };
  assert.equal(decide("DATE_SELECTION_STALLED", { resetCount: 0 }, closing, auto).kind, "HANDOFF");
});

test("prepared 모드는 RESET 금지", () => {
  assert.equal(
    decide("DATE_SELECTION_STALLED", { resetCount: 0 }, openFar, { entryMode: "prepared" }).kind,
    "HANDOFF",
  );
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run build && node --test tests/run-control-decision.test.mjs` / Expected: build 실패("decision.js 없음") 또는 import 실패.

- [ ] **Step 3: 구현**

```ts
// src/shared/run-control/decision.ts
import type { EntryMode } from "../types.js";

export type PreparationStage = "entry" | "month" | "date" | "person";

export type PreparationCause =
  | "ENTRY_CTA_MISSING"
  | "ENTRY_TRANSITION_STALLED"
  | "WAITING_ONLY"
  | "MONTH_NAVIGATION_UNAVAILABLE"
  | "MONTH_TRANSITION_STALLED"
  | "DATE_NOT_IN_CALENDAR"
  | "DATE_UNAVAILABLE"
  | "DATE_SELECTION_STALLED"
  | "PERSON_UNAVAILABLE"
  | "PERSON_SELECTION_STALLED";

/** 실패 경로 구분 — 같은 원인이라도 사용자 메시지가 다른 경우가 있다(달력 계열). */
export type FailureVia = "fatal" | "discovery" | "exhausted" | "deadline";

export type RecoveryAction =
  | { kind: "RESET_PAGE"; cause: PreparationCause }
  | { kind: "HANDOFF"; cause: PreparationCause };

export interface RecoveryBudget { resetCount: number; }
export interface RecoveryTimeView { msToOpen: number; msToStop: number; }

/** RESET(탭 이동+재주입+재준비)은 5~15초짜리 행동 — 이 여유가 없으면 시도 자체가 오픈런을 죽인다. */
export const RESET_MIN_LEAD_MS = 45_000;

/** 재시도·리셋으로 해소될 수 없는, 페이지 사실이 확정한 원인. */
const TERMINAL_CAUSES = new Set<PreparationCause>([
  "WAITING_ONLY",
  "PERSON_UNAVAILABLE",
  "DATE_UNAVAILABLE",
  "DATE_NOT_IN_CALENDAR",
  "MONTH_NAVIGATION_UNAVAILABLE",
]);

export function decide(
  cause: PreparationCause,
  budget: RecoveryBudget,
  time: RecoveryTimeView,
  mode: { entryMode: EntryMode },
): RecoveryAction {
  if (TERMINAL_CAUSES.has(cause)) return { kind: "HANDOFF", cause };
  if (mode.entryMode !== "auto") return { kind: "HANDOFF", cause };
  if (budget.resetCount > 0) return { kind: "HANDOFF", cause };
  if (time.msToOpen <= RESET_MIN_LEAD_MS) return { kind: "HANDOFF", cause };
  if (time.msToStop <= RESET_MIN_LEAD_MS) return { kind: "HANDOFF", cause };
  return { kind: "RESET_PAGE", cause };
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm run build && node --test tests/run-control-decision.test.mjs` / Expected: PASS 6건.
- [ ] **Step 5: Commit** — `git add src/shared/run-control tests/run-control-decision.test.mjs && git commit -m "feat: add pure preparation recovery decision module"`

Phase 1에서 `decide()`는 아직 배선하지 않는다(Phase 2 supervisor가 유일한 호출자). 여기서 만드는 이유: Cause 분류 체계가 Task 2~6의 공용 어휘이고, 정책 표가 테스트로 고정돼야 Phase 2가 인터페이스만 소비하면 되기 때문.

---

### Task 2: BoundedStepRunner

**Files:**
- Create: `src/content/preparation/step-runner.ts`
- Test: `tests/preparation-step-runner.test.mjs`

**Interfaces:**
- Consumes: `PreparationCause`, `PreparationStage`, `FailureVia` (Task 1), `Clock`/`Sleep` (`src/shared/scheduler.ts`), `TraceAttributes` (`src/shared/telemetry/types.ts`)
- Produces: `StepSpec<F>`, `StepOutcome`, `StepReporter`, `runPreparationStep()` — Task 3~6이 사용.

핵심 시맨틱(현행 RT-16C를 일반화, 동작 보존):
- 폴링 50ms. `stopAt` 도달 → `timed_out`, abort → `stopped`.
- dispatch 예산: `maxAttempts`회, 재시도는 `retryDelayMs` 후. 예산 소진 + 마지막 dispatch로부터 `retryDelayMs` 경과 → `failed(confirmStalledCause, via:"exhausted")` (현행 CalendarAdapter의 월 750ms×3·날짜 1s×2 규칙과 동일).
- `confirmTimeoutMs`가 있으면 첫 dispatch 시점 + confirmTimeout 도달 시에도 `failed(confirmStalledCause, via:"exhausted")` (entry/person의 2초 confirm — dispatch가 1회로 멈춘 경우를 커버).
- dispatch 0회 + `discoveryDeadlineAtMs` 도달 → `failed(discoveryStalledCause, via:"discovery")`.
- `overallDeadlineAtMs` 도달 → `failed(현재 attempts에 맞는 cause, via:"deadline")`.
- `progressKey`가 **비어 있지 않은 값으로** 바뀌면 attempt 예산·confirm 리셋(월 이동 다단 진행. `""`는 판독 불가 = 리셋 아님).
- `fatalCause` 반환 시 즉시 `failed(cause, via:"fatal")`.
- attempts>0일 때 매 루프 `dismissObstacle` 시도(홍보 인터스티셜) — 성공 시 즉시 재dispatch 허용.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// tests/preparation-step-runner.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { runPreparationStep } from "../dist/content/preparation/step-runner.js";

function harness(startMs = 0) {
  let now = startMs;
  const clock = { now: () => now };
  const sleep = (ms) => { now += ms; return Promise.resolve(true); };
  return { clock, sleep, advance: (ms) => { now += ms; }, nowMs: () => now };
}

const silentReporter = {
  stageStart() {}, conditionChanged() {}, dispatchBefore() {}, dispatchAfter() {},
  obstacleDismissed() {}, decision() {}, action() {},
};

function spec(overrides) {
  return {
    stage: "entry",
    inspect: () => ({}),
    conditionKey: () => "steady",
    conditionAttributes: () => ({}),
    isReady: () => false,
    fatalCause: () => null,
    canDispatch: () => true,
    dispatch: () => true,
    dispatchAction: "open_reservation",
    describeDispatch: (_f, attempt) => `dispatch ${attempt}`,
    progressKey: () => "",
    maxAttempts: 2,
    retryDelayMs: 1_000,
    confirmTimeoutMs: 2_000,
    discoveryStalledCause: "ENTRY_CTA_MISSING",
    confirmStalledCause: "ENTRY_TRANSITION_STALLED",
    ...overrides,
  };
}

function options(h, overrides) {
  return {
    clock: h.clock, sleep: h.sleep, signal: new AbortController().signal,
    stopAtMs: 600_000, discoveryDeadlineAtMs: 5_000, overallDeadlineAtMs: 600_000,
    report: silentReporter, ...overrides,
  };
}

test("ready 사실 관측 시 즉시 종료한다", async () => {
  const h = harness();
  const outcome = await runPreparationStep(spec({ isReady: () => true }), options(h));
  assert.deepEqual(outcome, { kind: "ready" });
});

test("dispatch 없이 discovery deadline 도달 → discovery cause", async () => {
  const h = harness();
  const outcome = await runPreparationStep(spec({ canDispatch: () => false }), options(h));
  assert.equal(outcome.kind, "failed");
  assert.equal(outcome.cause, "ENTRY_CTA_MISSING");
  assert.equal(outcome.via, "discovery");
  assert.equal(outcome.attempts, 0);
});

test("예산 2회 소진 후 retryDelay 경과 → exhausted cause", async () => {
  const h = harness();
  let dispatched = 0;
  const outcome = await runPreparationStep(
    spec({ dispatch: () => { dispatched += 1; return true; } }),
    options(h),
  );
  assert.equal(dispatched, 2);
  assert.deepEqual(
    { kind: outcome.kind, cause: outcome.cause, via: outcome.via, attempts: outcome.attempts },
    { kind: "failed", cause: "ENTRY_TRANSITION_STALLED", via: "exhausted", attempts: 2 },
  );
  assert.ok(h.nowMs() >= 2_000); // 1차(0ms) + 재시도(1s) + 경과(1s)
});

test("2번째 폴링에서 ready로 바뀌면 dispatch 1회로 성공한다", async () => {
  const h = harness();
  let polls = 0;
  const outcome = await runPreparationStep(
    spec({ isReady: () => { polls += 1; return polls > 2; } }),
    options(h),
  );
  assert.equal(outcome.kind, "ready");
});

test("fatal 사실은 즉시 실패한다", async () => {
  const h = harness();
  const outcome = await runPreparationStep(
    spec({ fatalCause: () => "WAITING_ONLY" }),
    options(h),
  );
  assert.deepEqual(
    { cause: outcome.cause, via: outcome.via }, { cause: "WAITING_ONLY", via: "fatal" });
});

test("progressKey 변경은 attempt 예산을 리셋한다(다단 월 이동)", async () => {
  const h = harness();
  let month = "2026-07";
  let clicks = 0;
  const outcome = await runPreparationStep(spec({
    stage: "month",
    isReady: () => month === "2026-09",
    progressKey: () => month,
    dispatch: () => {
      clicks += 1;
      // 각 클릭은 2번째 재시도에서야 월을 넘긴다: 예산(3)이 리셋되지 않으면 소진된다.
      if (clicks % 2 === 0) month = month === "2026-07" ? "2026-08" : "2026-09";
      return true;
    },
    maxAttempts: 3, retryDelayMs: 750, confirmTimeoutMs: undefined,
    discoveryStalledCause: "MONTH_TRANSITION_STALLED",
    confirmStalledCause: "MONTH_TRANSITION_STALLED",
  }), options(h, { discoveryDeadlineAtMs: 600_000 }));
  assert.equal(outcome.kind, "ready");
  assert.equal(clicks, 4);
});

test("빈 progressKey는 리셋하지 않는다(월 전환 중 판독 불가)", async () => {
  const h = harness();
  let polls = 0;
  const outcome = await runPreparationStep(spec({
    stage: "month",
    progressKey: () => { polls += 1; return polls % 2 === 0 ? "" : "2026-07"; },
    dispatch: () => true,
    maxAttempts: 3, retryDelayMs: 750, confirmTimeoutMs: undefined,
    discoveryStalledCause: "MONTH_TRANSITION_STALLED",
    confirmStalledCause: "MONTH_TRANSITION_STALLED",
  }), options(h, { discoveryDeadlineAtMs: 600_000 }));
  assert.equal(outcome.via, "exhausted");
  assert.equal(outcome.attempts, 3);
});

test("overall deadline 도달 → deadline via", async () => {
  const h = harness();
  const outcome = await runPreparationStep(
    spec({ canDispatch: () => false, discoveryStalledCause: "DATE_SELECTION_STALLED" }),
    options(h, { discoveryDeadlineAtMs: 600_000, overallDeadlineAtMs: 3_000 }),
  );
  assert.deepEqual({ cause: outcome.cause, via: outcome.via },
    { cause: "DATE_SELECTION_STALLED", via: "deadline" });
});

test("obstacle 해제 후 즉시 재dispatch를 허용한다(홍보 인터스티셜)", async () => {
  const h = harness();
  let dismissed = false;
  let dispatches = 0;
  const outcome = await runPreparationStep(spec({
    isReady: () => dispatches >= 2 && dismissed,
    dispatch: () => { dispatches += 1; return true; },
    dismissObstacle: () => { if (dispatches === 0 || dismissed) return false; dismissed = true; return true; },
  }), options(h));
  assert.equal(outcome.kind, "ready");
  assert.equal(dispatches, 2);
});

test("stopAt 도달 → timed_out, abort → stopped", async () => {
  const h1 = harness();
  const out1 = await runPreparationStep(spec({ canDispatch: () => false }),
    options(h1, { stopAtMs: 200 }));
  assert.equal(out1.kind, "timed_out");
  const h2 = harness();
  const controller = new AbortController();
  controller.abort();
  const out2 = await runPreparationStep(spec({}), options(h2, { signal: controller.signal }));
  assert.equal(out2.kind, "stopped");
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run build && node --test tests/preparation-step-runner.test.mjs` / Expected: 모듈 없음으로 FAIL.

- [ ] **Step 3: 구현**

```ts
// src/content/preparation/step-runner.ts
import type { Clock, Sleep } from "../../shared/scheduler.js";
import type { FailureVia, PreparationCause, PreparationStage } from "../../shared/run-control/decision.js";
import type { TraceAttributes } from "../../shared/telemetry/types.js";

export interface StepSpec<F> {
  stage: PreparationStage;
  inspect(): F;
  /** 관측 조건 변화 감지용 키 — 바뀔 때만 condition_changed를 보고한다. */
  conditionKey(f: F): string;
  conditionAttributes(f: F): TraceAttributes;
  isReady(f: F): boolean;
  fatalCause(f: F): PreparationCause | null;
  canDispatch(f: F): boolean;
  dispatch(f: F): boolean;
  dispatchAction: string;
  describeDispatch(f: F, attempt: number): string;
  /** 비어 있지 않은 값으로 바뀌면 다단 진행으로 보고 attempt 예산을 리셋한다. */
  progressKey(f: F): string;
  dismissObstacle?(f: F): boolean;
  dismissMessage?: string;
  maxAttempts: number;
  retryDelayMs: number;
  /** 첫 dispatch 기준 확인 한계. 없으면 overall deadline만 적용(달력 계열). */
  confirmTimeoutMs?: number;
  discoveryStalledCause: PreparationCause;
  confirmStalledCause: PreparationCause;
}

export type StepOutcome =
  | { kind: "ready" }
  | { kind: "failed"; cause: PreparationCause; via: FailureVia; attempts: number }
  | { kind: "stopped" }
  | { kind: "timed_out" };

export interface StepReporter {
  stageStart(): void;
  conditionChanged(attributes: TraceAttributes): void;
  dispatchBefore(action: string, attempt: number): void;
  dispatchAfter(action: string, attempt: number, dispatched: boolean): void;
  obstacleDismissed(): void;
  decision(decision: "ready" | "handoff", cause: PreparationCause | null, attempts: number): void;
  action(message: string): void;
}

export interface StepRunOptions {
  clock: Clock;
  sleep: Sleep;
  signal: AbortSignal;
  stopAtMs: number;
  discoveryDeadlineAtMs: number;
  overallDeadlineAtMs: number;
  report: StepReporter;
  pollMs?: number;
}

export async function runPreparationStep<F>(
  spec: StepSpec<F>,
  options: StepRunOptions,
): Promise<StepOutcome> {
  const pollMs = options.pollMs ?? 50;
  const overallAt = Math.min(options.overallDeadlineAtMs, options.stopAtMs);
  const discoveryAt = Math.min(options.discoveryDeadlineAtMs, overallAt);
  let attempts = 0;
  let nextDispatchAt: number | null = null;
  let confirmDeadlineAt: number | null = null;
  let lastConditionKey = "";
  let lastProgressKey = "";
  options.report.stageStart();

  const fail = (cause: PreparationCause, via: FailureVia): StepOutcome => {
    options.report.decision("handoff", cause, attempts);
    return { kind: "failed", cause, via, attempts };
  };

  while (true) {
    if (options.signal.aborted) return { kind: "stopped" };
    const now = options.clock.now();
    if (now >= options.stopAtMs) return { kind: "timed_out" };

    const facts = spec.inspect();
    const conditionKey = spec.conditionKey(facts);
    if (conditionKey !== lastConditionKey) {
      lastConditionKey = conditionKey;
      options.report.conditionChanged(spec.conditionAttributes(facts));
    }
    if (spec.isReady(facts)) {
      options.report.decision("ready", null, attempts);
      return { kind: "ready" };
    }
    const fatal = spec.fatalCause(facts);
    if (fatal !== null) return fail(fatal, "fatal");

    const progressKey = spec.progressKey(facts);
    if (progressKey !== "" && lastProgressKey !== "" && progressKey !== lastProgressKey) {
      attempts = 0;
      nextDispatchAt = null;
      confirmDeadlineAt = null;
    }
    if (progressKey !== "") lastProgressKey = progressKey;

    if (attempts > 0 && spec.dismissObstacle?.(facts)) {
      options.report.obstacleDismissed();
      if (spec.dismissMessage) options.report.action(spec.dismissMessage);
      nextDispatchAt = now;
    }

    const canDispatch = spec.canDispatch(facts)
      && attempts < spec.maxAttempts
      && (attempts === 0 || (nextDispatchAt !== null && now >= nextDispatchAt));
    if (canDispatch) {
      const attempt = attempts + 1;
      options.report.dispatchBefore(spec.dispatchAction, attempt);
      const dispatched = spec.dispatch(facts);
      attempts = attempt;
      options.report.dispatchAfter(spec.dispatchAction, attempt, dispatched);
      if (dispatched) options.report.action(spec.describeDispatch(facts, attempt));
      if (spec.confirmTimeoutMs !== undefined) {
        confirmDeadlineAt ??= Math.min(now + spec.confirmTimeoutMs, options.stopAtMs);
      }
      nextDispatchAt = now + spec.retryDelayMs;
    }

    if (attempts === 0 && now >= discoveryAt) {
      return fail(spec.discoveryStalledCause, now >= overallAt ? "deadline" : "discovery");
    }
    if (attempts > 0) {
      const exhausted = attempts >= spec.maxAttempts
        && nextDispatchAt !== null && now >= nextDispatchAt;
      const confirmExpired = confirmDeadlineAt !== null && now >= confirmDeadlineAt;
      if (exhausted || confirmExpired) return fail(spec.confirmStalledCause, "exhausted");
      if (now >= overallAt) return fail(spec.confirmStalledCause, "deadline");
    }

    if (!(await options.sleep(pollMs, options.signal))) return { kind: "stopped" };
  }
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm run build && node --test tests/preparation-step-runner.test.mjs` / Expected: PASS 10건.
- [ ] **Step 5: Commit** — `git add src/content/preparation tests/preparation-step-runner.test.mjs && git commit -m "feat: add generic bounded preparation step runner"`

---

### Task 3: StepSpec 4종 (entry / month / date / person)

**Files:**
- Create: `src/content/preparation/step-specs.ts`
- Test: `tests/preparation-step-specs.test.mjs`

**Interfaces:**
- Consumes: `StepSpec` (Task 2), `PreparationCause`/`FailureVia` (Task 1), `EntryInspection`(`adapter/entry.ts`), `PersonInspection`(`adapter/person.ts`), `CalendarPreparationFacts` (Task 4에서 adapter에 추가 — 이 Task에서는 타입만 선언해 사용, 아래 참고)
- Produces: `createEntryStepSpec(entry)`, `createMonthStepSpec(calendar, targetDate)`, `createDateStepSpec(calendar, targetDate)`, `createPersonStepSpec(person, personCount)`, `preparationFailureMessage(spec, cause, via)` — Task 5~6이 사용.

참고: Task 4(adapter 사실 API)가 아직 없으므로, 이 Task에서는 달력 spec이 의존할 포트를 **인터페이스로 선언**한다(orchestrator의 CalendarPort 패턴과 동일). 구현 순서를 바꿔도 되지만 spec 단위 테스트가 fake 포트로 돌기 때문에 이 순서가 더 빠르다.

- [ ] **Step 1: 실패하는 테스트 작성** (fake 포트로 각 spec의 사실→판정 매핑 검증)

```js
// tests/preparation-step-specs.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  createDateStepSpec,
  createEntryStepSpec,
  createMonthStepSpec,
  createPersonStepSpec,
} from "../dist/content/preparation/step-specs.js";

test("entry spec: waitingOnly는 fatal, reservationOpen은 ready", () => {
  const spec = createEntryStepSpec({
    inspect: () => ({ reservationOpen: false, ctaAvailable: true, waitingOnly: true }),
    openReservation: () => true,
    dismissPromo: () => false,
  });
  const facts = spec.inspect();
  assert.equal(spec.fatalCause(facts), "WAITING_ONLY");
  assert.equal(spec.isReady({ reservationOpen: true, ctaAvailable: false, waitingOnly: false }), true);
  assert.equal(spec.failureMessage("ENTRY_CTA_MISSING", "discovery"), "식당 페이지에서 예약하기 버튼을 찾을 수 없습니다.");
  assert.equal(spec.failureMessage("ENTRY_TRANSITION_STALLED", "exhausted"), "예약하기 클릭 후 달력 화면을 확인할 수 없습니다.");
});

test("person spec: ready&&!available은 fatal PERSON_UNAVAILABLE", () => {
  const spec = createPersonStepSpec({
    inspect: () => ({ ready: true, targetAvailable: false, targetSelected: false }),
    select: () => true,
  }, 4);
  assert.equal(spec.fatalCause(spec.inspect()), "PERSON_UNAVAILABLE");
  assert.equal(spec.failureMessage("PERSON_UNAVAILABLE", "fatal"), "이 식당에서 4명을 선택할 수 없습니다.");
});

test("month spec: 목표 셀 표시가 ready, 같은 월인데 셀 없음은 fatal", () => {
  let facts = { displayedMonth: "2026-08", target: null, monthNavigation: null };
  const spec = createMonthStepSpec({
    inspectPreparation: () => facts,
    clickMonth: () => true,
  }, "2026-08-20");
  assert.equal(spec.fatalCause(facts), "DATE_NOT_IN_CALENDAR");
  facts = { displayedMonth: "2026-07", target: null, monthNavigation: null };
  assert.equal(spec.fatalCause(facts), "MONTH_NAVIGATION_UNAVAILABLE");
  facts = { displayedMonth: "2026-07", target: null, monthNavigation: { direction: "Next page", available: true } };
  assert.equal(spec.fatalCause(facts), null);
  assert.equal(spec.canDispatch(facts), true);
  assert.equal(spec.progressKey(facts), "2026-07");
  assert.equal(spec.progressKey({ ...facts, displayedMonth: null }), "");
  facts = { displayedMonth: "2026-08", target: { available: true, selected: false }, monthNavigation: null };
  assert.equal(spec.isReady(facts), true);
});

test("date spec: unavailable은 fatal, 셀 소실은 DATE_NOT_IN_CALENDAR fatal(pair-loop 재순환용)", () => {
  const spec = createDateStepSpec({
    inspectPreparation: () => ({ displayedMonth: "2026-08", target: { available: false, selected: false }, monthNavigation: null }),
    clickDate: () => true,
  }, "2026-08-20");
  assert.equal(spec.fatalCause(spec.inspect()), "DATE_UNAVAILABLE");
  assert.equal(spec.fatalCause({ displayedMonth: "2026-07", target: null, monthNavigation: null }), "DATE_NOT_IN_CALENDAR");
  assert.equal(spec.isReady({ displayedMonth: "2026-08", target: { available: true, selected: true }, monthNavigation: null }), true);
  assert.equal(spec.failureMessage("DATE_SELECTION_STALLED", "exhausted"), "목표 날짜 선택 전환을 확인할 수 없습니다.");
  assert.equal(spec.failureMessage("DATE_SELECTION_STALLED", "deadline"), "목표 월 또는 날짜 선택 상태를 제한 시간 안에 확인할 수 없습니다.");
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run build && node --test tests/preparation-step-specs.test.mjs` / Expected: FAIL.

- [ ] **Step 3: 구현**

```ts
// src/content/preparation/step-specs.ts
import type { PreparationCause, FailureVia } from "../../shared/run-control/decision.js";
import type { StepSpec } from "./step-runner.js";
import type { EntryInspection } from "../adapter/entry.js";
import type { PersonInspection } from "../adapter/person.js";

export interface PreparationStepSpec<F> extends StepSpec<F> {
  failureMessage(cause: PreparationCause, via: FailureVia): string;
  timeoutMessage: string;
}

interface EntryStepPort {
  inspect(): EntryInspection;
  openReservation(): boolean;
  dismissPromo?(): boolean;
}

interface PersonStepPort {
  inspect(personCount: number): PersonInspection;
  select(personCount: number): boolean;
}

/** Task 4에서 CalendarAdapter가 구현하는 사실 관측 계약. */
export interface CalendarPreparationFacts {
  displayedMonth: string | null;
  target: { available: boolean; selected: boolean } | null;
  monthNavigation: { direction: "Next page" | "Previous page"; available: boolean } | null;
}

interface CalendarStepPort {
  inspectPreparation(targetDate: string): CalendarPreparationFacts;
  clickMonth(direction: "Next page" | "Previous page"): boolean;
  clickDate(date: string): boolean;
}

const DATE_DEADLINE_MESSAGE = "목표 월 또는 날짜 선택 상태를 제한 시간 안에 확인할 수 없습니다.";

export function createEntryStepSpec(entry: EntryStepPort): PreparationStepSpec<EntryInspection> {
  return {
    stage: "entry",
    inspect: () => entry.inspect(),
    conditionKey: (f) => `${f.reservationOpen}:${f.ctaAvailable}:${f.waitingOnly}`,
    conditionAttributes: (f) => ({
      reservationOpen: f.reservationOpen,
      reservationCtaAvailable: f.ctaAvailable,
      waitingOnly: f.waitingOnly,
    }),
    isReady: (f) => f.reservationOpen,
    fatalCause: (f) => (f.waitingOnly ? "WAITING_ONLY" : null),
    canDispatch: (f) => f.ctaAvailable,
    dispatch: () => entry.openReservation(),
    dispatchAction: "open_reservation",
    describeDispatch: (_f, attempt) => (attempt === 1
      ? "예약하기 버튼을 클릭했습니다."
      : "예약하기 버튼 클릭을 재시도했습니다."),
    dismissObstacle: () => entry.dismissPromo?.() ?? false,
    dismissMessage: "매장 홍보 안내 창을 닫았습니다.",
    progressKey: () => "steady",
    maxAttempts: 2,
    retryDelayMs: 1_000,
    confirmTimeoutMs: 2_000,
    discoveryStalledCause: "ENTRY_CTA_MISSING",
    confirmStalledCause: "ENTRY_TRANSITION_STALLED",
    failureMessage: (cause) => ({
      WAITING_ONLY: "이 식당은 현장 웨이팅만 가능해 예약창을 열 수 없습니다.",
      ENTRY_CTA_MISSING: "식당 페이지에서 예약하기 버튼을 찾을 수 없습니다.",
      ENTRY_TRANSITION_STALLED: "예약하기 클릭 후 달력 화면을 확인할 수 없습니다.",
    } as Partial<Record<PreparationCause, string>>)[cause] ?? "예약창 진입을 확인할 수 없습니다.",
    timeoutMessage: "예약 페이지 준비 중 감시 종료 시각에 도달했습니다.",
  };
}

export function createMonthStepSpec(
  calendar: CalendarStepPort,
  targetDate: string,
): PreparationStepSpec<CalendarPreparationFacts> {
  const targetMonth = targetDate.slice(0, 7);
  return {
    stage: "month",
    inspect: () => calendar.inspectPreparation(targetDate),
    conditionKey: (f) => `${f.displayedMonth}:${f.target !== null}:${f.monthNavigation?.available ?? "none"}`,
    conditionAttributes: (f) => ({
      displayedMonth: f.displayedMonth,
      targetVisible: f.target !== null,
      preparationTarget: targetDate,
    }),
    isReady: (f) => f.target !== null,
    fatalCause: (f) => {
      if (f.target !== null || f.displayedMonth === null) return null;
      if (f.displayedMonth === targetMonth) return "DATE_NOT_IN_CALENDAR";
      if (f.monthNavigation === null || !f.monthNavigation.available) return "MONTH_NAVIGATION_UNAVAILABLE";
      return null;
    },
    canDispatch: (f) => f.monthNavigation?.available === true,
    dispatch: (f) => (f.monthNavigation ? calendar.clickMonth(f.monthNavigation.direction) : false),
    dispatchAction: "change_month",
    describeDispatch: (_f, attempt) => (attempt === 1
      ? `${targetMonth} 달력으로 이동합니다.`
      : `${targetMonth} 달력 이동을 재시도합니다.`),
    progressKey: (f) => f.displayedMonth ?? "",
    maxAttempts: 3,
    retryDelayMs: 750,
    confirmTimeoutMs: undefined,
    discoveryStalledCause: "MONTH_TRANSITION_STALLED",
    confirmStalledCause: "MONTH_TRANSITION_STALLED",
    failureMessage: (cause, via) => {
      if (via === "deadline") return DATE_DEADLINE_MESSAGE;
      return ({
        DATE_NOT_IN_CALENDAR: "목표 날짜가 현재 달력에 없습니다.",
        MONTH_NAVIGATION_UNAVAILABLE: "목표 월로 이동할 수 없습니다.",
        MONTH_TRANSITION_STALLED: "달력 월 전환을 확인할 수 없습니다.",
      } as Partial<Record<PreparationCause, string>>)[cause] ?? DATE_DEADLINE_MESSAGE;
    },
    timeoutMessage: "예약 날짜 준비 중 감시 종료 시각에 도달했습니다.",
  };
}

export function createDateStepSpec(
  calendar: CalendarStepPort,
  targetDate: string,
): PreparationStepSpec<CalendarPreparationFacts> {
  return {
    stage: "date",
    inspect: () => calendar.inspectPreparation(targetDate),
    conditionKey: (f) => `${f.target?.available}:${f.target?.selected}`,
    conditionAttributes: (f) => ({
      targetAvailable: f.target?.available ?? null,
      targetSelected: f.target?.selected ?? null,
      preparationTarget: targetDate,
    }),
    isReady: (f) => f.target?.selected === true,
    fatalCause: (f) => {
      if (f.target === null) return "DATE_NOT_IN_CALENDAR"; // pair-loop가 월 이동부터 재시도한다
      if (!f.target.available) return "DATE_UNAVAILABLE";
      return null;
    },
    canDispatch: (f) => f.target?.available === true,
    dispatch: () => calendar.clickDate(targetDate),
    dispatchAction: "select_date",
    describeDispatch: (_f, attempt) => (attempt === 1
      ? `${targetDate} 날짜를 선택했습니다.`
      : `${targetDate} 날짜 선택을 재시도했습니다.`),
    progressKey: () => "steady",
    maxAttempts: 2,
    retryDelayMs: 1_000,
    confirmTimeoutMs: undefined,
    discoveryStalledCause: "DATE_SELECTION_STALLED",
    confirmStalledCause: "DATE_SELECTION_STALLED",
    failureMessage: (cause, via) => {
      if (cause === "DATE_UNAVAILABLE") return "목표 날짜를 선택할 수 없습니다.";
      if (cause === "DATE_NOT_IN_CALENDAR") return "목표 날짜가 현재 달력에 없습니다.";
      return via === "exhausted"
        ? "목표 날짜 선택 전환을 확인할 수 없습니다."
        : DATE_DEADLINE_MESSAGE;
    },
    timeoutMessage: "예약 날짜 준비 중 감시 종료 시각에 도달했습니다.",
  };
}

export function createPersonStepSpec(
  person: PersonStepPort,
  personCount: number,
): PreparationStepSpec<PersonInspection> {
  return {
    stage: "person",
    inspect: () => person.inspect(personCount),
    conditionKey: (f) => `${f.ready}:${f.targetAvailable}:${f.targetSelected}`,
    conditionAttributes: (f) => ({
      personControlReady: f.ready,
      targetPersonAvailable: f.targetAvailable,
      targetPersonSelected: f.targetSelected,
      preparationTargetPersonCount: personCount,
    }),
    isReady: (f) => f.targetSelected,
    fatalCause: (f) => (f.ready && !f.targetAvailable ? "PERSON_UNAVAILABLE" : null),
    canDispatch: (f) => f.targetAvailable,
    dispatch: () => person.select(personCount),
    dispatchAction: "select_person",
    describeDispatch: (_f, attempt) => (attempt === 1
      ? `${personCount}명으로 설정했습니다.`
      : `${personCount}명 선택을 재시도했습니다.`),
    progressKey: () => "steady",
    maxAttempts: 2,
    retryDelayMs: 1_000,
    confirmTimeoutMs: 2_000,
    discoveryStalledCause: "PERSON_SELECTION_STALLED",
    confirmStalledCause: "PERSON_SELECTION_STALLED",
    failureMessage: (cause) => (cause === "PERSON_UNAVAILABLE"
      ? `이 식당에서 ${personCount}명을 선택할 수 없습니다.`
      : "예약 인원 선택 상태를 제한 시간 안에 확인할 수 없습니다."),
    timeoutMessage: "예약 인원 준비 중 감시 종료 시각에 도달했습니다.",
  };
}
```

주의: `StepSpec`에 `failureMessage`/`timeoutMessage`가 없으므로 `PreparationStepSpec`으로 확장한다(위 코드처럼 step-specs.ts에 정의). entry의 `progressKey`는 `"steady"` 고정 — 빈 문자열은 "판독 불가" 의미로 예약돼 있다.

- [ ] **Step 4: 통과 확인** — Run: `npm run build && node --test tests/preparation-step-specs.test.mjs` / Expected: PASS 4건.
- [ ] **Step 5: Commit** — `git add src/content/preparation/step-specs.ts tests/preparation-step-specs.test.mjs && git commit -m "feat: add declarative preparation step specs"`

---

### Task 4: CalendarAdapter 사실 API 추가 (정책 제거는 Task 6)

**Files:**
- Modify: `src/content/adapter/calendar.ts` (`inspectPreparation`/`clickMonth` 추가 — `prepareTarget`은 이 Task에서 아직 유지)
- Test: `tests/calendar-adapter.test.mjs` (추가 케이스)

**Interfaces:**
- Consumes: `readCalendarCells`/`readDisplayedCalendarMonth` (`adapter/calendar-dom.ts`)
- Produces: `inspectPreparation(targetDate): CalendarPreparationFacts`, `clickMonth(direction): boolean` — Task 3 spec들이 소비. Facts 형태는 Task 3의 `CalendarPreparationFacts`와 일치해야 한다.

- [ ] **Step 1: 실패하는 테스트 작성** — 기존 `tests/calendar-adapter.test.mjs`에 추가 (기존 fixture 재사용: `calendar.html`, `calendar-navigation.html`)

```js
test("inspectPreparation은 표시 월·목표 셀·월 이동 방향 사실을 반환한다", async () => {
  const dom = await loadFixture("calendar-navigation.html");
  const adapter = new CalendarAdapter(dom.window.document);
  const facts = adapter.inspectPreparation("2026-09-10");
  assert.equal(typeof facts.displayedMonth, "string");
  assert.equal(facts.target, null);
  assert.deepEqual(facts.monthNavigation, { direction: "Next page", available: true });
});

test("clickMonth는 해당 방향 버튼을 한 번 클릭한다", async () => {
  const dom = await loadFixture("calendar-navigation.html");
  const adapter = new CalendarAdapter(dom.window.document);
  let clicked = 0;
  dom.window.document.querySelector('button[aria-label="Next page"]')
    .addEventListener("click", () => { clicked += 1; });
  assert.equal(adapter.clickMonth("Next page"), true);
  assert.equal(clicked, 1);
});
```

(fixture의 실제 표시 월 값은 기존 테스트의 기대값을 따른다 — 첫 실행에서 확인 후 assert를 구체화.)

- [ ] **Step 2: 실패 확인** — Run: `npm run build && node --test tests/calendar-adapter.test.mjs` / Expected: 신규 2건 FAIL, 기존 전부 PASS.

- [ ] **Step 3: 구현** — `CalendarAdapter`에 추가:

```ts
inspectPreparation(targetDate: string): CalendarPreparationFacts {
  const cells = this.readCells();
  const target = cells.find((cell) => cell.date === targetDate) ?? null;
  const displayedMonth = readDisplayedCalendarMonth(this.document);
  let monthNavigation: CalendarPreparationFacts["monthNavigation"] = null;
  const targetMonth = targetDate.slice(0, 7);
  if (target === null && displayedMonth !== null && displayedMonth !== targetMonth) {
    const direction = displayedMonth < targetMonth ? "Next page" as const : "Previous page" as const;
    const control = this.monthControl(direction);
    monthNavigation = { direction, available: control !== null && !isDisabled(control) };
  }
  return {
    displayedMonth,
    target: target === null ? null : { available: target.available, selected: target.selected },
    monthNavigation,
  };
}

clickMonth(direction: "Previous page" | "Next page"): boolean {
  const control = this.monthControl(direction);
  if (!control || isDisabled(control) || !control.isConnected) return false;
  control.click();
  return true;
}
```

`CalendarPreparationFacts` 타입은 `step-specs.ts`에서 import한다(단일 정의 유지).

- [ ] **Step 4: 통과 확인** — Run: `npm run build && node --test tests/calendar-adapter.test.mjs` / Expected: 전부 PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat: expose calendar preparation facts on adapter"`

---### Task 5: 오케스트레이터 통합 — prepare* 3벌을 runner 호출로 교체

**Files:**
- Modify: `src/content/orchestrator.ts` (prepareEntry/prepareDate/preparePerson 본문 교체, `tracePreparation` 직접 호출 제거, CalendarPort 계약 변경)
- Test: `tests/orchestrator.test.mjs` (준비 단계 fake 포트 시그니처 갱신)

**Interfaces:**
- Consumes: Task 2 `runPreparationStep`/`StepReporter`, Task 3 spec 팩토리, Task 4 사실 API.
- Produces: `CalendarPort`가 `{ inspect, inspectPreparation, clickMonth, clickDate }`로 바뀜(`resetPreparation`/`prepareTarget` 제거는 Task 6). 실행영역 코드는 무변경.

- [ ] **Step 1: 오케스트레이터 준비 단계 테스트를 새 포트 계약으로 갱신** — `tests/orchestrator.test.mjs`에서 fake calendar가 `prepareTarget`을 제공하던 준비 시나리오를 `inspectPreparation`/`clickMonth` 기반으로 바꾼다. 검증 대상 불변 항목: ① 상태 전이 순서(`ENTERING_RESERVATION → SELECTING_DATE → SELECTING_PERSON → PREPARING_PAGE`), ② terminal 메시지 원문, ③ `preparationErrorCode`/`preparationAttemptCount`/`preparationRecoveryDecision` 데이터 필드. 실행 단계 테스트는 한 줄도 수정하지 않는다.

- [ ] **Step 2: 실패 확인** — Run: `npm test` / Expected: 갱신된 준비 시나리오 FAIL (아직 구 구현).

- [ ] **Step 3: 구현** — RunSession에 reporter 팩토리와 공용 outcome 해석기를 추가하고 3개 메서드 본문을 교체한다. `tracePreparation`은 삭제하지 않고 reporter 구현 내부로 격리한다(발화점 고정 — trace phase·attribute 하위호환 유지).

```ts
// RunSession 내부에 추가
private stepReporter(spec: PreparationStepSpec<unknown>): StepReporter {
  const base: TraceAttributes = { preparationStage: this.machine.state };
  return {
    stageStart: () => this.tracePreparation("stage_start", base),
    conditionChanged: (attributes) => this.tracePreparation("condition_changed", attributes),
    dispatchBefore: (action, attempt) => this.tracePreparation("dispatch_before", {
      preparationAction: action,
      preparationAttempt: attempt,
      preparationRecoveryDecision: attempt === 1 ? "initial" : "retry",
    }),
    dispatchAfter: (action, attempt, dispatched) => this.tracePreparation("dispatch_after", {
      preparationAction: action,
      preparationAttempt: attempt,
      preparationDispatched: dispatched,
      preparationRecoveryDecision: attempt === 1 ? "confirm" : "final_confirm",
    }),
    obstacleDismissed: () => this.tracePreparation("dispatch_after", {
      preparationAction: "dismiss_promo",
      preparationDispatched: true,
      preparationRecoveryDecision: "retry",
    }),
    decision: (decision, cause, attempts) => this.tracePreparation("decision", {
      preparationDecision: decision,
      ...(cause === null ? {} : { preparationErrorCode: cause }),
      preparationAttempt: attempts,
    }, decision === "handoff" ? "warn" : "trace"),
    action: (message) => this.emit("action", message),
  };
}

private resolveStepOutcome(
  outcome: StepOutcome,
  spec: PreparationStepSpec<unknown>,
): RunResult | null {
  if (outcome.kind === "ready") return null;
  if (outcome.kind === "stopped") return this.finishStopped();
  if (outcome.kind === "timed_out") return this.timedOut(spec.timeoutMessage);
  return this.diagnosticHandOff(spec.failureMessage(outcome.cause, outcome.via), {
    preparationErrorCode: outcome.cause,
    preparationAttemptCount: outcome.attempts,
    preparationRecoveryDecision: "handoff",
  });
}

private stepOptions(discoveryTimeoutMs: number, overallDeadlineAtMs: number, spec: PreparationStepSpec<unknown>) {
  return {
    clock: this.serverClock,
    sleep: this.deps.sleep,
    signal: this.controller.signal,
    stopAtMs: this.config.stopAtMs,
    discoveryDeadlineAtMs: Math.min(this.serverClock.now() + discoveryTimeoutMs, this.config.stopAtMs),
    overallDeadlineAtMs,
    report: this.stepReporter(spec),
  };
}
```

교체된 3개 메서드:

```ts
private async prepareEntry(): Promise<RunResult | null> {
  if (this.config.entryMode !== "auto") return null;
  this.transition("ENTERING_RESERVATION", "예약창 진입 상태를 확인합니다.");
  const spec = createEntryStepSpec(this.deps.entry);
  const outcome = await runPreparationStep(spec,
    this.stepOptions(ENTRY_DISCOVERY_TIMEOUT_MS, this.config.stopAtMs, spec));
  return this.resolveStepOutcome(outcome, spec);
}

private async prepareDate(): Promise<RunResult | null> {
  if (this.config.entryMode !== "auto") return null;
  this.transition("SELECTING_DATE", "목표 월과 예약 날짜를 준비합니다.");
  const deadline = Math.min(this.serverClock.now() + DATE_PREPARATION_TIMEOUT_MS, this.config.stopAtMs);
  const monthSpec = createMonthStepSpec(this.deps.calendar, this.config.reservationDate);
  const dateSpec = createDateStepSpec(this.deps.calendar, this.config.reservationDate);
  while (true) {
    const monthOutcome = await runPreparationStep(monthSpec,
      this.stepOptions(DATE_PREPARATION_TIMEOUT_MS, deadline, monthSpec));
    const monthExit = this.resolveStepOutcome(monthOutcome, monthSpec);
    if (monthExit) return monthExit;
    const dateOutcome = await runPreparationStep(dateSpec,
      this.stepOptions(DATE_PREPARATION_TIMEOUT_MS, deadline, dateSpec));
    // 날짜 준비 도중 달력이 다른 월로 바뀐 경우(셀 소실) 남은 시간 안에서 월 이동부터 재시도한다.
    if (dateOutcome.kind === "failed" && dateOutcome.cause === "DATE_NOT_IN_CALENDAR"
      && this.serverClock.now() < deadline) continue;
    return this.resolveStepOutcome(dateOutcome, dateSpec);
  }
}

private async preparePerson(): Promise<RunResult | null> {
  if (this.config.entryMode !== "auto") return null;
  this.transition("SELECTING_PERSON", "예약 인원을 준비합니다.");
  const spec = createPersonStepSpec(this.deps.person, this.config.personCount);
  const outcome = await runPreparationStep(spec,
    this.stepOptions(PERSON_DISCOVERY_TIMEOUT_MS, this.config.stopAtMs, spec));
  return this.resolveStepOutcome(outcome, spec);
}
```

상수 정리: `DATE_PREPARATION_TIMEOUT_MS = 10_000` 신설(기존 인라인 10초). `PREPARATION_MAX_DISPATCH_ATTEMPTS`/`PREPARATION_RETRY_DELAY_MS`/`ENTRY_CONFIRM_TIMEOUT_MS`/`PERSON_CONFIRM_TIMEOUT_MS`는 spec으로 이동했으므로 orchestrator에서 삭제. `CalendarPort`는 `{ inspect, inspectPreparation, clickMonth, clickDate }`로 변경(당분간 `prepareTarget?`/`resetPreparation?` optional 유지 — Task 6에서 제거). `prepareDate`의 `this.deps.calendar.resetPreparation()` 호출 삭제(진행 상태가 runner의 run-scoped 지역 변수가 됐으므로 구조적으로 불필요).

- [ ] **Step 4: 통과 확인** — Run: `npm test` / Expected: 전부 PASS. 실행 단계 테스트 무변경 통과가 특히 중요.
- [ ] **Step 5: hot path diff 0 검증** — Run: `git diff HEAD~1 -- src/content/orchestrator.ts | grep -A2 "waitForOpen\|runToggleCycle\|advanceFromSlot\|advancePostSlot" | head -20` / Expected: 준비 메서드 외 변경 없음(waitForOpen 이후 diff 없음).
- [ ] **Step 6: Commit** — `git commit -am "refactor: run preparation stages through bounded step runner"`

---

### Task 6: CalendarAdapter 정책 제거 + 잔재 정리

**Files:**
- Modify: `src/content/adapter/calendar.ts` (`prepareTarget`/`resetPreparation`/`CalendarPreparationResult`/`CalendarPreparationDispatch`/pending* 필드 전부 삭제)
- Modify: `src/content/orchestrator.ts` (CalendarPort에서 optional 잔재 제거)
- Test: `tests/calendar-adapter.test.mjs` (prepareTarget 테스트 삭제, 사실 API 테스트로 대체 — 월 전환 재시도·날짜 재시도 시나리오는 Task 2 runner 테스트가 이미 커버)

- [ ] **Step 1: prepareTarget 테스트 삭제 및 대체 확인** — 삭제 전에 각 prepareTarget 테스트가 검증하던 시나리오가 어디로 이전됐는지 매핑을 주석으로 남긴다: 월 전환 750ms×3 재시도 → `tests/preparation-step-runner.test.mjs`(progressKey 리셋 케이스), 날짜 1s×2 재시도 → runner exhausted 케이스, blocked 메시지 → `tests/preparation-step-specs.test.mjs`(fatalCause/failureMessage 케이스).
- [ ] **Step 2: 삭제 구현** — `CalendarAdapter`에서 `preparingTarget`, `pendingMonth*`, `pendingDate*` 필드와 `prepareTarget`, `resetPreparation` 메서드, 관련 타입 export 삭제. `monotonicNow` 생성자 파라미터도 사용처가 없어지면 삭제. orchestrator `CalendarPort`에서 optional 잔재 제거.
- [ ] **Step 3: 전체 게이트** — Run: `npm run check` / Expected: typecheck·전체 테스트·dist·independence 전부 PASS.
- [ ] **Step 4: Commit** — `git commit -am "refactor: reduce calendar adapter to facts and single actions"`

---

### Task 7: 마무리 — 문서·워크로그

**Files:**
- Modify: `docs/worklog/HANDOFF.md` (RT-16 항목에 Phase 1 완료 추가, 다음 단계 = Phase 2 control plane)
- Create: `docs/worklog/2026-MM-DD-NN-run-control-plane-phase1.md` (작업 로그 — 날짜·순번은 작성 시점 기준)
- Modify: `docs/plans/next-development.md` §6 (준비영역 책임 분리 완료, supervisor·URL 재진입은 Phase 2로 명시)

- [ ] **Step 1: 작업 로그 작성** — 변경 요약, 테스트 수 변화, hot path diff 0 확인 결과, 다음 단계(Phase 2 계획 문서 위치)를 기록.
- [ ] **Step 2: HANDOFF 갱신** — "RT-16 오픈 전 준비 복원력" 절에 Phase 1 완료 상태를 추가하고 blocking 여부를 명시.
- [ ] **Step 3: 최종 게이트 + Commit** — Run: `npm run check` / Expected: 전부 PASS. `git add docs && git commit -m "docs: record run control plane phase 1 completion"`

---

## Phase 2 예고 (별도 계획: `31-control-plane-implementation.md`)

Phase 1 병합 후 작성한다. 범위: `background/run-supervisor.ts` + `logicalRun` storage + PageRuntimePort + 기존 리스너 5개 흡수 + `decide()` 배선 + RESET_PAGE 실행 + 알림 억제 + Side Panel RECOVERING 표시 + Chrome DevTools MCP E2E. Phase 1의 `decide()`/Cause 어휘/StepOutcome이 그대로 입력이 된다.

## Self-Review 결과

- 스펙 §5.1(adapter 축소) → Task 4·6, §5.2(runner/spec) → Task 2·3, §5.3(결정 모듈) → Task 1, §6(telemetry 발화점) → Task 5 reporter, §7 Phase 1 항목 전부 매핑 확인.
- decide()는 Phase 1에서 미배선(스펙 §7 Phase 2와 일치) — Task 1 말미에 근거 명시.
- 타입 일관성: `CalendarPreparationFacts`는 step-specs.ts 단일 정의, adapter가 import(Task 3·4 일치). `PreparationStepSpec` 확장 사용처(Task 5 시그니처) 일치.
