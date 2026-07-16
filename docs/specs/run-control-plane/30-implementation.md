# Run Control Plane — Phase 1 구현 계획 (Data Plane 순수화)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 준비영역(예약창·월·날짜·인원)의 사실/분류/정책/행동/기록 책임을 분리한다 — 복붙 루프 3벌을 제네릭 runner 1개 + 명시적 coordinator 3개로 통합하고, adapter에서 재시도 정책을 제거하며, 순수 core(facts/classifier/policy/protocol)를 신설한다. 사용자 가시 동작(메시지·오류 코드·상태 전이)은 보존한다.

**Architecture:** `docs/specs/run-control-plane/20-design.md` §4–5 (2차 리뷰 반영판). Functional core(shared/run-control) + BoundedStepRunner(기계 루프) + coordinator(단계 의미) + 사실-only adapter. 실행영역 hot path(`waitForOpen` 이후)는 무변경.

**Tech Stack:** TypeScript strict, node:test + jsdom fixture, esbuild IIFE 번들.

## Global Constraints

- shared core는 `chrome.*`/`window`/`document` 참조 금지 (`docs/design/architecture.md`).
- adapter 외 모듈은 `querySelector` 호출 금지.
- `waitForOpen()` 이후 코드(토글·슬롯·post-slot)는 diff 0이어야 한다.
- 사용자 가시 메시지·상태 전이 순서는 현행 유지 (각 Task에 원문 명시). **`preparationErrorCode`는 의도된 계약 변경** — 구 fallback `DATE_PREPARATION_BLOCKED`가 세분화된다(Task 5의 매핑 표를 따르고 테스트로 고정).
- 원인 분류 로직은 `classifier.ts` 단독 소유 — coordinator·runner·adapter가 Cause 문자열을 스스로 만들지 않는다.
- 각 Task 완료 시 `npm run check` 통과 후 커밋. 커밋 제목은 conventional prefix + 영어, 본문 없음.
- 테스트는 `dist/`를 import하므로 실행 전 `npm run build` 필수.
- 과거 실험 저장소 이름(금지 문자열, `scripts/check-independence.mjs` 참고)을 어떤 파일에도 쓰지 말 것.

---

## 파일 구조 (Phase 1 종료 시점)

```text
src/shared/run-control/facts.ts             # EntryFacts · CalendarFacts · PersonFacts
src/shared/run-control/causes.ts            # PreparationStage · PreparationCause · FailureVia
src/shared/run-control/classifier.ts        # 사실 → 원인 (fatal 분류 + classifyStall)
src/shared/run-control/policy.ts            # decide() + RESET_MIN_LEAD_MS
src/shared/run-control/protocol.ts          # AttemptControlMessage 타입 (배선은 Phase 2)
src/content/preparation/step-runner.ts      # BoundedStepRunner (기계 루프)
src/content/preparation/result.ts           # PreparationResult + 공용 변환기
src/content/preparation/entry-coordinator.ts
src/content/preparation/calendar-coordinator.ts
src/content/preparation/person-coordinator.ts
src/content/orchestrator.ts                 # prepare* 3벌 → coordinator 호출로 교체 (축소)
src/content/adapter/calendar.ts             # 사실 관측 + 단일 클릭으로 축소 (정책 제거)
tests/run-control-classifier.test.mjs
tests/run-control-policy.test.mjs
tests/preparation-step-runner.test.mjs
tests/preparation-coordinators.test.mjs
tests/calendar-adapter.test.mjs             # prepareTarget 테스트 → 사실 API 테스트로 갱신
tests/orchestrator.test.mjs                 # 준비 단계 관련만 갱신, 실행 단계 무변경
```

---

### Task 1: 순수 core (shared/run-control)

**Files:**
- Create: `src/shared/run-control/facts.ts`, `src/shared/run-control/causes.ts`, `src/shared/run-control/classifier.ts`, `src/shared/run-control/policy.ts`, `src/shared/run-control/protocol.ts`
- Test: `tests/run-control-classifier.test.mjs`, `tests/run-control-policy.test.mjs`

**Interfaces:**
- Consumes: `EntryMode`, `RunState` (`src/shared/types.ts`)
- Produces: `EntryFacts`/`CalendarFacts`/`PersonFacts`, `PreparationStage`/`PreparationCause`/`FailureVia`, `classifyEntryFatal`/`classifyMonthFatal`/`classifyDateFatal`/`classifyPersonFatal`/`classifyStall`, `decide()`/`RESET_MIN_LEAD_MS`, `AttemptControlMessage` — Task 2~6과 Phase 2가 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// tests/run-control-classifier.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyDateFatal, classifyEntryFatal, classifyMonthFatal, classifyPersonFatal, classifyStall,
} from "../dist/shared/run-control/classifier.js";

test("entry: waitingOnly만 fatal", () => {
  assert.equal(classifyEntryFatal({ reservationOpen: false, ctaAvailable: true, waitingOnly: true }), "WAITING_ONLY");
  assert.equal(classifyEntryFatal({ reservationOpen: false, ctaAvailable: false, waitingOnly: false }), null);
});

test("month: 같은 월인데 셀 없음 / 이동 수단 없음이 fatal", () => {
  assert.equal(classifyMonthFatal({ displayedMonth: "2026-08", target: null, monthNavigation: null }, "2026-08"), "DATE_NOT_IN_CALENDAR");
  assert.equal(classifyMonthFatal({ displayedMonth: "2026-07", target: null, monthNavigation: null }, "2026-08"), "MONTH_NAVIGATION_UNAVAILABLE");
  assert.equal(classifyMonthFatal({ displayedMonth: "2026-07", target: null, monthNavigation: { direction: "Next page", available: false } }, "2026-08"), "MONTH_NAVIGATION_UNAVAILABLE");
  assert.equal(classifyMonthFatal({ displayedMonth: "2026-07", target: null, monthNavigation: { direction: "Next page", available: true } }, "2026-08"), null);
  assert.equal(classifyMonthFatal({ displayedMonth: null, target: null, monthNavigation: null }, "2026-08"), null); // 판독 불가는 대기
});

test("date: unavailable만 fatal — 셀 소실은 원인이 아니라 coordinator의 interrupt 재순환이다", () => {
  assert.equal(classifyDateFatal({ displayedMonth: "2026-08", target: { available: false, selected: false }, monthNavigation: null }), "DATE_UNAVAILABLE");
  assert.equal(classifyDateFatal({ displayedMonth: "2026-07", target: null, monthNavigation: null }), null);
  assert.equal(classifyDateFatal({ displayedMonth: "2026-08", target: { available: true, selected: false }, monthNavigation: null }), null);
});

test("person: ready인데 target 불가만 fatal", () => {
  assert.equal(classifyPersonFatal({ ready: true, targetAvailable: false, targetSelected: false }), "PERSON_UNAVAILABLE");
  assert.equal(classifyPersonFatal({ ready: false, targetAvailable: false, targetSelected: false }), null);
});

test("정체 원인은 stage×attempts로 결정된다", () => {
  assert.equal(classifyStall("entry", 0), "ENTRY_CTA_MISSING");
  assert.equal(classifyStall("entry", 2), "ENTRY_TRANSITION_STALLED");
  assert.equal(classifyStall("month", 3), "MONTH_TRANSITION_STALLED");
  assert.equal(classifyStall("date", 0), "DATE_SELECTION_STALLED");
  assert.equal(classifyStall("person", 1), "PERSON_SELECTION_STALLED");
});
```

```js
// tests/run-control-policy.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { decide, RESET_MIN_LEAD_MS } from "../dist/shared/run-control/policy.js";

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

test("reset 예산 소진 / 오픈 임박 / stopAt 임박 / prepared 모드 → HANDOFF", () => {
  assert.equal(decide("ENTRY_TRANSITION_STALLED", { resetCount: 1 }, openFar, auto).kind, "HANDOFF");
  assert.equal(decide("DATE_SELECTION_STALLED", { resetCount: 0 }, { msToOpen: RESET_MIN_LEAD_MS, msToStop: 600_000 }, auto).kind, "HANDOFF");
  assert.equal(decide("DATE_SELECTION_STALLED", { resetCount: 0 }, { msToOpen: 120_000, msToStop: RESET_MIN_LEAD_MS }, auto).kind, "HANDOFF");
  assert.equal(decide("DATE_SELECTION_STALLED", { resetCount: 0 }, openFar, { entryMode: "prepared" }).kind, "HANDOFF");
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run build && node --test tests/run-control-classifier.test.mjs tests/run-control-policy.test.mjs` / Expected: 모듈 없음으로 FAIL.

- [ ] **Step 3: 구현**

```ts
// src/shared/run-control/facts.ts
export interface EntryFacts {
  reservationOpen: boolean;
  ctaAvailable: boolean;
  waitingOnly: boolean;
}

export interface CalendarFacts {
  displayedMonth: string | null;
  target: { available: boolean; selected: boolean } | null;
  /** target 미표시이고 표시 월이 목표 월과 다를 때만 채워진다. */
  monthNavigation: { direction: "Next page" | "Previous page"; available: boolean } | null;
}

export interface PersonFacts {
  ready: boolean;
  targetAvailable: boolean;
  targetSelected: boolean;
}
```

```ts
// src/shared/run-control/causes.ts
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
```

```ts
// src/shared/run-control/classifier.ts
import type { CalendarFacts, EntryFacts, PersonFacts } from "./facts.js";
import type { PreparationCause, PreparationStage } from "./causes.js";

export function classifyEntryFatal(f: EntryFacts): PreparationCause | null {
  return f.waitingOnly ? "WAITING_ONLY" : null;
}

export function classifyMonthFatal(f: CalendarFacts, targetMonth: string): PreparationCause | null {
  if (f.target !== null || f.displayedMonth === null) return null;
  if (f.displayedMonth === targetMonth) return "DATE_NOT_IN_CALENDAR";
  if (f.monthNavigation === null || !f.monthNavigation.available) return "MONTH_NAVIGATION_UNAVAILABLE";
  return null;
}

/** 셀 소실(target null)은 원인이 아니다 — coordinator가 interrupt 토큰으로 월 단계를 재순환한다.
 * DATE_NOT_IN_CALENDAR는 월 단계의 최종 판정(classifyMonthFatal)에서만 나온다. */
export function classifyDateFatal(f: CalendarFacts): PreparationCause | null {
  if (f.target !== null && !f.target.available) return "DATE_UNAVAILABLE";
  return null;
}

export function classifyPersonFatal(f: PersonFacts): PreparationCause | null {
  return f.ready && !f.targetAvailable ? "PERSON_UNAVAILABLE" : null;
}

const STALL: Record<PreparationStage, { discovery: PreparationCause; confirm: PreparationCause }> = {
  entry: { discovery: "ENTRY_CTA_MISSING", confirm: "ENTRY_TRANSITION_STALLED" },
  month: { discovery: "MONTH_TRANSITION_STALLED", confirm: "MONTH_TRANSITION_STALLED" },
  date: { discovery: "DATE_SELECTION_STALLED", confirm: "DATE_SELECTION_STALLED" },
  person: { discovery: "PERSON_SELECTION_STALLED", confirm: "PERSON_SELECTION_STALLED" },
};

export function classifyStall(stage: PreparationStage, attempts: number): PreparationCause {
  return attempts === 0 ? STALL[stage].discovery : STALL[stage].confirm;
}
```

```ts
// src/shared/run-control/policy.ts
import type { EntryMode } from "../types.js";
import type { PreparationCause } from "./causes.js";

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

```ts
// src/shared/run-control/protocol.ts — Phase 2에서 배선. Telemetry는 제어에 사용하지 않는다.
// outcome은 TerminalEffects·finishJob이 필요로 하는 전부(메시지·종료 시각)를 싣는다.
import type { RunState } from "../types.js";
import type { PreparationCause } from "./causes.js";

export type TerminalRunState = Extract<RunState,
  "DRY_RUN_COMPLETED" | "HANDED_OFF" | "COMPLETED" | "STOPPED" | "TIMED_OUT" | "FAILED">;
export type AttemptPhase = "PREPARING" | "EXECUTING";

export type AttemptOutcome =
  | {
    kind: "preparation_failed";
    state: "HANDED_OFF";
    cause: PreparationCause;
    attempts: number;
    message: string;
    finishedAt: number;
  }
  | { kind: "terminal"; state: TerminalRunState; message: string; finishedAt: number };

// content → background
export type AttemptControlMessage =
  | { type: "ATTEMPT_PHASE_CHANGED"; logicalRunId: string; attemptId: string; phase: AttemptPhase }
  | { type: "ATTEMPT_FINISHED"; logicalRunId: string; attemptId: string; outcome: AttemptOutcome };

/** sendResponse = ACK. ACK = "결정이 영속 접수됨"(행동 완료 아님).
 * 같은 attempt의 재전송에는 영속된 decision을 그대로 재ACK한다.
 * stale/missing은 침묵이 아니라 {ok:false, reason}으로 응답한다 — content가 재시도 중단을 판단. */
export type AttemptAckFailureReason = "unknown_logical_run" | "stale_attempt";
export type AttemptFinishedAck =
  | { ok: true; decision: "RESET_PAGE" | "HANDOFF" }
  | { ok: false; reason: AttemptAckFailureReason };
export type AttemptPhaseChangedAck =
  | { ok: true }
  | { ok: false; reason: AttemptAckFailureReason };

// background → content (SW bootstrap reconcile 전용 — PING은 주입 여부만 증명한다)
export interface AttemptStatusRequest { type: "GET_ATTEMPT_STATUS"; attemptId: string; }
export interface AttemptStatusResponse { attemptId: string; running: boolean; phase: AttemptPhase | null; }
```

- [ ] **Step 4: 통과 확인** — Run: `npm run build && node --test tests/run-control-classifier.test.mjs tests/run-control-policy.test.mjs` / Expected: PASS 9건.
- [ ] **Step 5: Commit** — `git add src/shared/run-control tests/run-control-classifier.test.mjs tests/run-control-policy.test.mjs && git commit -m "feat: add pure run-control core (facts, classifier, policy, protocol)"`

decide()/protocol은 Phase 1에서 배선하지 않는다(Phase 2 supervisor가 유일한 소비자). 여기서 만드는 이유: Cause·facts 어휘가 Task 2~6의 공용 계약이고, 정책·프로토콜이 테스트로 고정돼야 Phase 2가 인터페이스만 소비하면 되기 때문.

---

### Task 2: BoundedStepRunner (기계 루프)

**Files:**
- Create: `src/content/preparation/step-runner.ts`
- Test: `tests/preparation-step-runner.test.mjs`

**Interfaces:**
- Consumes: `PreparationCause`/`PreparationStage`/`FailureVia`, `classifyStall` (Task 1), `Clock`/`Sleep` (`src/shared/scheduler.ts`), `TraceAttributes` (`src/shared/telemetry/types.ts`)
- Produces: `StepSpec<F>`, `StepOutcome`, `StepReporter`, `StepRunOptions`, `runPreparationStep()` — Task 3이 사용.

핵심 시맨틱(현행 RT-16C를 일반화, 동작 보존):
- 폴링 50ms. `stopAt` 도달 → `timed_out`, abort → `stopped`.
- dispatch 예산: `maxAttempts`회, 재시도는 `retryDelayMs` 후. 예산 소진 + 마지막 dispatch로부터 `retryDelayMs` 경과 → `failed(classifyStall, via:"exhausted")` (현행 월 750ms×3·날짜 1s×2 규칙과 동일).
- `confirmTimeoutMs`가 있으면 첫 dispatch + confirmTimeout 도달 시에도 `failed(classifyStall, via:"exhausted")` (entry/person의 2초 confirm — dispatch가 1회로 멈춘 경우 커버).
- dispatch 0회 + `discoveryDeadlineAtMs` 도달 → `failed(classifyStall(stage,0), via:"discovery")`.
- `overallDeadlineAtMs` 도달 → `failed(classifyStall, via:"deadline")`.
- `progressKey`가 **비어 있지 않은 값으로** 바뀌면 attempt 예산·confirm 리셋(다단 월 이동. `""`는 판독 불가 = 리셋 아님).
- `spec.fatal(facts)`(classifier 부분 적용)가 원인 반환 시 즉시 `failed(cause, via:"fatal")`.
- `spec.interrupt?.(facts)`가 토큰 반환 시 즉시 `{ kind: "interrupted", token, attempts }` — **원인 코드가 아니라 내부 제어 신호**다. coordinator가 해석한다(달력의 셀 소실 재순환).
- attempts>0일 때 매 루프 `dismissObstacle` 시도(홍보 인터스티셜) — 성공 시 즉시 재dispatch 허용.
- **분류 로직은 이 파일에 없다**: fatal은 주입된 함수, stall은 `classifyStall` 호출.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// tests/preparation-step-runner.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { runPreparationStep } from "../dist/content/preparation/step-runner.js";

function harness(startMs = 0) {
  let now = startMs;
  return {
    clock: { now: () => now },
    sleep: (ms) => { now += ms; return Promise.resolve(true); },
    nowMs: () => now,
  };
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
    fatal: () => null,
    canDispatch: () => true,
    dispatch: () => true,
    dispatchAction: "open_reservation",
    describeDispatch: (_f, attempt) => `dispatch ${attempt}`,
    progressKey: () => "steady",
    maxAttempts: 2,
    retryDelayMs: 1_000,
    confirmTimeoutMs: 2_000,
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
  assert.deepEqual(await runPreparationStep(spec({ isReady: () => true }), options(h)), { kind: "ready" });
});

test("dispatch 없이 discovery deadline 도달 → stage의 discovery stall cause", async () => {
  const h = harness();
  const outcome = await runPreparationStep(spec({ canDispatch: () => false }), options(h));
  assert.deepEqual(
    { kind: outcome.kind, cause: outcome.cause, via: outcome.via, attempts: outcome.attempts },
    { kind: "failed", cause: "ENTRY_CTA_MISSING", via: "discovery", attempts: 0 },
  );
});

test("예산 2회 소진 후 retryDelay 경과 → confirm stall cause", async () => {
  const h = harness();
  let dispatched = 0;
  const outcome = await runPreparationStep(
    spec({ dispatch: () => { dispatched += 1; return true; } }), options(h));
  assert.equal(dispatched, 2);
  assert.deepEqual(
    { cause: outcome.cause, via: outcome.via, attempts: outcome.attempts },
    { cause: "ENTRY_TRANSITION_STALLED", via: "exhausted", attempts: 2 });
  assert.ok(h.nowMs() >= 2_000);
});

test("fatal 분류 함수가 원인을 반환하면 즉시 실패한다", async () => {
  const h = harness();
  const outcome = await runPreparationStep(spec({ fatal: () => "WAITING_ONLY" }), options(h));
  assert.deepEqual({ cause: outcome.cause, via: outcome.via }, { cause: "WAITING_ONLY", via: "fatal" });
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
      if (clicks % 2 === 0) month = month === "2026-07" ? "2026-08" : "2026-09";
      return true;
    },
    maxAttempts: 3, retryDelayMs: 750, confirmTimeoutMs: undefined,
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
    maxAttempts: 3, retryDelayMs: 750, confirmTimeoutMs: undefined,
  }), options(h, { discoveryDeadlineAtMs: 600_000 }));
  assert.deepEqual({ via: outcome.via, attempts: outcome.attempts }, { via: "exhausted", attempts: 3 });
});

test("overall deadline 도달 → deadline via", async () => {
  const h = harness();
  const outcome = await runPreparationStep(
    spec({ stage: "date", canDispatch: () => false }),
    options(h, { discoveryDeadlineAtMs: 600_000, overallDeadlineAtMs: 3_000 }));
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
    dismissMessage: "매장 홍보 안내 창을 닫았습니다.",
  }), options(h));
  assert.equal(outcome.kind, "ready");
  assert.equal(dispatches, 2);
});

test("interrupt 토큰은 원인 없이 내부 신호로 종료한다", async () => {
  const outcome = await runPreparationStep(
    spec({ interrupt: () => "target_cell_missing" }), options(harness()));
  assert.deepEqual(outcome, { kind: "interrupted", token: "target_cell_missing", attempts: 0 });
});

test("stopAt 도달 → timed_out, abort → stopped", async () => {
  const out1 = await runPreparationStep(spec({ canDispatch: () => false }),
    options(harness(), { stopAtMs: 200 }));
  assert.equal(out1.kind, "timed_out");
  const controller = new AbortController();
  controller.abort();
  const out2 = await runPreparationStep(spec({}), options(harness(), { signal: controller.signal }));
  assert.equal(out2.kind, "stopped");
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run build && node --test tests/preparation-step-runner.test.mjs` / Expected: 모듈 없음으로 FAIL.

- [ ] **Step 3: 구현**

```ts
// src/content/preparation/step-runner.ts
import type { Clock, Sleep } from "../../shared/scheduler.js";
import type { FailureVia, PreparationCause, PreparationStage } from "../../shared/run-control/causes.js";
import { classifyStall } from "../../shared/run-control/classifier.js";
import type { TraceAttributes } from "../../shared/telemetry/types.js";

export interface StepSpec<F> {
  stage: PreparationStage;
  inspect(): F;
  /** 관측 조건 변화 감지용 키 — 바뀔 때만 condition_changed를 보고한다. */
  conditionKey(f: F): string;
  conditionAttributes(f: F): TraceAttributes;
  isReady(f: F): boolean;
  /** classifier.ts의 stage별 fatal 분류 함수를 부분 적용해 주입한다 — 분류 정의는 classifier가 소유. */
  fatal(f: F): PreparationCause | null;
  canDispatch(f: F): boolean;
  dispatch(f: F): boolean;
  dispatchAction: string;
  describeDispatch(f: F, attempt: number): string;
  /** 내부 제어 신호(원인 코드 아님) — 토큰 반환 시 즉시 interrupted로 종료하고 coordinator가 해석한다. */
  interrupt?(f: F): PreparationInterrupt | null;
  /** 비어 있지 않은 값으로 바뀌면 다단 진행으로 보고 attempt 예산을 리셋한다. `""`는 판독 불가. */
  progressKey(f: F): string;
  dismissObstacle?(f: F): boolean;
  dismissMessage?: string;
  maxAttempts: number;
  retryDelayMs: number;
  /** 첫 dispatch 기준 확인 한계. 없으면 overall deadline만 적용(달력 계열). */
  confirmTimeoutMs?: number;
}

/** 내부 제어 신호의 closed union — 원인 코드와 분리된 어휘. 새 재순환 신호는 여기에 추가한다. */
export type PreparationInterrupt = "target_cell_missing";

export type StepOutcome =
  | { kind: "ready" }
  | { kind: "failed"; cause: PreparationCause; via: FailureVia; attempts: number }
  | { kind: "interrupted"; token: PreparationInterrupt; attempts: number }
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

/** closed union의 exhaustive 처리 보조 — 미처리 variant를 컴파일·런타임 양쪽에서 잡는다. */
export function assertNever(value: never): never {
  throw new Error(`처리되지 않은 variant: ${String(value)}`);
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
    const interrupt = spec.interrupt?.(facts) ?? null;
    if (interrupt !== null) return { kind: "interrupted", token: interrupt, attempts };
    const fatal = spec.fatal(facts);
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
      return fail(classifyStall(spec.stage, 0), now >= overallAt ? "deadline" : "discovery");
    }
    if (attempts > 0) {
      const exhausted = attempts >= spec.maxAttempts
        && nextDispatchAt !== null && now >= nextDispatchAt;
      const confirmExpired = confirmDeadlineAt !== null && now >= confirmDeadlineAt;
      if (exhausted || confirmExpired) return fail(classifyStall(spec.stage, attempts), "exhausted");
      if (now >= overallAt) return fail(classifyStall(spec.stage, attempts), "deadline");
    }

    if (!(await options.sleep(pollMs, options.signal))) return { kind: "stopped" };
  }
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm run build && node --test tests/preparation-step-runner.test.mjs` / Expected: PASS 11건.
- [ ] **Step 5: Commit** — `git add src/content/preparation tests/preparation-step-runner.test.mjs && git commit -m "feat: add mechanical bounded preparation step runner"`

---

### Task 3: Coordinator 3종 (단계 의미 소유)

**Files:**
- Create: `src/content/preparation/result.ts`, `src/content/preparation/entry-coordinator.ts`, `src/content/preparation/calendar-coordinator.ts`, `src/content/preparation/person-coordinator.ts`
- Test: `tests/preparation-coordinators.test.mjs`

**Interfaces:**
- Consumes: Task 1 facts/classifier, Task 2 runner.
- Produces: `PreparationResult`, `runEntryPreparation(port, options)`, `runCalendarPreparation(port, targetDate, options)`, `runPersonPreparation(port, personCount, options)` — Task 5가 사용. Calendar port 계약 `{ inspectPreparation(targetDate): CalendarFacts; clickMonth(direction): boolean; clickDate(date): boolean }`은 Task 4가 구현.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// tests/preparation-coordinators.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { runEntryPreparation } from "../dist/content/preparation/entry-coordinator.js";
import { runCalendarPreparation } from "../dist/content/preparation/calendar-coordinator.js";
import { runPersonPreparation } from "../dist/content/preparation/person-coordinator.js";

function harness(startMs = 0) {
  let now = startMs;
  return {
    clock: { now: () => now },
    sleep: (ms) => { now += ms; return Promise.resolve(true); },
    nowMs: () => now,
  };
}
const silentReporter = {
  stageStart() {}, conditionChanged() {}, dispatchBefore() {}, dispatchAfter() {},
  obstacleDismissed() {}, decision() {}, action() {},
};
function options(h, overrides) {
  return {
    clock: h.clock, sleep: h.sleep, signal: new AbortController().signal,
    stopAtMs: 600_000, discoveryDeadlineAtMs: 5_000, overallDeadlineAtMs: 600_000,
    report: silentReporter, ...overrides,
  };
}

test("entry: waitingOnly는 현행 메시지로 실패한다", async () => {
  const result = await runEntryPreparation({
    inspect: () => ({ reservationOpen: false, ctaAvailable: false, waitingOnly: true }),
    openReservation: () => true,
  }, options(harness()));
  assert.equal(result.kind, "failed");
  assert.equal(result.cause, "WAITING_ONLY");
  assert.equal(result.message, "이 식당은 현장 웨이팅만 가능해 예약창을 열 수 없습니다.");
});

test("entry: CTA 미발견은 discovery 메시지, 클릭 후 정체는 transition 메시지", async () => {
  const missing = await runEntryPreparation({
    inspect: () => ({ reservationOpen: false, ctaAvailable: false, waitingOnly: false }),
    openReservation: () => true,
  }, options(harness()));
  assert.equal(missing.message, "식당 페이지에서 예약하기 버튼을 찾을 수 없습니다.");
  const stalled = await runEntryPreparation({
    inspect: () => ({ reservationOpen: false, ctaAvailable: true, waitingOnly: false }),
    openReservation: () => true,
  }, options(harness()));
  assert.equal(stalled.message, "예약하기 클릭 후 달력 화면을 확인할 수 없습니다.");
  assert.equal(stalled.attempts, 2);
});

test("calendar: 월 이동 후 날짜 선택까지 완주한다", async () => {
  let month = "2026-07";
  let selected = false;
  const port = {
    inspectPreparation: () => (month === "2026-08"
      ? { displayedMonth: month, target: { available: true, selected }, monthNavigation: null }
      : { displayedMonth: month, target: null, monthNavigation: { direction: "Next page", available: true } }),
    clickMonth: () => { month = "2026-08"; return true; },
    clickDate: () => { selected = true; return true; },
  };
  const h = harness();
  const result = await runCalendarPreparation(port, "2026-08-20",
    options(h, { discoveryDeadlineAtMs: 600_000, overallDeadlineAtMs: h.clock.now() + 10_000 }));
  assert.deepEqual(result, { kind: "ready" });
});

test("calendar: 날짜 준비 중 셀 소실 시 월 이동부터 재순환한다", async () => {
  let phase = 0; // 0: 목표월+셀, 1: 다른월(셀 소실), 2: 복귀+선택됨
  const port = {
    inspectPreparation: () => {
      if (phase === 0) { phase = 1; return { displayedMonth: "2026-08", target: { available: true, selected: false }, monthNavigation: null }; }
      if (phase === 1) { phase = 2; return { displayedMonth: "2026-07", target: null, monthNavigation: { direction: "Next page", available: true } }; }
      return { displayedMonth: "2026-08", target: { available: true, selected: true }, monthNavigation: null };
    },
    clickMonth: () => true,
    clickDate: () => true,
  };
  const h = harness();
  const result = await runCalendarPreparation(port, "2026-08-20",
    options(h, { discoveryDeadlineAtMs: 600_000, overallDeadlineAtMs: h.clock.now() + 10_000 }));
  assert.deepEqual(result, { kind: "ready" });
});

test("calendar: 날짜 dispatch 2회 소진은 현행 전환 실패 메시지", async () => {
  const port = {
    inspectPreparation: () => ({ displayedMonth: "2026-08", target: { available: true, selected: false }, monthNavigation: null }),
    clickMonth: () => true,
    clickDate: () => true,
  };
  const h = harness();
  const result = await runCalendarPreparation(port, "2026-08-20",
    options(h, { discoveryDeadlineAtMs: 600_000, overallDeadlineAtMs: h.clock.now() + 10_000 }));
  assert.equal(result.cause, "DATE_SELECTION_STALLED");
  assert.equal(result.message, "목표 날짜 선택 전환을 확인할 수 없습니다.");
});

test("calendar: deadline 초과는 현행 제한 시간 메시지", async () => {
  const port = {
    inspectPreparation: () => ({ displayedMonth: null, target: null, monthNavigation: null }),
    clickMonth: () => true,
    clickDate: () => true,
  };
  const h = harness();
  const result = await runCalendarPreparation(port, "2026-08-20",
    options(h, { discoveryDeadlineAtMs: 600_000, overallDeadlineAtMs: h.clock.now() + 10_000 }));
  assert.equal(result.message, "목표 월 또는 날짜 선택 상태를 제한 시간 안에 확인할 수 없습니다.");
});

test("person: 불가 인원은 personCount가 포함된 현행 메시지", async () => {
  const result = await runPersonPreparation({
    inspect: () => ({ ready: true, targetAvailable: false, targetSelected: false }),
    select: () => true,
  }, 4, options(harness()));
  assert.equal(result.cause, "PERSON_UNAVAILABLE");
  assert.equal(result.message, "이 식당에서 4명을 선택할 수 없습니다.");
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run build && node --test tests/preparation-coordinators.test.mjs` / Expected: FAIL.

- [ ] **Step 3: 구현**

```ts
// src/content/preparation/result.ts
import type { FailureVia, PreparationCause } from "../../shared/run-control/causes.js";
import type { StepOutcome } from "./step-runner.js";

export type PreparationResult =
  | { kind: "ready" }
  | { kind: "failed"; cause: PreparationCause; via: FailureVia; attempts: number; message: string }
  | { kind: "stopped" }
  | { kind: "timed_out"; message: string };

export function toPreparationResult(
  outcome: StepOutcome,
  messageFor: (cause: PreparationCause, via: FailureVia) => string,
  timeoutMessage: string,
): PreparationResult {
  if (outcome.kind === "ready") return { kind: "ready" };
  if (outcome.kind === "stopped") return { kind: "stopped" };
  if (outcome.kind === "timed_out") return { kind: "timed_out", message: timeoutMessage };
  if (outcome.kind === "interrupted") {
    // interrupt는 해당 coordinator가 소비해야 하는 내부 신호다 — 여기 도달은 프로그래밍 오류.
    throw new Error(`처리되지 않은 준비 interrupt: ${outcome.token}`);
  }
  return { ...outcome, message: messageFor(outcome.cause, outcome.via) };
}
```

```ts
// src/content/preparation/entry-coordinator.ts
import { classifyEntryFatal } from "../../shared/run-control/classifier.js";
import type { PreparationCause } from "../../shared/run-control/causes.js";
import type { EntryFacts } from "../../shared/run-control/facts.js";
import { runPreparationStep, type StepRunOptions } from "./step-runner.js";
import { toPreparationResult, type PreparationResult } from "./result.js";

export interface EntryStagePort {
  inspect(): EntryFacts;
  openReservation(): boolean;
  dismissPromo?(): boolean;
}

const MESSAGES: Partial<Record<PreparationCause, string>> = {
  WAITING_ONLY: "이 식당은 현장 웨이팅만 가능해 예약창을 열 수 없습니다.",
  ENTRY_CTA_MISSING: "식당 페이지에서 예약하기 버튼을 찾을 수 없습니다.",
  ENTRY_TRANSITION_STALLED: "예약하기 클릭 후 달력 화면을 확인할 수 없습니다.",
};

export const ENTRY_TIMEOUT_MESSAGE = "예약 페이지 준비 중 감시 종료 시각에 도달했습니다.";

export async function runEntryPreparation(
  port: EntryStagePort,
  options: StepRunOptions,
): Promise<PreparationResult> {
  const outcome = await runPreparationStep<EntryFacts>({
    stage: "entry",
    inspect: () => port.inspect(),
    conditionKey: (f) => `${f.reservationOpen}:${f.ctaAvailable}:${f.waitingOnly}`,
    conditionAttributes: (f) => ({
      reservationOpen: f.reservationOpen,
      reservationCtaAvailable: f.ctaAvailable,
      waitingOnly: f.waitingOnly,
    }),
    isReady: (f) => f.reservationOpen,
    fatal: classifyEntryFatal,
    canDispatch: (f) => f.ctaAvailable,
    dispatch: () => port.openReservation(),
    dispatchAction: "open_reservation",
    describeDispatch: (_f, attempt) => (attempt === 1
      ? "예약하기 버튼을 클릭했습니다."
      : "예약하기 버튼 클릭을 재시도했습니다."),
    dismissObstacle: () => port.dismissPromo?.() ?? false,
    dismissMessage: "매장 홍보 안내 창을 닫았습니다.",
    progressKey: () => "steady",
    maxAttempts: 2,
    retryDelayMs: 1_000,
    confirmTimeoutMs: 2_000,
  }, options);
  return toPreparationResult(outcome,
    (cause) => MESSAGES[cause] ?? "예약창 진입을 확인할 수 없습니다.",
    ENTRY_TIMEOUT_MESSAGE);
}
```

```ts
// src/content/preparation/calendar-coordinator.ts
import { classifyDateFatal, classifyMonthFatal, classifyStall } from "../../shared/run-control/classifier.js";
import type { FailureVia, PreparationCause } from "../../shared/run-control/causes.js";
import type { CalendarFacts } from "../../shared/run-control/facts.js";
import { assertNever, runPreparationStep, type StepRunOptions, type StepSpec } from "./step-runner.js";
import { toPreparationResult, type PreparationResult } from "./result.js";

export interface CalendarStagePort {
  inspectPreparation(targetDate: string): CalendarFacts;
  clickMonth(direction: "Next page" | "Previous page"): boolean;
  clickDate(date: string): boolean;
}

const DEADLINE_MESSAGE = "목표 월 또는 날짜 선택 상태를 제한 시간 안에 확인할 수 없습니다.";
export const CALENDAR_TIMEOUT_MESSAGE = "예약 날짜 준비 중 감시 종료 시각에 도달했습니다.";

function messageFor(cause: PreparationCause, via: FailureVia): string {
  if (via === "deadline") return DEADLINE_MESSAGE;
  return ({
    DATE_NOT_IN_CALENDAR: "목표 날짜가 현재 달력에 없습니다.",
    DATE_UNAVAILABLE: "목표 날짜를 선택할 수 없습니다.",
    MONTH_NAVIGATION_UNAVAILABLE: "목표 월로 이동할 수 없습니다.",
    MONTH_TRANSITION_STALLED: "달력 월 전환을 확인할 수 없습니다.",
    DATE_SELECTION_STALLED: "목표 날짜 선택 전환을 확인할 수 없습니다.",
  } as Partial<Record<PreparationCause, string>>)[cause] ?? DEADLINE_MESSAGE;
}

function monthSpec(port: CalendarStagePort, targetDate: string): StepSpec<CalendarFacts> {
  const targetMonth = targetDate.slice(0, 7);
  return {
    stage: "month",
    inspect: () => port.inspectPreparation(targetDate),
    conditionKey: (f) => `${f.displayedMonth}:${f.target !== null}:${f.monthNavigation?.available ?? "none"}`,
    conditionAttributes: (f) => ({
      displayedMonth: f.displayedMonth,
      targetVisible: f.target !== null,
      preparationTarget: targetDate,
    }),
    isReady: (f) => f.target !== null,
    fatal: (f) => classifyMonthFatal(f, targetMonth),
    canDispatch: (f) => f.monthNavigation?.available === true,
    dispatch: (f) => (f.monthNavigation ? port.clickMonth(f.monthNavigation.direction) : false),
    dispatchAction: "change_month",
    describeDispatch: (_f, attempt) => (attempt === 1
      ? `${targetMonth} 달력으로 이동합니다.`
      : `${targetMonth} 달력 이동을 재시도합니다.`),
    progressKey: (f) => f.displayedMonth ?? "",
    maxAttempts: 3,
    retryDelayMs: 750,
    confirmTimeoutMs: undefined,
  };
}

function dateSpec(port: CalendarStagePort, targetDate: string): StepSpec<CalendarFacts> {
  return {
    stage: "date",
    inspect: () => port.inspectPreparation(targetDate),
    conditionKey: (f) => `${f.target?.available}:${f.target?.selected}`,
    conditionAttributes: (f) => ({
      targetAvailable: f.target?.available ?? null,
      targetSelected: f.target?.selected ?? null,
      preparationTarget: targetDate,
    }),
    isReady: (f) => f.target?.selected === true,
    fatal: classifyDateFatal,
    /** 셀 소실은 원인 코드가 아니라 내부 재순환 신호다 — coordinator가 월 단계부터 다시 돈다. */
    interrupt: (f) => (f.target === null ? "target_cell_missing" : null),
    canDispatch: (f) => f.target?.available === true,
    dispatch: () => port.clickDate(targetDate),
    dispatchAction: "select_date",
    describeDispatch: (_f, attempt) => (attempt === 1
      ? `${targetDate} 날짜를 선택했습니다.`
      : `${targetDate} 날짜 선택을 재시도했습니다.`),
    progressKey: () => "steady",
    maxAttempts: 2,
    retryDelayMs: 1_000,
    confirmTimeoutMs: undefined,
  };
}

/** 월 이동 → 날짜 선택 순서를 소유한다. 날짜 준비 중 셀이 소실되면(달력이 다른
 * 월로 바뀜) interrupt 토큰을 받아 남은 deadline 안에서 월 단계부터 재순환한다 —
 * 현행 prepareTarget의 month↔date 오가는 동작 보존. 원인 코드는 제어에 쓰지 않는다. */
export async function runCalendarPreparation(
  port: CalendarStagePort,
  targetDate: string,
  options: StepRunOptions,
): Promise<PreparationResult> {
  while (true) {
    const monthOutcome = await runPreparationStep(monthSpec(port, targetDate), options);
    if (monthOutcome.kind !== "ready") {
      return toPreparationResult(monthOutcome, messageFor, CALENDAR_TIMEOUT_MESSAGE);
    }
    const dateOutcome = await runPreparationStep(dateSpec(port, targetDate), options);
    if (dateOutcome.kind === "interrupted") {
      switch (dateOutcome.token) {
        case "target_cell_missing": {
          if (options.clock.now() < Math.min(options.overallDeadlineAtMs, options.stopAtMs)) continue;
          const cause = classifyStall("date", dateOutcome.attempts);
          return {
            kind: "failed",
            cause,
            via: "deadline",
            attempts: dateOutcome.attempts,
            message: messageFor(cause, "deadline"),
          };
        }
        default:
          return assertNever(dateOutcome.token);
      }
    }
    return toPreparationResult(dateOutcome, messageFor, CALENDAR_TIMEOUT_MESSAGE);
  }
}
```

```ts
// src/content/preparation/person-coordinator.ts
import { classifyPersonFatal } from "../../shared/run-control/classifier.js";
import type { PersonFacts } from "../../shared/run-control/facts.js";
import { runPreparationStep, type StepRunOptions } from "./step-runner.js";
import { toPreparationResult, type PreparationResult } from "./result.js";

export interface PersonStagePort {
  inspect(personCount: number): PersonFacts;
  select(personCount: number): boolean;
}

export const PERSON_TIMEOUT_MESSAGE = "예약 인원 준비 중 감시 종료 시각에 도달했습니다.";

export async function runPersonPreparation(
  port: PersonStagePort,
  personCount: number,
  options: StepRunOptions,
): Promise<PreparationResult> {
  const outcome = await runPreparationStep<PersonFacts>({
    stage: "person",
    inspect: () => port.inspect(personCount),
    conditionKey: (f) => `${f.ready}:${f.targetAvailable}:${f.targetSelected}`,
    conditionAttributes: (f) => ({
      personControlReady: f.ready,
      targetPersonAvailable: f.targetAvailable,
      targetPersonSelected: f.targetSelected,
      preparationTargetPersonCount: personCount,
    }),
    isReady: (f) => f.targetSelected,
    fatal: classifyPersonFatal,
    canDispatch: (f) => f.targetAvailable,
    dispatch: () => port.select(personCount),
    dispatchAction: "select_person",
    describeDispatch: (_f, attempt) => (attempt === 1
      ? `${personCount}명으로 설정했습니다.`
      : `${personCount}명 선택을 재시도했습니다.`),
    progressKey: () => "steady",
    maxAttempts: 2,
    retryDelayMs: 1_000,
    confirmTimeoutMs: 2_000,
  }, options);
  return toPreparationResult(outcome,
    (cause) => (cause === "PERSON_UNAVAILABLE"
      ? `이 식당에서 ${personCount}명을 선택할 수 없습니다.`
      : "예약 인원 선택 상태를 제한 시간 안에 확인할 수 없습니다."),
    PERSON_TIMEOUT_MESSAGE);
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm run build && node --test tests/preparation-coordinators.test.mjs` / Expected: PASS 7건.
- [ ] **Step 5: Commit** — `git add src/content/preparation tests/preparation-coordinators.test.mjs && git commit -m "feat: add preparation stage coordinators"`

---

### Task 4: Adapter 사실 타입 단일화 + CalendarAdapter 사실 API 추가 (정책 제거는 Task 6)

**Files:**
- Modify: `src/content/adapter/calendar.ts` (`inspectPreparation`/`clickMonth` 추가 — `prepareTarget`은 이 Task에서 아직 유지)
- Modify: `src/content/adapter/entry.ts`, `src/content/adapter/person.ts` (로컬 `EntryInspection`/`PersonInspection` interface 삭제, shared `EntryFacts`/`PersonFacts`를 직접 반환 — 사실 타입 단일 소유)
- Modify: `src/content/orchestrator.ts` (EntryPort/PersonPort 타입 import를 shared facts로 교체)
- Test: `tests/calendar-adapter.test.mjs` (추가 케이스)

**Interfaces:**
- Consumes: `readCalendarCells`/`readDisplayedCalendarMonth` (`adapter/calendar-dom.ts`), `CalendarFacts`/`EntryFacts`/`PersonFacts` (`shared/run-control/facts.ts`)
- Produces: `EntryAdapter.inspect(): EntryFacts`, `PersonAdapter.inspect(personCount): PersonFacts`, `CalendarAdapter.inspectPreparation(targetDate): CalendarFacts`, `clickMonth(direction): boolean` — Task 3의 stage port 계약 구현. adapter가 반환하는 사실 타입의 정의처는 shared/run-control/facts.ts **한 곳**이다.

- [ ] **Step 1: 실패하는 테스트 작성** — 기존 `tests/calendar-adapter.test.mjs`에 추가(기존 fixture 재사용):

```js
test("inspectPreparation은 표시 월·목표 셀·월 이동 방향 사실을 반환한다", async () => {
  const dom = await loadFixture("calendar-navigation.html");
  const adapter = new CalendarAdapter(dom.window.document);
  const facts = adapter.inspectPreparation("2126-01-10"); // fixture 표시 월보다 먼 미래 → Next page
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

(fixture의 실제 표시 월·셀 구성은 기존 테스트 기대값 기준으로 assert를 구체화한다.)

추가로, Task 6에서 삭제될 prepareTarget 테스트가 커버하던 DOM 판독 시나리오를 **사실 단언으로 변환해 이 파일에 보존**한다. 변환 규칙: "prepareTarget 반환 status/message 단언" → "inspectPreparation 사실 필드 단언". 보존 대상과 기대 사실:

| 기존 시나리오 | inspectPreparation 기대 사실 |
|---|---|
| 같은 월인데 목표 셀 없음 | `displayedMonth === targetMonth`이고 `target === null` |
| disabled 목표 날짜 | `target: { available: false, ... }` |
| 월 제목 판독 불가(전환 중) | `displayedMonth === null` |
| 월 이동 control 부재/disabled | `monthNavigation === null` 또는 `{ available: false }` |
| Mobiscroll DOM(`calendar-mobiscroll.html`) | aria 변형과 동일한 사실 산출 |

변환 예시(기존 disabled 케이스):

```js
test("inspectPreparation: disabled 목표 날짜는 available=false 사실로 보고한다", async () => {
  const dom = await loadFixture("calendar.html");
  const adapter = new CalendarAdapter(dom.window.document);
  // 기존 prepareTarget 테스트가 사용하던 disabled 날짜 상수를 재사용한다.
  const facts = adapter.inspectPreparation(DISABLED_DATE);
  assert.deepEqual(facts.target, { available: false, selected: false });
});
```

- [ ] **Step 1-b: entry/person 사실 타입 단일화** — `adapter/entry.ts`에서 `export interface EntryInspection`을 삭제하고 `import type { EntryFacts } from "../../shared/run-control/facts.js";` 후 `inspect(): EntryFacts`로 변경. `adapter/person.ts`도 동일하게 `PersonFacts`로. orchestrator의 `import type { EntryInspection }`/`import type { PersonInspection }`을 shared facts import로 교체. 구조가 동일하므로(구조적 타이핑) 동작 변화 없음 — typecheck가 검증.

- [ ] **Step 2: 실패 확인** — Run: `npm run build && node --test tests/calendar-adapter.test.mjs` / Expected: 신규 케이스 FAIL, 기존 전부 PASS.

- [ ] **Step 3: 구현** — `CalendarAdapter`에 추가:

```ts
import type { CalendarFacts } from "../../shared/run-control/facts.js";

inspectPreparation(targetDate: string): CalendarFacts {
  const cells = this.readCells();
  const target = cells.find((cell) => cell.date === targetDate) ?? null;
  const displayedMonth = readDisplayedCalendarMonth(this.document);
  let monthNavigation: CalendarFacts["monthNavigation"] = null;
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

- [ ] **Step 4: 통과 확인** — Run: `npm run build && node --test tests/calendar-adapter.test.mjs` / Expected: 전부 PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat: expose calendar preparation facts on adapter"`

---

### Task 5: 오케스트레이터 통합 — prepare* 3벌을 coordinator 호출로 교체

**Files:**
- Modify: `src/content/orchestrator.ts` (prepareEntry/prepareDate/preparePerson 본문 교체, `tracePreparation` 호출점을 reporter 구현 1곳으로 수렴, CalendarPort 계약 변경)
- Test: `tests/orchestrator.test.mjs` (준비 단계 fake 포트 시그니처 갱신)

**Interfaces:**
- Consumes: Task 3 coordinator 3종 + `PreparationResult`, Task 2 `StepReporter`, Task 4 사실 API.
- Produces: `CalendarPort`가 `{ inspect, inspectPreparation, clickMonth, clickDate }`로 바뀜(`resetPreparation`/`prepareTarget` 제거는 Task 6). 실행영역 코드는 무변경.

- [ ] **Step 1: 오케스트레이터 준비 단계 테스트를 새 포트 계약으로 갱신** — fake calendar의 `prepareTarget` 기반 시나리오를 `inspectPreparation`/`clickMonth` 기반으로 바꾼다. 검증 불변 항목: ① 상태 전이 순서(`ENTERING_RESERVATION → SELECTING_DATE → SELECTING_PERSON → PREPARING_PAGE`), ② terminal 메시지 원문, ③ `preparationAttemptCount`/`preparationRecoveryDecision` 데이터 필드. 실행 단계 테스트는 한 줄도 수정하지 않는다.

**`preparationErrorCode`는 의도된 계약 변경이다** — 아래 구→신 매핑을 테스트로 고정한다(설계 §8-9). 사용자 가시 메시지는 불변, 코드만 세분화된다:

| 구 코드 (메시지 기준) | 신 코드 |
|---|---|
| `DATE_PREPARATION_BLOCKED` + "목표 날짜를 선택할 수 없습니다." | `DATE_UNAVAILABLE` |
| `DATE_PREPARATION_BLOCKED` + "목표 날짜가 현재 달력에 없습니다." | `DATE_NOT_IN_CALENDAR` |
| `DATE_PREPARATION_BLOCKED` + "목표 월로 이동할 수 없습니다." | `MONTH_NAVIGATION_UNAVAILABLE` |
| `DATE_PREPARATION_BLOCKED` + "달력 월 전환을 확인할 수 없습니다." | `MONTH_TRANSITION_STALLED` |
| `WAITING_ONLY` / `ENTRY_CTA_MISSING` / `ENTRY_TRANSITION_STALLED` / `DATE_SELECTION_STALLED` / `PERSON_UNAVAILABLE` / `PERSON_SELECTION_STALLED` | 유지 |

매핑 고정 테스트(orchestrator 테스트에 추가):

```js
test("구 DATE_PREPARATION_BLOCKED 경로는 세분화된 코드와 기존 메시지로 인계된다", async () => {
  // fake calendar: 목표 월 표시 + 목표 셀 없음 → 월 단계 최종 판정
  const { events } = await runWithFakeCalendar({
    inspectPreparation: () => ({ displayedMonth: TARGET_MONTH, target: null, monthNavigation: null }),
  });
  const handoff = events.findLast((e) => e.data?.state === "HANDED_OFF");
  assert.equal(handoff.message, "목표 날짜가 현재 달력에 없습니다.");
  assert.equal(handoff.data.preparationErrorCode, "DATE_NOT_IN_CALENDAR");
});
```

(`runWithFakeCalendar`는 기존 orchestrator 테스트의 세션 실행 헬퍼를 재사용한다 — 기존 테스트 파일의 START 구동 패턴과 동일.)

- [ ] **Step 2: 실패 확인** — Run: `npm test` / Expected: 갱신된 준비 시나리오 FAIL (아직 구 구현).

- [ ] **Step 3: 구현** — RunSession에 reporter 팩토리·결과 해석기·옵션 빌더를 추가하고 3개 메서드 본문을 교체한다. `tracePreparation`은 삭제하지 않고 reporter 구현 내부로 격리한다(발화점 고정 — trace phase·attribute 하위호환 유지).

```ts
// RunSession 내부에 추가
private stepReporter(): StepReporter {
  return {
    stageStart: () => this.tracePreparation("stage_start", { preparationStage: this.machine.state }),
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

private resolvePreparation(result: PreparationResult): RunResult | null {
  if (result.kind === "ready") return null;
  if (result.kind === "stopped") return this.finishStopped();
  if (result.kind === "timed_out") return this.timedOut(result.message);
  return this.diagnosticHandOff(result.message, {
    preparationErrorCode: result.cause,
    preparationAttemptCount: result.attempts,
    preparationRecoveryDecision: "handoff",
  });
}

private stepOptions(discoveryTimeoutMs: number, overallDeadlineAtMs: number): StepRunOptions {
  return {
    clock: this.serverClock,
    sleep: this.deps.sleep,
    signal: this.controller.signal,
    stopAtMs: this.config.stopAtMs,
    discoveryDeadlineAtMs: Math.min(this.serverClock.now() + discoveryTimeoutMs, this.config.stopAtMs),
    overallDeadlineAtMs,
    report: this.stepReporter(),
  };
}
```

교체된 3개 메서드:

```ts
private async prepareEntry(): Promise<RunResult | null> {
  if (this.config.entryMode !== "auto") return null;
  this.transition("ENTERING_RESERVATION", "예약창 진입 상태를 확인합니다.");
  const result = await runEntryPreparation(this.deps.entry,
    this.stepOptions(ENTRY_DISCOVERY_TIMEOUT_MS, this.config.stopAtMs));
  return this.resolvePreparation(result);
}

private async prepareDate(): Promise<RunResult | null> {
  if (this.config.entryMode !== "auto") return null;
  this.transition("SELECTING_DATE", "목표 월과 예약 날짜를 준비합니다.");
  const deadline = Math.min(this.serverClock.now() + DATE_PREPARATION_TIMEOUT_MS, this.config.stopAtMs);
  const result = await runCalendarPreparation(this.deps.calendar, this.config.reservationDate,
    this.stepOptions(DATE_PREPARATION_TIMEOUT_MS, deadline));
  return this.resolvePreparation(result);
}

private async preparePerson(): Promise<RunResult | null> {
  if (this.config.entryMode !== "auto") return null;
  this.transition("SELECTING_PERSON", "예약 인원을 준비합니다.");
  const result = await runPersonPreparation(this.deps.person, this.config.personCount,
    this.stepOptions(PERSON_DISCOVERY_TIMEOUT_MS, this.config.stopAtMs));
  return this.resolvePreparation(result);
}
```

상수 정리: `DATE_PREPARATION_TIMEOUT_MS = 10_000` 신설(기존 인라인 10초). `PREPARATION_MAX_DISPATCH_ATTEMPTS`/`PREPARATION_RETRY_DELAY_MS`/`ENTRY_CONFIRM_TIMEOUT_MS`/`PERSON_CONFIRM_TIMEOUT_MS`는 coordinator로 이동했으므로 orchestrator에서 삭제. `CalendarPort`는 `{ inspect, inspectPreparation, clickMonth, clickDate }`로 변경(당분간 `prepareTarget?`/`resetPreparation?` optional 유지 — Task 6에서 제거). `prepareDate`의 `this.deps.calendar.resetPreparation()` 호출 삭제(진행 상태가 runner의 run-scoped 지역 변수가 됐으므로 구조적으로 불필요).

- [ ] **Step 4: 통과 확인** — Run: `npm test` / Expected: 전부 PASS. 실행 단계 테스트 무변경 통과가 특히 중요.
- [ ] **Step 5: hot path diff 0 검증** — Run: `git diff HEAD~1 -- src/content/orchestrator.ts` 출력에서 `waitForOpen`/`runToggleCycle`/`advanceFromSlot`/`advancePostSlot` 본문 변경이 없는지 확인 / Expected: 준비 메서드·reporter 외 변경 없음.
- [ ] **Step 6: Commit** — `git commit -am "refactor: run preparation stages through coordinators"`

---

### Task 6: CalendarAdapter 정책 제거 + 잔재 정리

**Files:**
- Modify: `src/content/adapter/calendar.ts` (`prepareTarget`/`resetPreparation`/`CalendarPreparationResult`/`CalendarPreparationDispatch`/pending* 필드 전부 삭제)
- Modify: `src/content/orchestrator.ts` (CalendarPort에서 optional 잔재 제거)
- Test: `tests/calendar-adapter.test.mjs` (prepareTarget 테스트 삭제)

- [ ] **Step 1: prepareTarget 테스트 삭제 전 보존 체크리스트 확인** — 아래 6종이 전부 신규 테스트에 존재하는지 확인한 뒤에만 삭제한다(누락 시 이 Task에서 추가):

| 보존 대상 | 이전처 |
|---|---|
| 같은 월인데 목표 셀 없음 | `run-control-classifier.test.mjs`(month fatal) + `calendar-adapter.test.mjs`(사실 단언, Task 4) |
| disabled 날짜 | `calendar-adapter.test.mjs`(Task 4) + classifier `DATE_UNAVAILABLE` |
| 월 제목 판독 불가 | `calendar-adapter.test.mjs`(`displayedMonth === null`) + runner 빈 progressKey 케이스 |
| 월 이동 control 부재 | `calendar-adapter.test.mjs`(사실) + classifier `MONTH_NAVIGATION_UNAVAILABLE` |
| Mobiscroll DOM | `calendar-adapter.test.mjs`(Task 4, `calendar-mobiscroll.html`) |
| 구→신 오류 코드 매핑 | `orchestrator.test.mjs`(Task 5 매핑 테스트) |

월 전환 750ms×3 재시도 → `preparation-step-runner.test.mjs`(progressKey 리셋), 날짜 1s×2 재시도 → runner exhausted 케이스도 주석으로 기록한다.
- [ ] **Step 2: 삭제 구현** — `CalendarAdapter`에서 `preparingTarget`, `pendingMonth*`, `pendingDate*` 필드와 `prepareTarget`, `resetPreparation` 메서드, `CalendarPreparationResult`/`CalendarPreparationDispatch` export 삭제. 사용처가 없어지면 `monotonicNow` 생성자 파라미터도 삭제. orchestrator `CalendarPort`에서 optional 잔재 제거.
- [ ] **Step 3: 전체 게이트** — Run: `npm run check` / Expected: typecheck·전체 테스트·dist·independence 전부 PASS.
- [ ] **Step 4: Commit** — `git commit -am "refactor: reduce calendar adapter to facts and single actions"`

---

### Task 7: 마무리 — 문서·워크로그

**Files:**
- Modify: `docs/worklog/HANDOFF.md` (RT-16 항목에 Phase 1 완료 추가, 다음 단계 = Phase 2 control plane)
- Create: `docs/worklog/2026-MM-DD-NN-run-control-plane-phase1.md` (날짜·순번은 작성 시점 기준)
- Modify: `docs/plans/next-development.md` §6 (준비영역 책임 분리 완료, supervisor·URL 재진입은 Phase 2로 명시)

- [ ] **Step 1: 작업 로그 작성** — 변경 요약, 테스트 수 변화, hot path diff 0 확인 결과, 다음 단계(Phase 2 계획 = `31-control-plane-implementation.md`) 기록.
- [ ] **Step 2: HANDOFF 갱신** — "RT-16 오픈 전 준비 복원력" 절에 Phase 1 완료 상태와 blocking 여부 명시.
- [ ] **Step 3: 최종 게이트 + Commit** — Run: `npm run check` / Expected: 전부 PASS. `git add docs && git commit -m "docs: record run control plane phase 1 completion"`

---

## Phase 2 예고 (별도 계획: `31-control-plane-implementation.md`)

Phase 1 병합 후 작성한다. **작성 선행 요구(5차 리뷰)**: logicalRun status × 이벤트 **상태 전이표**, 쓰기 사이 **크래시 지점 목록**, **멱등 테스트 매트릭스**(durable flush, ACK disposition TERMINAL, 재전송 조회 순서, phase 단조, intent 재평가, 전이 원자성·START 멱등, TerminalEffects 멱등, FINISHING 경쟁 — 설계 §5.4에 계약 확정됨)를 먼저 담는다.

범위: `background/run-supervisor.ts` + `logicalRun` storage(attempt별 decision·message 영속, `recovery` intent — `nextAttemptId` 사전 생성, `terminalEffectsCompletedAt` 마커) + PageRuntimePort(`navigateIfNeeded`/`forceReenter`/inject/ping) + TerminalEffects 분리 + `AttemptControlMessage` 배선(flush→결정·intent 단일 영속→ACK→reenter 계약, 재전송 재ACK, `{ok:false, reason}` 응답) + content의 `GET_ATTEMPT_STATUS` 응답 + top-level bootstrap reconcile(설계 §5.4 4분기 표)과 `supervisorReady` barrier + 기존 리스너 5개 흡수 + `decide()` 배선 + RESET_PAGE 실행 + 알림 억제 + Side Panel RECOVERING 표시 + Chrome DevTools MCP E2E(ACK 직후 SW 강제 종료 → reconcile 멱등 재개 시나리오 포함). Phase 1의 causes/policy/protocol과 `PreparationResult`가 그대로 입력이 된다.

## Self-Review 결과

- 스펙 §5.1(adapter 축소) → Task 4·6, §5.2(runner/coordinator) → Task 2·3, §5.3(파일 분리 core) → Task 1, §5.4(protocol 타입) → Task 1(배선은 Phase 2), §6(telemetry 발화점) → Task 5 reporter, §7 Phase 1 항목 전부 매핑 확인.
- 분류 로직 위치: coordinator·runner에 Cause 리터럴 없음 — fatal은 classifier 함수 주입, stall은 `classifyStall` 호출(calendar coordinator의 interrupted-deadline 분기 포함). 셀 소실 재순환은 Cause가 아니라 interrupt 토큰(`"target_cell_missing"`)로 흐른다.
- 타입 일관성: `CalendarFacts`는 shared/run-control/facts.ts 단일 정의, Task 3 포트 계약·Task 4 adapter 구현 일치. `PreparationResult` 소비처(Task 5 `resolvePreparation`) 일치.
