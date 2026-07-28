# Run Control Plane — Phase 2 구현 계획 (Control Plane)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** background에 논리 실행(LogicalRun) 감독자를 세워 attempt 종결을 typed·ACK 프로토콜로 수신하고, 준비 정체에 한해 같은 탭 URL 재진입(RESET_PAGE)을 1회 실행하며, terminal 효과(알림·배지·job 종결)를 supervisor 결정 이후로만 이동한다. SW 재기동은 top-level reconcile이 4분기 표로 복구한다.

**Architecture:** `20-design.md` §4–5.6 (5차 리뷰 반영판). 순수 전이 로직(`shared/run-control/logical-run.ts`) + 효과 실행(`background/run-supervisor.ts`·`terminal-effects.ts`·`page-runtime-port.ts`). Phase 1의 causes/policy/protocol/`PreparationResult`가 입력이다. content는 attempt 1회 자율 실행을 유지하고 flush→전송→ACK 계약만 추가된다.

**Tech Stack:** TypeScript strict, node:test(+fake chrome ports), esbuild IIFE 번들, Chrome DevTools MCP E2E.

## Global Constraints

- shared core는 `chrome.*`/`window`/`document` 참조 금지. adapter 외 `querySelector` 금지.
- **실행 hot path(`waitForOpen` 이후) diff 0.** content 변경은 terminal 경계·준비 완료 경계에 한정한다.
- `activeRun`/`runEvents`/`reservationConfig` 형식 불변 — `logicalRun`은 추가 키.
- 사용자 가시 메시지·오류 코드는 Phase 1 확정 상태를 유지한다. 알림 메시지 원문도 불변(발화 시점만 이동).
- Telemetry는 어떤 제어 결정에도 사용하지 않는다. RUN_EVENT는 projection 전용으로 계속 흐른다.
- 자동화 경계 불변: RESET_PAGE는 같은 탭 URL 재진입 + 준비 재실행일 뿐, 로그인·CAPTCHA·결제·최종 확정을 건드리지 않는다.
- 각 Task 완료 시 `npm run check` 통과 후 커밋. 커밋 제목은 conventional prefix + 영어, 본문 없음.
- 테스트는 `dist/`를 import하므로 실행 전 `npm run build` 필수. 과거 실험 저장소 금지 문자열 사용 금지.

---

## A. LogicalRun 상태 전이표 (선행 산출물)

상태: `PREPARING`(첫/재시도 attempt 준비 중) · `EXECUTING`(오픈 감시·슬롯 단계) · `RECOVERING`(RESET 결정 영속, 재진입 진행) · `TERMINAL`.

| 현재 상태 | 이벤트 | 다음 상태 | 부수 효과(쓰기) |
|---|---|---|---|
| (없음) | startManual/startScheduled | PREPARING | logicalRun 생성 + activeRun/runEvents projection 초기화 |
| PREPARING | PHASE_CHANGED(EXECUTING, current) | EXECUTING | status만 |
| PREPARING | PHASE_CHANGED(PREPARING, current) | PREPARING | 없음(재ACK) |
| EXECUTING | PHASE_CHANGED(PREPARING, current) | EXECUTING | 거부 `phase_regression` |
| PREPARING | FINISHED(preparation_failed, current, decide=RESET) | RECOVERING | attempt 기록+decision RESET_PAGE, resetCount+1, recovery{next} — **단일 쓰기** |
| PREPARING | FINISHED(preparation_failed, current, decide=HANDOFF) | TERMINAL | attempt 기록+decision HANDOFF — 단일 쓰기 → 효과 |
| PREPARING·EXECUTING | FINISHED(terminal, current) | TERMINAL | attempt 기록+decision TERMINAL → 효과 |
| EXECUTING | FINISHED(preparation_failed, current) | TERMINAL | RESET 금지 — HANDOFF로 강제 |
| RECOVERING | recovery 실행(재평가 RESET 유지) | RECOVERING→PREPARING | dispatchedAt 쓰기 → reenter/inject/START → **단일 쓰기**(attempts push·currentAttemptId 교체·status PREPARING·recovery 제거) |
| RECOVERING | recovery 실행(재평가 HANDOFF 전환) | TERMINAL | recovery 제거+status — 단일 쓰기 → 효과 |
| 임의(비terminal) | stop/tab 닫힘/식당 이탈 | TERMINAL | attempt 기록(STOPPED)+decision TERMINAL — 단일 쓰기 → 효과 |
| TERMINAL | FINISHED(늦은 outcome, 미결정 attempt) | TERMINAL | attempt 기록+decision TERMINAL(재decide 없음) |
| 모든 상태 | FINISHED/PHASE(비current, 결정 있음) | 불변 | 저장된 decision 재ACK(payload 불일치는 `outcome_conflict`) |
| 모든 상태 | FINISHED/PHASE(비current, 결정 없음) | 불변 | 거부 `stale_attempt` |
| (logicalRun 없음) | FINISHED/PHASE | — | 거부 `unknown_logical_run` |

## B. 쓰기 사이 크래시 지점 목록 (reconcile 복구 근거)

| # | 크래시 지점 | 저장 상태 | reconcile 복구 |
|---|---|---|---|
| C1 | logicalRun 생성 후 ~ START 전달 전 | PREPARING, attempt 미실행 | GET_ATTEMPT_STATUS 미응답 → 안전 terminal FAILED("실행 문맥이 유실됐습니다") → 효과 |
| C2 | attempt 실행 중 | PREPARING/EXECUTING, 실행 중 | 개입 없음 |
| C3 | content terminal 후 ATTEMPT_FINISHED 유실(SW 사망) | PREPARING/EXECUTING, content phase=FINISHING | status 조회가 pendingOutcome을 겸수신 → outcome 정상 처리 |
| C4 | decide 영속(단일 쓰기) 직후 ~ ACK 전 | RECOVERING(or TERMINAL) + decision 영속 | content 재전송 → 저장 decision 재ACK. reconcile은 RECOVERING → 재개 / TERMINAL+효과마커 없음 → 효과 재개 |
| C5 | ACK 후 ~ dispatchedAt 전 | RECOVERING, dispatchedAt 없음 | 재평가 후 reenter 시퀀스 처음부터 재개 |
| C6 | dispatchedAt 후 ~ START 성공 전 | RECOVERING, dispatchedAt 있음 | nextAttemptId로 status 조회 → 미실행이면 inject+START 재시도(content START는 동일 runId 멱등) |
| C7 | START 성공 후 ~ beginNextAttempt 쓰기 전 | RECOVERING, next attempt 실행 중 | status 조회 실행 중 확인 → beginNextAttempt 쓰기만 수행 |
| C8 | TERMINAL 쓰기 후 ~ 효과 완료 전 | TERMINAL, terminalEffectsCompletedAt 없음 | 영속된 attempt message·finishedAt으로 효과 재실행(멱등 ID) |

## C. 멱등 테스트 매트릭스 (5차 리뷰 8건 → 테스트 고정)

| 계약 | 테스트 위치 |
|---|---|
| durable flush 결과 동반(`flushOk`) — 유실 기록, 복구는 계속 | `trace-batch.test` 확장 + supervisor attempt 기록 |
| ACK disposition `TERMINAL` | logical-run(terminal outcome) |
| 재전송 조회 순서: attempt 기록 → payload 검증 → stale | logical-run(replay/`outcome_conflict`/`stale_attempt` 3건) |
| phase 단조(PREPARING→EXECUTING, 중복 재ACK, 역행 거부) | logical-run(phase 4건) |
| RESET intent 시효 재평가(늦은 재기동 → HANDOFF 전환) | supervisor(recovery lapse) |
| nextAttempt 전이 원자성 + content START 멱등 | logical-run(beginNextAttempt) + content(START 재수신) |
| TerminalEffects 멱등(결정적 알림 ID, 이중 실행 무해) | terminal-effects |
| FINISHING 경쟁(상태 응답의 pendingOutcome 겸수신 + 이후 재전송 재ACK) | supervisor(reconcile C3) |

---

## 파일 구조 (Phase 2 종료 시점)

```text
src/shared/run-control/protocol.ts        # Phase 2 확장(TERMINAL·FINISHING·pendingOutcome·reason 2종)
src/shared/run-control/logical-run.ts     # LogicalRun 타입 + 순수 전이 함수 (신규)
src/background/page-runtime-port.ts       # navigateIfNeeded/forceReenter/inject/startAttempt/getAttemptStatus (신규)
src/background/terminal-effects.ts        # 배지·알림·finishJob — 멱등 (신규)
src/background/run-supervisor.ts          # 진입점 통일·outcome ingress·recovery·reconcile (신규)
src/background/index.ts                   # supervisor 배선, 리스너 흡수, recordEvent 효과 분기 삭제
src/content/index.ts                      # attempt 제어 전송·GET_ATTEMPT_STATUS·FINISHING·START 멱등
src/content/orchestrator.ts               # RunResult 확장 + EXECUTING 신호 (terminal 경계만)
src/content/telemetry/batch-processor.ts  # forceFlush(): Promise<boolean>
src/content/telemetry/trace-logger.ts     # forceFlush 반환 전달 + RUN_STARTED attempt attrs
src/shared/telemetry/codes.ts             # RECOVERY_DECIDED · RECOVERY_DISPATCHED
src/background/telemetry/trace-ingestor.ts# recordRecovery()
src/shared/types.ts                       # ContentCommand START/GET_ATTEMPT_STATUS 확장
src/sidepanel/index.ts                    # RECOVERING 1줄 표시
tests/logical-run.test.mjs                # 전이표·멱등 매트릭스의 순수 부분 (신규)
tests/terminal-effects.test.mjs           # 멱등 효과 (신규)
tests/page-runtime-port.test.mjs          # reenter/inject 계약 (신규)
tests/run-supervisor.test.mjs             # ingress·recovery·reconcile (신규)
tests/orchestrator.test.mjs               # RunResult message/preparation·EXECUTING 신호만 추가
tests/background-storage.test.mjs         # recordEvent 효과 분기 삭제 반영
```

---

### Task 1: protocol Phase 2 확장 + LogicalRun 순수 전이 모듈

**Files:**
- Modify: `src/shared/run-control/protocol.ts`
- Create: `src/shared/run-control/logical-run.ts`
- Test: `tests/logical-run.test.mjs`

**Interfaces:**
- Consumes: `decide`/`RecoveryAction`(policy.ts), `PreparationCause`, `ReservationConfig`.
- Produces: `LogicalRun`/`AttemptRecord`/`AttemptDecision`, `createLogicalRun`, `applyAttemptOutcome`, `applyPhaseChange`, `beginNextAttempt`, `markRecoveryDispatched`, `applyRecoveryLapse`, `applyBackgroundTerminal`, `markTerminalEffectsCompleted` — Task 4·6이 사용. protocol의 `AttemptFinishedAck.decision`에 `"TERMINAL"`, `AttemptAckFailureReason`에 `"outcome_conflict" | "phase_regression"`, `AttemptStatusResponse.phase`에 `"FINISHING"`, `pendingOutcome?: AttemptOutcome`, `AttemptFinishedMessage.flush: { ok: boolean }` 추가.

- [ ] **Step 1: 실패하는 테스트 작성** — §A 전이표와 §C 매트릭스의 순수 부분을 전수 고정한다.

```js
// tests/logical-run.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAttemptOutcome, applyBackgroundTerminal, applyPhaseChange, applyRecoveryLapse,
  beginNextAttempt, createLogicalRun, markRecoveryDispatched, markTerminalEffectsCompleted,
} from "../dist/shared/run-control/logical-run.js";

function config(overrides = {}) {
  return {
    targetUrl: "https://app.catchtable.co.kr/ct/shop/kea",
    openAtMs: 1_000_000, reservationDate: "2026-08-20", personCount: 2,
    timeRange: { startMinutes: 1080, endMinutes: 1200 }, priorityTimes: [],
    postSlotEnabled: false, paymentMethodAutoAdvance: false, paymentMethodPolicy: "selected_allowed",
    tablePreference: "any", menuKeyword: "", stopAtMs: 2_000_000,
    entryMode: "auto", dryRun: true, preOpenLeadMs: 300, toggleIntervalMs: 400,
    ...overrides,
  };
}

function run(overrides = {}) {
  return {
    ...createLogicalRun({
      logicalRunId: "lr-1", origin: { kind: "manual" }, config: config(),
      tabId: 7, attemptId: "run-a1", nowMs: 0,
    }),
    ...overrides,
  };
}

const prepFailed = (overrides = {}) => ({
  kind: "preparation_failed", state: "HANDED_OFF", cause: "DATE_SELECTION_STALLED",
  attempts: 2, message: "목표 날짜 선택 전환을 확인할 수 없습니다.", finishedAt: 10_000, ...overrides,
});

test("생성: PREPARING + attempt 1개 + resetCount 0", () => {
  const r = run();
  assert.equal(r.status, "PREPARING");
  assert.equal(r.currentAttemptId, "run-a1");
  assert.deepEqual(r.attempts.map((a) => a.runId), ["run-a1"]);
  assert.equal(r.resetCount, 0);
});

test("준비 정체 + 여유 시간 → RECOVERING, resetCount 1, nextAttemptId 영속", () => {
  const out = applyAttemptOutcome(run(), "run-a1", prepFailed(), 10_000, "run-a2");
  assert.equal(out.kind, "ack");
  assert.equal(out.decision, "RESET_PAGE");
  assert.equal(out.run.status, "RECOVERING");
  assert.equal(out.run.resetCount, 1);
  assert.deepEqual(out.run.recovery, { sourceAttemptId: "run-a1", nextAttemptId: "run-a2", action: "RESET_PAGE" });
  const a1 = out.run.attempts.find((a) => a.runId === "run-a1");
  assert.equal(a1.decision, "RESET_PAGE");
  assert.equal(a1.message, "목표 날짜 선택 전환을 확인할 수 없습니다.");
  assert.equal(a1.finishedAt, 10_000);
});

test("종결 원인·예산 소진·오픈 임박·prepared 모드는 HANDOFF → TERMINAL", () => {
  for (const [r, outcome, now] of [
    [run(), prepFailed({ cause: "DATE_UNAVAILABLE" }), 10_000],
    [run({ resetCount: 1 }), prepFailed(), 10_000],
    [run(), prepFailed(), 990_000], // msToOpen 10s < RESET_MIN_LEAD
    [run({ config: config({ entryMode: "prepared" }) }), prepFailed(), 10_000],
  ]) {
    const out = applyAttemptOutcome(r, "run-a1", outcome, now, "run-a2");
    assert.equal(out.decision, "HANDOFF");
    assert.equal(out.run.status, "TERMINAL");
    assert.equal(out.run.recovery, undefined);
  }
});

test("terminal outcome은 decision TERMINAL로 종결한다 (ACK disposition)", () => {
  const out = applyAttemptOutcome(run(), "run-a1",
    { kind: "terminal", state: "DRY_RUN_COMPLETED", message: "dry-run 완료", finishedAt: 5 }, 5, "run-a2");
  assert.deepEqual({ kind: out.kind, decision: out.decision, status: out.run.status },
    { kind: "ack", decision: "TERMINAL", status: "TERMINAL" });
});

test("EXECUTING 진입 후 preparation_failed는 RESET을 금지한다", () => {
  const executing = applyPhaseChange(run(), "run-a1", "EXECUTING").run;
  const out = applyAttemptOutcome(executing, "run-a1", prepFailed(), 10_000, "run-a2");
  assert.equal(out.decision, "HANDOFF");
});

test("재전송 조회 순서: 결정된 attempt 재전송은 replay, payload 불일치는 outcome_conflict, 미결정 비current는 stale", () => {
  const decided = applyAttemptOutcome(run(), "run-a1", prepFailed(), 10_000, "run-a2").run;
  const replay = applyAttemptOutcome(decided, "run-a1", prepFailed(), 11_000, "run-a3");
  assert.deepEqual({ kind: replay.kind, decision: replay.decision }, { kind: "replay", decision: "RESET_PAGE" });
  assert.equal(decided.resetCount, 1); // replay는 새 run을 만들지 않는다(이중 증가 없음)
  const conflict = applyAttemptOutcome(decided, "run-a1", prepFailed({ message: "다른 메시지" }), 11_000, "run-a3");
  assert.deepEqual(conflict, { kind: "reject", reason: "outcome_conflict" });
  const next = beginNextAttempt(decided, 12_000);
  const stale = applyAttemptOutcome(next, "run-zzz", prepFailed(), 13_000, "run-a9");
  assert.deepEqual(stale, { kind: "reject", reason: "stale_attempt" });
});

test("phase 단조: PREPARING→EXECUTING ok, 중복 재ACK, 역행 거부", () => {
  const r = run();
  const ok = applyPhaseChange(r, "run-a1", "EXECUTING");
  assert.deepEqual({ kind: ok.kind, status: ok.run.status }, { kind: "ok", status: "EXECUTING" });
  assert.equal(applyPhaseChange(ok.run, "run-a1", "EXECUTING").kind, "replay");
  assert.equal(applyPhaseChange(r, "run-a1", "PREPARING").kind, "replay");
  assert.deepEqual(applyPhaseChange(ok.run, "run-a1", "PREPARING"), { kind: "reject", reason: "phase_regression" });
  assert.deepEqual(applyPhaseChange(r, "run-x", "EXECUTING"), { kind: "reject", reason: "stale_attempt" });
});

test("beginNextAttempt은 단일 전이로 attempts 추가·current 교체·PREPARING·recovery 제거를 수행한다", () => {
  const recovering = applyAttemptOutcome(run(), "run-a1", prepFailed(), 10_000, "run-a2").run;
  const dispatched = markRecoveryDispatched(recovering, 10_500);
  assert.equal(dispatched.recovery.dispatchedAt, 10_500);
  const next = beginNextAttempt(dispatched, 11_000);
  assert.deepEqual({
    status: next.status, current: next.currentAttemptId,
    ids: next.attempts.map((a) => a.runId), recovery: next.recovery,
  }, { status: "PREPARING", current: "run-a2", ids: ["run-a1", "run-a2"], recovery: undefined });
});

test("recovery lapse는 TERMINAL로 전환하고 recovery를 제거한다", () => {
  const recovering = applyAttemptOutcome(run(), "run-a1", prepFailed(), 10_000, "run-a2").run;
  const lapsed = applyRecoveryLapse(recovering, 995_000);
  assert.deepEqual({ status: lapsed.status, recovery: lapsed.recovery },
    { status: "TERMINAL", recovery: undefined });
});

test("background terminal은 종결 기록을 남기되 decision은 찍지 않는다(재ACK할 content 메시지가 없다)", () => {
  const r = applyBackgroundTerminal(run(), "STOPPED", "실행 탭이 닫혔습니다.", 20_000);
  const a1 = r.attempts.find((a) => a.runId === "run-a1");
  assert.deepEqual({ status: r.status, state: a1.finalState, decision: a1.decision, message: a1.message },
    { status: "TERMINAL", state: "STOPPED", decision: undefined, message: "실행 탭이 닫혔습니다." });
});

test("이미 TERMINAL인 run에 도착한 늦은 outcome은 재decide 없이 TERMINAL로 기록한다", () => {
  const stopped = applyBackgroundTerminal(run(), "STOPPED", "실행 탭이 닫혔습니다.", 20_000);
  const out = applyAttemptOutcome(stopped, "run-a1", prepFailed(), 21_000, "run-a2");
  assert.equal(out.decision, "TERMINAL");
  assert.equal(out.run.status, "TERMINAL");
  assert.equal(out.run.resetCount, 0);
});

test("markTerminalEffectsCompleted는 완료 시각을 남긴다", () => {
  const done = markTerminalEffectsCompleted(
    applyBackgroundTerminal(run(), "STOPPED", "중지", 1), 2);
  assert.equal(done.terminalEffectsCompletedAt, 2);
});

- [ ] **Step 2: 실패 확인** — Run: `npm run build && node --test tests/logical-run.test.mjs` / Expected: 모듈 없음으로 FAIL.

- [ ] **Step 3: protocol 확장 구현** — `src/shared/run-control/protocol.ts`에서 아래 타입을 교체·추가한다 (기존 주석 유지):

```ts
export type AttemptAckFailureReason =
  | "unknown_logical_run" | "stale_attempt" | "outcome_conflict" | "phase_regression";
export type AttemptFinishedAck =
  // TERMINAL = 일반 종결(COMPLETED/STOPPED/FAILED 등) 접수 — 복구 결정이 아니다.
  | { ok: true; decision: "RESET_PAGE" | "HANDOFF" | "TERMINAL" }
  | { ok: false; reason: AttemptAckFailureReason };

// content → background. flush: durable flush 결과 동반(5차) — 복구 진행은 결과와 무관, 유실 사실만 기록.
export type AttemptControlMessage =
  | { type: "ATTEMPT_PHASE_CHANGED"; logicalRunId: string; attemptId: string; phase: AttemptPhase }
  | {
    type: "ATTEMPT_FINISHED"; logicalRunId: string; attemptId: string;
    outcome: AttemptOutcome; flush: { ok: boolean };
  };

// FINISHING = terminal 도달 후 ATTEMPT_FINISHED 전송 중 — reconcile 오판 방지(§5.4).
export interface AttemptStatusResponse {
  attemptId: string;
  running: boolean;
  phase: AttemptPhase | "FINISHING" | null;
  /** FINISHING이면 상태 응답이 outcome 수신 경로를 겸한다. */
  pendingOutcome?: AttemptOutcome;
}
```

- [ ] **Step 4: logical-run 구현**

```ts
// src/shared/run-control/logical-run.ts — LogicalRun 순수 전이. chrome/DOM 무접근.
import type { ReservationConfig } from "../types.js";
import type { PreparationCause } from "./causes.js";
import { decide } from "./policy.js";
import type {
  AttemptAckFailureReason, AttemptOutcome, AttemptPhase, TerminalRunState,
} from "./protocol.js";

export type LogicalRunStatus = "PREPARING" | "EXECUTING" | "RECOVERING" | "TERMINAL";
export type AttemptDecision = "RESET_PAGE" | "HANDOFF" | "TERMINAL";

export interface AttemptRecord {
  runId: string;            // = attemptId
  startedAt: number;
  finalState?: TerminalRunState;
  cause?: PreparationCause;
  /** TerminalEffects 재개용 — ACK 후 SW가 죽어도 알림을 복원한다. */
  message?: string;
  finishedAt?: number;
  /** 멱등 재ACK의 근거. */
  decision?: AttemptDecision;
  decidedAt?: number;
  /** durable flush 결과 — 유실 사실 기록(제어에 사용하지 않음). */
  flushOk?: boolean;
}

export interface LogicalRun {
  logicalRunId: string;
  origin: { kind: "manual" } | { kind: "scheduled"; jobId: string };
  config: ReservationConfig;
  tabId: number;
  status: LogicalRunStatus;
  startedAt: number;
  updatedAt: number;
  resetCount: number;
  currentAttemptId: string;
  attempts: AttemptRecord[];
  /** RESET 결정 후 실행 전 SW 사망을 복구하는 영속 intent. nextAttemptId는 결정 시점에 생성한다. */
  recovery?: { sourceAttemptId: string; nextAttemptId: string; action: "RESET_PAGE"; dispatchedAt?: number };
  /** TerminalEffects(알림·배지·job 종료) 완료 마커 — 없으면 reconcile이 재개한다. */
  terminalEffectsCompletedAt?: number;
}

export type OutcomeApplication =
  | { kind: "ack"; run: LogicalRun; decision: AttemptDecision }
  | { kind: "replay"; decision: AttemptDecision }
  | { kind: "reject"; reason: AttemptAckFailureReason };

export type PhaseApplication =
  | { kind: "ok"; run: LogicalRun }
  | { kind: "replay" }
  | { kind: "reject"; reason: AttemptAckFailureReason };

export function createLogicalRun(input: {
  logicalRunId: string;
  origin: LogicalRun["origin"];
  config: ReservationConfig;
  tabId: number;
  attemptId: string;
  nowMs: number;
}): LogicalRun {
  return {
    logicalRunId: input.logicalRunId,
    origin: input.origin,
    config: input.config,
    tabId: input.tabId,
    status: "PREPARING",
    startedAt: input.nowMs,
    updatedAt: input.nowMs,
    resetCount: 0,
    currentAttemptId: input.attemptId,
    attempts: [{ runId: input.attemptId, startedAt: input.nowMs }],
  };
}

function finishedRecord(record: AttemptRecord, outcome: AttemptOutcome, decision: AttemptDecision, nowMs: number, flushOk?: boolean): AttemptRecord {
  return {
    ...record,
    finalState: outcome.state,
    ...(outcome.kind === "preparation_failed" ? { cause: outcome.cause } : {}),
    message: outcome.message,
    finishedAt: outcome.finishedAt,
    decision,
    decidedAt: nowMs,
    ...(flushOk === undefined ? {} : { flushOk }),
  };
}

function sameOutcome(record: AttemptRecord, outcome: AttemptOutcome): boolean {
  return record.finalState === outcome.state && record.message === outcome.message;
}

/** §A 전이표의 FINISHED 행 전부. 재전송 조회 순서: attempt 기록 → payload 검증 → stale. */
export function applyAttemptOutcome(
  run: LogicalRun,
  attemptId: string,
  outcome: AttemptOutcome,
  nowMs: number,
  nextAttemptId: string,
  flushOk?: boolean,
): OutcomeApplication {
  const record = run.attempts.find((attempt) => attempt.runId === attemptId);
  if (record?.decision !== undefined) {
    return sameOutcome(record, outcome)
      ? { kind: "replay", decision: record.decision }
      : { kind: "reject", reason: "outcome_conflict" };
  }
  if (attemptId !== run.currentAttemptId || record === undefined) {
    return { kind: "reject", reason: "stale_attempt" };
  }
  const withRecord = (decision: AttemptDecision, status: LogicalRunStatus, extra: Partial<LogicalRun> = {}): LogicalRun => ({
    ...run,
    ...extra,
    status,
    updatedAt: nowMs,
    attempts: run.attempts.map((attempt) => (attempt.runId === attemptId
      ? finishedRecord(attempt, outcome, decision, nowMs, flushOk)
      : attempt)),
  });
  // 이미 background가 종결한 run(탭 닫힘 등)에 늦게 도착한 outcome — 재decide 없이 접수만.
  if (run.status === "TERMINAL" || outcome.kind === "terminal") {
    return { kind: "ack", run: withRecord("TERMINAL", "TERMINAL"), decision: "TERMINAL" };
  }
  // EXECUTING 진입 후에는 어떤 RESET도 금지(§5.4) — 구조상 도달하지 않지만 가드한다.
  const action = run.status === "PREPARING"
    ? decide(outcome.cause, { resetCount: run.resetCount },
      { msToOpen: run.config.openAtMs - nowMs, msToStop: run.config.stopAtMs - nowMs },
      { entryMode: run.config.entryMode })
    : { kind: "HANDOFF" as const, cause: outcome.cause };
  if (action.kind === "RESET_PAGE") {
    return {
      kind: "ack",
      decision: "RESET_PAGE",
      run: withRecord("RESET_PAGE", "RECOVERING", {
        resetCount: run.resetCount + 1,
        recovery: { sourceAttemptId: attemptId, nextAttemptId, action: "RESET_PAGE" },
      }),
    };
  }
  return { kind: "ack", run: withRecord("HANDOFF", "TERMINAL"), decision: "HANDOFF" };
}

/** phase 단조: PREPARING → EXECUTING만 전진. 중복은 재ACK, 역행은 거부. */
export function applyPhaseChange(run: LogicalRun, attemptId: string, phase: AttemptPhase): PhaseApplication {
  const record = run.attempts.find((attempt) => attempt.runId === attemptId);
  if (attemptId !== run.currentAttemptId || record === undefined || record.decision !== undefined
    || run.status === "TERMINAL" || run.status === "RECOVERING") {
    return { kind: "reject", reason: "stale_attempt" };
  }
  if (run.status === phase) return { kind: "replay" };
  if (run.status === "EXECUTING" && phase === "PREPARING") {
    return { kind: "reject", reason: "phase_regression" };
  }
  // 순수 모듈은 Date.now()를 직접 부르지 않는다 — updatedAt은 관측 편의 필드라
  // phase 전이에서는 기존 값을 유지한다(시각이 필요한 전이는 전부 nowMs를 받는다).
  return { kind: "ok", run: { ...run, status: "EXECUTING" } };
}

/** 전이 원자성(§5.4): attempts 추가·currentAttemptId 교체·PREPARING·recovery 제거를 한 값으로. */
export function beginNextAttempt(run: LogicalRun, nowMs: number): LogicalRun {
  if (run.recovery === undefined) throw new Error("recovery intent 없이 다음 attempt를 시작할 수 없습니다.");
  return {
    ...run,
    status: "PREPARING",
    updatedAt: nowMs,
    currentAttemptId: run.recovery.nextAttemptId,
    attempts: [...run.attempts, { runId: run.recovery.nextAttemptId, startedAt: nowMs }],
    recovery: undefined,
  };
}

export function markRecoveryDispatched(run: LogicalRun, nowMs: number): LogicalRun {
  if (run.recovery === undefined) throw new Error("recovery intent가 없습니다.");
  return { ...run, updatedAt: nowMs, recovery: { ...run.recovery, dispatchedAt: nowMs } };
}

/** RESET intent 시효(§5.4): 실행 직전 재평가에서 창이 지났으면 terminal로 확정한다. */
export function applyRecoveryLapse(run: LogicalRun, nowMs: number): LogicalRun {
  return { ...run, status: "TERMINAL", updatedAt: nowMs, recovery: undefined };
}

/** stop·탭 닫힘·식당 이탈 등 background 종결 ingress.
 * decision은 찍지 않는다 — 재ACK할 content 메시지가 없고, 늦게 도착한 content
 * outcome은 status TERMINAL 분기에서 decision TERMINAL로 접수돼야 한다. */
export function applyBackgroundTerminal(
  run: LogicalRun,
  state: TerminalRunState,
  message: string,
  nowMs: number,
): LogicalRun {
  return {
    ...run,
    status: "TERMINAL",
    updatedAt: nowMs,
    recovery: undefined,
    attempts: run.attempts.map((attempt) => (attempt.runId === run.currentAttemptId && attempt.decision === undefined
      ? { ...attempt, finalState: state, message, finishedAt: nowMs }
      : attempt)),
  };
}

export function markTerminalEffectsCompleted(run: LogicalRun, nowMs: number): LogicalRun {
  return { ...run, updatedAt: nowMs, terminalEffectsCompletedAt: nowMs };
}
```

- [ ] **Step 5: 통과 확인** — Run: `npm run build && node --test tests/logical-run.test.mjs` / Expected: PASS 11건.
- [ ] **Step 6: Commit** — `git add src/shared/run-control tests/logical-run.test.mjs && git commit -m "feat: add logical run transitions and phase 2 protocol"`

---

### Task 2: durable flush + recovery trace 코드

**Files:**
- Modify: `src/content/telemetry/batch-processor.ts` (`forceFlush(): Promise<boolean>` — timeout 안에 마지막 batch ACK를 받았는지 반환)
- Modify: `src/content/telemetry/trace-logger.ts` (`forceFlush()` 반환 전달, `start()`에 attempt attrs)
- Modify: `src/shared/telemetry/codes.ts` (`RECOVERY_DECIDED`, `RECOVERY_DISPATCHED` 추가)
- Modify: `src/background/telemetry/trace-ingestor.ts` (`recordRecovery()` 추가)
- Modify: `src/content/orchestrator.ts`의 `Dependencies.flushTrace` 타입을 `() => Promise<boolean>`으로 (호출부는 반환값을 쓰지 않으므로 동작 불변)
- Test: `tests/trace-batch-processor.test.mjs`,
  `tests/port-trace-transport.test.mjs`에 케이스 추가

**Interfaces:**
- Produces: `BatchTraceProcessor.forceFlush(timeoutMs?): Promise<boolean>` (true = 모든 발행 batch ACK 수신), `TraceLogger.forceFlush(): Promise<boolean>`, `TraceLogger.start(runId, config, scheduledJobId?, attempt?: { logicalRunId: string; attemptIndex: number; resetCause?: string })` — RUN_STARTED attributes에 `logicalRunId`/`attemptIndex`/`resetCause` 기록, `TraceIngestor.recordRecovery(runId, config, code: "RECOVERY_DECIDED" | "RECOVERY_DISPATCHED", message: string, attributes: TraceAttributes, scheduledJobId?)`.

- [ ] **Step 1: 실패하는 테스트 작성** — batch 테스트에 추가: ① ACK가 모두 도착한 forceFlush는 true, ② transport가 ACK를 주지 않으면 timeout 후 false(기존처럼 resolve는 한다), ③ TraceLogger.start의 attempt 인자가 RUN_STARTED attributes로 나간다.
- [ ] **Step 2: 실패 확인** — Run:
  `npm run build && node --test tests/trace-batch-processor.test.mjs tests/port-trace-transport.test.mjs`
  / Expected: 신규 케이스 FAIL.
- [ ] **Step 3: 구현** — `forceFlush`는 내부에서 미ACK batch 수를 추적해 timeout 시점에 `pendingAcks === 0`을 반환한다. `codes.ts` 배열에 두 코드 추가(CRITICAL 아님). `recordRecovery`는 기존 `recordBackgroundFailure`와 동일한 저장 경로로 run 없는 경우도 upsert한다.
- [ ] **Step 4: 통과 확인** — Run: `npm test` / Expected: 전부 PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat: add durable flush result and recovery trace codes"`

---

### Task 3: TerminalEffects — 효과를 supervisor 결정 이후로 이동

**Files:**
- Create: `src/background/terminal-effects.ts`
- Modify: `src/background/index.ts` (`recordEvent`에서 배지·알림·`jobScheduler.onRunTerminal` 분기 **삭제** — projection 저장만 남긴다)
- Test: `tests/terminal-effects.test.mjs`, `tests/background-storage.test.mjs`(효과 분기 삭제 반영)

**Interfaces:**
- Consumes: `LogicalRun`/`AttemptRecord` (Task 1).
- Produces: `runTerminalEffects(run: LogicalRun, deps: TerminalEffectsDependencies): Promise<void>` — Task 6 supervisor의 유일한 효과 경로.

```ts
// src/background/terminal-effects.ts
import type { LogicalRun } from "../shared/run-control/logical-run.js";
import type { TerminalRunState } from "../shared/run-control/protocol.js";

export interface TerminalEffectsDependencies {
  setBadge(color: string, text: string): Promise<void>;
  /** 결정적 notificationId — 같은 run의 재실행은 새 알림을 만들지 않는다(멱등). */
  notify(notificationId: string, message: string): void;
  finishJob(jobId: string, state: TerminalRunState, message: string, finishedAt: number): Promise<void>;
}

export async function runTerminalEffects(run: LogicalRun, deps: TerminalEffectsDependencies): Promise<void> {
  const attempt = run.attempts.find((candidate) => candidate.runId === run.currentAttemptId);
  const state = attempt?.finalState ?? "FAILED";
  const message = attempt?.message ?? "실행이 종료됐습니다.";
  const finishedAt = attempt?.finishedAt ?? run.updatedAt;
  const needsAttention = state === "HANDED_OFF" || state === "DRY_RUN_COMPLETED";
  await deps.setBadge(needsAttention ? "#ff5a1f" : "#4b5563", needsAttention ? "!" : "");
  if (needsAttention || state === "TIMED_OUT" || state === "FAILED") {
    deps.notify(`run-terminal:${run.logicalRunId}`, message);
  }
  if (run.origin.kind === "scheduled") {
    await deps.finishJob(run.origin.jobId, state, message, finishedAt);
  }
}
```

- [ ] **Step 1: 실패하는 테스트 작성** — ① HANDED_OFF/DRY_RUN_COMPLETED는 주황 배지+알림, ② STOPPED는 회색 배지·알림 없음, ③ TIMED_OUT/FAILED는 알림 있음, ④ scheduled origin은 finishJob 호출(영속된 message·finishedAt 사용 — telemetry를 다시 읽지 않는다), ⑤ 같은 run 이중 실행 시 notify가 동일 ID로 호출된다(멱등 근거), ⑥ RESET 결정(RECOVERING)에서는 아예 호출되지 않음은 supervisor 테스트(Task 6)가 고정.
- [ ] **Step 2: 실패 확인** — Run: `npm run build && node --test tests/terminal-effects.test.mjs` / Expected: FAIL.
- [ ] **Step 3: 구현 + recordEvent 분기 삭제** — 위 코드 생성. `background/index.ts`의 `recordEvent`에서 `if (event.kind === "state" && TERMINAL_STATES.has(state) ...)` 두 블록(§job 종결, §배지·알림)을 삭제한다 — RUN_EVENT는 이제 projection(activeRun/runEvents 저장) 전용이다. "저장 즉시 알림"이 사라져 RESET 중 오보(인계됨 알림)가 구조적으로 불가능해진다(§5.5).
- [ ] **Step 4: 통과 확인** — Run: `npm test` / Expected: PASS (background-storage 테스트 중 알림/배지를 단언하던 케이스는 supervisor 경로로 이동 예정임을 주석으로 남기고 이 Task에서 효과 단언만 제거).
- [ ] **Step 5: Commit** — `git commit -am "feat: move terminal effects behind supervisor decision"`

---

### Task 4: PageRuntimePort — 탭·주입·attempt 제어 채널

**Files:**
- Create: `src/background/page-runtime-port.ts`
- Modify: `src/shared/types.ts` (`ContentCommand` 확장)
- Test: `tests/page-runtime-port.test.mjs`

**Interfaces:**
- Consumes: `navigateTab`/`sameRestaurant`(navigation.ts), `AttemptStatusResponse`(protocol).
- Produces: `createPageRuntimePort(deps): PageRuntimePort` — Task 6이 사용.

`ContentCommand` 확장 (types.ts):

```ts
export type ContentCommand =
  | { type: "PING" }
  | {
    type: "START";
    runId: string;
    logicalRunId?: string;
    attemptIndex?: number;
    resetCause?: string;
    scheduledJobId?: string;
    shadowChannelId?: string;
    executionContext?: RunExecutionContext;
    config: ReservationConfig;
  }
  | { type: "STOP" }
  | { type: "GET_ATTEMPT_STATUS"; attemptId: string };
```

```ts
// src/background/page-runtime-port.ts
import type { AttemptStatusResponse } from "../shared/run-control/protocol.js";
import type { CommandResponse, ContentCommand } from "../shared/types.js";
import { navigateTab, sameRestaurant } from "./navigation.js";

interface PortTabs {
  get(tabId: number): Promise<{ id?: number; status?: string; url?: string }>;
  update(tabId: number, properties: { url: string }): Promise<{ status?: string; url?: string }>;
  reload(tabId: number): Promise<void>;
  onUpdated: Parameters<typeof navigateTab>[2]["onUpdated"];
}

export interface PageRuntimePort {
  navigateIfNeeded(tabId: number, targetUrl: string): Promise<void>;
  /** 같은 URL이어도 반드시 문서를 다시 로드한다 — RESET_PAGE의 실행 계약(§5.4). */
  forceReenter(tabId: number, targetUrl: string): Promise<void>;
  inject(tabId: number): Promise<void>;
  ping(tabId: number): Promise<boolean>;
  startAttempt(tabId: number, command: Extract<ContentCommand, { type: "START" }>): Promise<CommandResponse>;
  stopAttempt(tabId: number): Promise<boolean>;
  getAttemptStatus(tabId: number, attemptId: string): Promise<AttemptStatusResponse | null>;
}

export function createPageRuntimePort(deps: {
  tabs: PortTabs;
  executeScript(tabId: number): Promise<void>;
  sendMessage(tabId: number, command: ContentCommand): Promise<unknown>;
}): PageRuntimePort {
  const waitForLoad = (tabId: number, targetUrl: string) => navigateTab(tabId, targetUrl, {
    get: deps.tabs.get,
    update: deps.tabs.update,
    onUpdated: deps.tabs.onUpdated,
  });
  const ping = async (tabId: number): Promise<boolean> => {
    try {
      const response = await deps.sendMessage(tabId, { type: "PING" }) as { ok?: boolean } | undefined;
      return response?.ok === true;
    } catch {
      return false;
    }
  };
  return {
    async navigateIfNeeded(tabId, targetUrl) {
      const current = await deps.tabs.get(tabId);
      if (sameRestaurant(current.url, targetUrl)) return;
      await waitForLoad(tabId, targetUrl);
    },
    async forceReenter(tabId, targetUrl) {
      const current = await deps.tabs.get(tabId);
      if (sameRestaurant(current.url, targetUrl)) {
        // navigateTab은 같은 URL 업데이트에서 load 이벤트를 보장하지 않는다 — reload로 강제한다.
        await deps.tabs.reload(tabId);
        await waitForLoad(tabId, targetUrl);
        return;
      }
      await waitForLoad(tabId, targetUrl);
    },
    async inject(tabId) {
      if (await ping(tabId)) return;
      await deps.executeScript(tabId);
      if (!(await ping(tabId))) throw new Error("예약 페이지에 실행 코드를 연결할 수 없습니다.");
    },
    ping,
    async startAttempt(tabId, command) {
      const response = await deps.sendMessage(tabId, command) as CommandResponse | undefined;
      if (response?.ok) return { ok: true };
      return { ok: false, error: response?.error ?? "실행을 시작할 수 없습니다." };
    },
    async stopAttempt(tabId) {
      try {
        await deps.sendMessage(tabId, { type: "STOP" });
        return true;
      } catch {
        return false;
      }
    },
    async getAttemptStatus(tabId, attemptId) {
      try {
        const response = await deps.sendMessage(tabId, { type: "GET_ATTEMPT_STATUS", attemptId });
        return (response ?? null) as AttemptStatusResponse | null;
      } catch {
        return null;
      }
    },
  };
}
```

- [ ] **Step 1: 실패하는 테스트 작성** — fake tabs/sendMessage로: ① navigateIfNeeded는 같은 매장이면 update를 부르지 않는다, ② forceReenter는 같은 URL에서 reload 후 load 완료를 기다린다, ③ inject는 PING 성공 시 executeScript를 건너뛴다·2차 PING 실패 시 throw, ④ getAttemptStatus는 수신 실패 시 null.
- [ ] **Step 2: 실패 확인** — Run: `npm run build && node --test tests/page-runtime-port.test.mjs` / Expected: FAIL.
- [ ] **Step 3: 구현** — 위 코드.
- [ ] **Step 4: 통과 확인** — Run: `npm test` / Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat: add page runtime port for attempt control"`

---

### Task 5: content — terminal outcome 전달·FINISHING·START 멱등

**Files:**
- Modify: `src/content/orchestrator.ts` (`RunResult` 확장 + `markExecuting()` — 준비/terminal 경계만, hot path 무변경)
- Modify: `src/content/index.ts` (attempt 제어 상태 기계)
- Test: `tests/orchestrator.test.mjs` 케이스 추가

**Interfaces:**
- Consumes: `AttemptControlMessage`/`AttemptStatusResponse`(protocol), `TraceLogger.forceFlush(): Promise<boolean>`(Task 2).
- Produces: `RunResult { runId; state; message; preparation?: { cause; attempts } }`, orchestrator `Dependencies.attemptPhase?: (phase: "EXECUTING") => void`. content는 START ok 시 `ATTEMPT_PHASE_CHANGED(PREPARING)`, `markExecuting`에서 `EXECUTING`, terminal 후 flush→`ATTEMPT_FINISHED`(최대 3회·500ms 간격, `{ok:false}` 수신 시 중단)를 보낸다.

- [ ] **Step 1: orchestrator 테스트 추가** — ① terminal RunResult에 message가 실린다(HANDED_OFF 사유 원문), ② 준비 실패 시 `preparation: { cause, attempts }`가 실린다, ③ `attemptPhase` dep이 정확히 1회, WAITING_FOR_OPEN 진입 전에 "EXECUTING"으로 호출된다, ④ 실행 단계 테스트는 무수정.

```js
test("terminal RunResult는 message와 preparation 실패 상세를 싣는다", async () => {
  const phases = [];
  const h = harness({
    calendarOverride: {
      inspect: () => ({ targetAvailable: true, targetSelected: false, adjacentDate: "2026-07-29" }),
      inspectPreparation: () => ({ displayedMonth: "2026-07", target: { available: true, selected: false }, monthNavigation: null }),
      clickMonth: () => true,
      clickDate: () => true,
    },
    attemptPhase: (phase) => phases.push(phase),
  });
  const result = await h.orchestrator.start(config({ entryMode: "auto", stopAtMs: 5_000 }));
  assert.equal(result.state, "HANDED_OFF");
  assert.equal(result.message, "목표 날짜 선택 전환을 확인할 수 없습니다.");
  assert.deepEqual(result.preparation, { cause: "DATE_SELECTION_STALLED", attempts: 2 });
  assert.deepEqual(phases, []); // 준비 실패 — EXECUTING 신호 없음
});

test("attemptPhase는 준비 완료 후 WAITING_FOR_OPEN 전에 1회 EXECUTING을 신호한다", async () => {
  const phases = [];
  let sawWaiting = false;
  const h = harness({
    attemptPhase: (phase) => phases.push({ phase, beforeWaiting: !sawWaiting }),
    onTrace: (code, _s, _m, options) => {
      if (options?.state === "WAITING_FOR_OPEN") sawWaiting = true;
    },
  });
  const result = await h.orchestrator.start(config());
  assert.equal(result.state, "DRY_RUN_COMPLETED");
  assert.equal(result.message.length > 0, true);
  assert.deepEqual(phases, [{ phase: "EXECUTING", beforeWaiting: true }]);
});
```

(harness에 `attemptPhase = null` 파라미터를 추가하고 Dependencies에 spread한다: `...(attemptPhase ? { attemptPhase } : {})`.)

- [ ] **Step 2: 실패 확인** — Run: `npm run build && node --test tests/orchestrator.test.mjs` / Expected: 신규 2건 FAIL.

- [ ] **Step 3: orchestrator 구현**

```ts
// Dependencies에 추가
attemptPhase?(phase: "EXECUTING"): void;

// RunResult 교체
export interface RunResult {
  runId: string;
  state: RunState;
  message: string;
  preparation?: { cause: PreparationCause; attempts: number };
}
```

RunSession에 `private terminalReason = "실행이 종료됐습니다.";`와 `private preparationFailure: { cause: PreparationCause; attempts: number } | null = null;`를 추가한다. `transition()` 첫 줄 뒤에 `if (TERMINAL.has(state)) this.terminalReason = reason;`를 넣고, `finish()`를 다음으로 교체한다:

```ts
private finish(): RunResult {
  return {
    runId: this.runId,
    state: this.machine.state,
    message: this.terminalReason,
    ...(this.preparationFailure === null ? {} : { preparation: this.preparationFailure }),
  };
}
```

`resolvePreparation`의 failed 분기 첫 줄에 `this.preparationFailure = { cause: result.cause, attempts: result.attempts };`를 추가한다. `execute()` 체인의 `?? this.confirmPageReady()` 뒤에 `?? this.markExecuting()`을 삽입하고:

```ts
private markExecuting(): RunResult | null {
  try {
    this.deps.attemptPhase?.("EXECUTING");
  } catch {
    // attempt 제어 신호는 예약 결과를 바꾸지 않는다.
  }
  return null;
}
```

- [ ] **Step 4: content/index.ts 구현** — START 멱등·FINISHING·flush→전송 계약:

```ts
import type { AttemptControlMessage, AttemptOutcome, AttemptStatusResponse, TerminalRunState } from "../shared/run-control/protocol.js";
// (기존 import 유지)

type AttemptControlState = {
  logicalRunId: string;
  attemptId: string;
  phase: "PREPARING" | "EXECUTING" | "FINISHING";
  pendingOutcome?: AttemptOutcome;
};
let attempt: AttemptControlState | null = null;

function sendControl(message: AttemptControlMessage): Promise<unknown> {
  return chrome.runtime.sendMessage(message);
}

async function deliverOutcome(state: AttemptControlState, outcome: AttemptOutcome, flushOk: boolean): Promise<void> {
  state.pendingOutcome = outcome;
  for (let attemptNo = 0; attemptNo < 3; attemptNo += 1) {
    try {
      const ack = await sendControl({
        type: "ATTEMPT_FINISHED",
        logicalRunId: state.logicalRunId,
        attemptId: state.attemptId,
        outcome,
        flush: { ok: flushOk },
      }) as { ok?: boolean } | undefined;
      if (ack && typeof ack.ok === "boolean") return; // ok:false 포함 — 재시도 중단(§5.4)
    } catch {
      // SW 재기동 등 전송 실패 — 제한 재시도.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  // 안전 기본값: ACK 없으면 reset 없이 현재 terminal 유지(§5.4). GET_ATTEMPT_STATUS가 겸수신한다.
}
```

START 핸들러를 다음으로 교체한다(멱등 재수신 + PREPARING 신고 + terminal 시 FINISHING·flush·전송):

```ts
if (message.type === "START") {
  if (running) {
    sendResponse(attempt?.attemptId === message.runId
      ? { ok: true } // 동일 attemptId 재수신 — 멱등 재응답(§5.4)
      : { ok: false, error: "이미 실행 중입니다." });
    return;
  }
  running = true;
  const control: AttemptControlState | null = message.logicalRunId
    ? { logicalRunId: message.logicalRunId, attemptId: message.runId, phase: "PREPARING" }
    : null;
  attempt = control;
  availabilityShadow.configure(message.shadowChannelId ?? null);
  diagnosticRecorder.start(message.runId);
  traceLogger.start(message.runId, message.config, message.scheduledJobId,
    message.logicalRunId === undefined ? undefined : {
      logicalRunId: message.logicalRunId,
      attemptIndex: message.attemptIndex ?? 0,
      ...(message.resetCause === undefined ? {} : { resetCause: message.resetCause }),
    });
  if (control) {
    void sendControl({
      type: "ATTEMPT_PHASE_CHANGED",
      logicalRunId: control.logicalRunId, attemptId: control.attemptId, phase: "PREPARING",
    }).catch(() => undefined);
  }
  void orchestrator.start(message.config, message.runId, message.executionContext)
    .then(async (result) => {
      if (!control) return;
      control.phase = "FINISHING";
      const outcome: AttemptOutcome = result.preparation && result.state === "HANDED_OFF"
        ? {
          kind: "preparation_failed", state: "HANDED_OFF",
          cause: result.preparation.cause, attempts: result.preparation.attempts,
          message: result.message, finishedAt: Date.now(),
        }
        : { kind: "terminal", state: result.state as TerminalRunState, message: result.message, finishedAt: Date.now() };
      let flushOk = false;
      try {
        flushOk = await traceLogger.forceFlush();
      } catch {
        flushOk = false;
      }
      if (!flushOk) {
        try {
          flushOk = await traceLogger.forceFlush(); // durable 실패 시 1회 재flush(§5.4)
        } catch {
          flushOk = false;
        }
      }
      await deliverOutcome(control, outcome, flushOk);
    })
    .finally(() => {
      availabilityShadow.configure(null);
      diagnosticRecorder.reset();
      running = false;
    });
  sendResponse({ ok: true });
  return;
}
if (message.type === "GET_ATTEMPT_STATUS") {
  if (!attempt || attempt.attemptId !== message.attemptId) {
    sendResponse({ attemptId: message.attemptId, running: false, phase: null } satisfies AttemptStatusResponse);
    return;
  }
  sendResponse({
    attemptId: attempt.attemptId,
    running: running && attempt.phase !== "FINISHING",
    phase: attempt.phase,
    ...(attempt.pendingOutcome === undefined ? {} : { pendingOutcome: attempt.pendingOutcome }),
  } satisfies AttemptStatusResponse);
  return;
}
```

orchestrator Dependencies 배선에 추가: `attemptPhase: (phase) => { if (attempt) { attempt.phase = phase; void sendControl({ type: "ATTEMPT_PHASE_CHANGED", logicalRunId: attempt.logicalRunId, attemptId: attempt.attemptId, phase }).catch(() => undefined); } },`

- [ ] **Step 5: 통과 확인 + hot path diff 0** — Run: `npm test && git diff HEAD~1 -- src/content/orchestrator.ts | grep -E "waitForOpen|runToggleCycle|advanceFromSlot|advancePostSlot"` / Expected: 전부 PASS, grep 출력 없음.
- [ ] **Step 6: Commit** — `git commit -am "feat: deliver attempt outcomes over typed control channel"`

---

### Task 6: RunSupervisor — 진입점 통일·ingress·recovery·reconcile·리스너 흡수

**Files:**
- Create: `src/background/run-supervisor.ts`
- Modify: `src/background/index.ts` (startRun/runOnTab/stopRun/tabs 리스너를 supervisor로 위임, `supervisorReady` barrier, top-level bootstrap reconcile)
- Test: `tests/run-supervisor.test.mjs`

**Interfaces:**
- Consumes: Task 1 전이 함수, Task 3 `runTerminalEffects`, Task 4 `PageRuntimePort`, Task 2 `recordRecovery`, 기존 `navigateTab`·`ensureAvailabilityProbe`·`captureRunExecutionContext`·`validateReservationConfig`·`JobScheduler`(launch만 위임 유지).
- Produces: `RunSupervisor` — `ready: Promise<void>`, `startManual(config)`, `startScheduled(job)`, `stop()`, `onAttemptFinished(message)`, `onPhaseChanged(message)`, `onTabRemoved(tabId)`, `onTabUrlChanged(tabId, url)`.

핵심 구현 계약 (전체 코드는 테스트가 고정하는 아래 시맨틱을 따른다):

```ts
// src/background/run-supervisor.ts — 의존 주입 형태
export interface SupervisorDependencies {
  storage: {
    get(keys: string | string[]): Promise<Record<string, unknown>>;
    set(values: Record<string, unknown>): Promise<void>;
  };
  port: PageRuntimePort;
  effects: (run: LogicalRun) => Promise<void>;          // runTerminalEffects 부분 적용
  trace: {
    startFailure(runId: string, config: ReservationConfig, message: string, error?: unknown, jobId?: string): Promise<void>;
    backgroundTerminal(runId: string, startedAt: number, config: ReservationConfig, state: TerminalRunState, message: string, jobId?: string): Promise<void>;
    recovery(runId: string, config: ReservationConfig, code: "RECOVERY_DECIDED" | "RECOVERY_DISPATCHED", message: string, attributes: Record<string, string | number | boolean | null>, jobId?: string): Promise<void>;
  };
  probe(tabId: number, enabled: boolean): Promise<boolean>;
  captureContext(tabId: number): Promise<RunExecutionContext | undefined>;
  createTab(url: string): Promise<number>;               // scheduled 전용
  validate(config: ReservationConfig, nowMs: number): string[];
  newId(): string;
  now(): number;
}
```

시맨틱(테스트로 고정):

1. **startManual/startScheduled** — 기존 startRun/launchScheduledJob/runOnTab 검증·탭 확보·NAVIGATING projection·probe·context capture 로직을 흡수한다. 성공 시 `logicalRun` 생성(단일 쓰기: `logicalRun` + `activeRun`(CONFIGURED projection) + `reservationConfig` + `runEvents: []`) 후 `port.startAttempt`로 START(`runId=attemptId`, `logicalRunId`, `attemptIndex: 0`)를 보낸다. 실패 경로는 기존 recordStartFailure 동작·메시지 보존. `cancelledPendingRuns` Set은 supervisor 내부 필드로 이동한다.
2. **onAttemptFinished** — 직렬 queue에서: `logicalRun` 로드 → 없거나 ID 불일치 → `{ok:false, "unknown_logical_run"}`. `applyAttemptOutcome(run, attemptId, outcome, now(), newId(), flush.ok)` 호출 → reject는 그대로 응답, replay는 저장된 decision 재ACK(쓰기 없음), ack는 **단일 쓰기로 영속 후** 응답하고, 응답 뒤 별도 queue에서 decision별 후속을 실행한다: `RESET_PAGE` → `executeRecovery`, `HANDOFF`/`TERMINAL` → `effects` 후 `markTerminalEffectsCompleted` 쓰기. `RECOVERY_DECIDED` trace를 cause·action·budget·time 스냅샷과 함께 남긴다.
3. **executeRecovery** — ① `decide()`를 현재 시각으로 재평가 — HANDOFF로 바뀌었으면 `applyRecoveryLapse` 쓰기 후 effects(§5.4 intent 시효). ② `markRecoveryDispatched` 쓰기 → ③ `port.forceReenter` → ④ `port.inject`(+probe 재설치) → ⑤ context capture 후 `port.startAttempt`(START `runId=recovery.nextAttemptId`, `attemptIndex=attempts.length`, `resetCause=source cause`) → ⑥ `beginNextAttempt` 쓰기 + `activeRun`/`runEvents` projection 초기화(단일 set) → `RECOVERY_DISPATCHED` trace. 도중 실패 시 `applyBackgroundTerminal(run, "FAILED", "재시도 준비에 실패했습니다: <원인>")` 쓰기 후 effects.
4. **onPhaseChanged** — `applyPhaseChange` 결과를 그대로 ACK로 변환(ok/replay → `{ok:true}`, reject → `{ok:false, reason}`), ok일 때만 쓰기.
5. **stop()** — 기존 stopRun 동작 보존 + logicalRun이 있으면 `applyBackgroundTerminal(run, "STOPPED", ...)` 쓰기 후 effects. content 도달 실패 시 기존 recordBackgroundTerminal trace 유지.
6. **onTabRemoved/onTabUrlChanged** — 기존 조건(leftReservationFlow 포함)에 logicalRun 종결(`applyBackgroundTerminal`)과 effects를 추가한다. 기존 activeRun STOPPED 쓰기·trace 보존.
7. **reconcile()** (`ready`가 이 promise) — `logicalRun` 로드 후 §B 표: TERMINAL+효과마커 없음 → effects 재개; RECOVERING → executeRecovery 멱등 재개(dispatchedAt 있고 `getAttemptStatus(nextAttemptId)`가 실행 중이면 `beginNextAttempt` 쓰기만); PREPARING/EXECUTING → `getAttemptStatus(currentAttemptId)`: 실행 중 → 개입 없음, `phase:"FINISHING"`+pendingOutcome → `onAttemptFinished` 경로로 위임(C3), 미실행/미응답 → `applyBackgroundTerminal(run, "FAILED", "실행 문맥이 유실됐습니다")` 후 effects.
8. **index.ts 배선** — 모듈 top-level에서 `const supervisor = new RunSupervisor({...}); const supervisorReady = supervisor.ready;`. 모든 message·alarm handler 본문 첫 줄에서 `await supervisorReady`. `PANEL_START`→`supervisor.startManual`, `PANEL_STOP`→`supervisor.stop`, `jobScheduler`의 `launch`→`supervisor.startScheduled`, `AttemptControlMessage` 2종 핸들러 추가(sendResponse = ACK), tabs 리스너 2개는 supervisor 메서드 호출로 교체. `jobScheduler.onRunTerminal`은 TerminalEffects의 finishJob으로 대체됐으므로 recordEvent 경로 잔재가 없는지 확인.

- [ ] **Step 1: 실패하는 테스트 작성** — fake storage(Map)/fake port/fake effects로 §C 매트릭스의 supervisor 부분을 고정한다: ① preparation_failed → RESET: 단일 쓰기(응답 전 storage에 decision·recovery 존재) 후 ACK, reenter→inject→START 순서, beginNextAttempt로 currentAttemptId 교체+projection 초기화, ② ACK 유실 재전송 → 같은 decision 재ACK + resetCount 불변 + reenter 재실행 없음, ③ 2번째 정체 → HANDOFF + effects 1회, ④ recovery lapse(재평가 시 오픈 임박) → TERMINAL+effects, ⑤ reconcile 4분기(§B C1·C3·C6·C8) — C3는 getAttemptStatus가 FINISHING+pendingOutcome을 돌려주면 outcome이 처리되고 이후 재전송이 replay되는 것까지, ⑥ EXECUTING 후 preparation_failed → HANDOFF, ⑦ stop/tab 닫힘 → TERMINAL+effects+기존 메시지.
- [ ] **Step 2: 실패 확인** — Run: `npm run build && node --test tests/run-supervisor.test.mjs` / Expected: FAIL.
- [ ] **Step 3: supervisor 구현** — 위 시맨틱. 모든 상태 변경은 `SerialTaskQueue` 1개에서 직렬화한다(결정·영속·ACK 순서를 코드 구조로 강제 — §8-5).
- [ ] **Step 4: index.ts 배선** — 위 8번. `ensureContent`는 port.inject로 대체하고 삭제.
- [ ] **Step 5: 통과 확인** — Run: `npm run check` / Expected: 전부 PASS.
- [ ] **Step 6: Commit** — `git commit -am "feat: add run supervisor with reset recovery and bootstrap reconcile"`

---

### Task 7: Side Panel RECOVERING 표시

**Files:**
- Modify: `src/sidepanel/index.ts`

- [ ] **Step 1: 구현** — `chrome.storage.onChanged`의 조건에 `changes.logicalRun`을 추가하고, `renderRuntime` 호출부에서 `logicalRun`을 함께 읽어 status가 `"RECOVERING"`이면 실행 상태 영역에 한 줄을 표시한다: `재시도 중 — 같은 탭에서 페이지를 다시 준비합니다.` (기존 상태 라벨·이벤트 로그는 무변경). 초기 로드 storage key 목록(`"activeRun"` 근처)에 `"logicalRun"` 추가.
- [ ] **Step 2: 수동 확인 기록** — dist 재로드 후 Side Panel 콘솔 오류 없음 확인(E2E Task에서 RECOVERING 표시 자체를 검증).
- [ ] **Step 3: 게이트 + Commit** — Run: `npm run check` / `git commit -am "feat: surface recovering status in side panel"`

---

### Task 8: E2E + 문서·워크로그

**Files:**
- Modify: `docs/worklog/HANDOFF.md`, `docs/plans/next-development.md` §6
- Create: `docs/worklog/2026-07-17-02-run-control-plane-phase2.md`

- [ ] **Step 1: Chrome DevTools MCP E2E** (`use-chrome-devtools` 스킬, dry-run·실클릭 없음):
  1. `npm run build` 후 확장 재로드, Side Panel에서 auto 모드 + 오픈까지 여유 ≥ 2분 설정.
  2. **RESET 1회 완주**: 실매장 페이지에서 달력이 열린 뒤 DevTools로 목표 날짜 셀 클릭을 차단(기존 RT-16 검증과 동일하게 date dispatch 2회 유도) → `DATE_SELECTION_STALLED` → Side Panel `재시도 중` 표시 → 같은 탭 재로드 관측 → 재준비 → dry-run 완주(`DRY_RUN_COMPLETED`). IndexedDB에서 두 attempt run의 eventCount·seq 연속·dropped 0, RUN_STARTED attributes(logicalRunId 동일, attemptIndex 0/1, resetCause) 확인.
  3. **RESET 예산·시효**: 2회째 정체가 HANDOFF로 끝나는지, 오픈 임박(45초 미만) 설정에서 RESET 없이 HANDOFF인지 확인.
  4. **EXECUTING 가드**: 정상 진행 실행에서 WAITING_FOR_OPEN 이후 RESET이 절대 발생하지 않음(이벤트 로그·logicalRun status EXECUTING) 확인.
  5. **ACK 직후 SW 강제 종료**: RESET 결정 직후 `chrome://serviceworker-internals`(또는 확장 페이지에서 SW stop)로 SW를 죽이고 → 재기동 reconcile이 같은 nextAttemptId로 멱등 재개(이중 attempt 없음)를 IndexedDB로 확인.
  6. 알림 검증: RESET 중 "인계됨" 알림이 없고, 최종 terminal에서만 알림 1개.
- [ ] **Step 2: 문서** — worklog 작성(변경 요약·테스트 수·E2E 증거), HANDOFF의 run-control-plane 항목을 Phase 2 완료로 갱신(RT-16 종결 판정 포함), next-development §6 종결.
- [ ] **Step 3: 최종 게이트 + Commit + main 병합** — Run: `npm run check && git diff --check` / `git add -A && git commit -m "docs: record run control plane phase 2 completion"` → main 병합.

---

## Self-Review 결과

- 설계 §5.4 계약 → Task 1(전이·재ACK·시효·원자성 순수부), Task 5(flush→전송→ACK, FINISHING, START 멱등), Task 6(영속→ACK→행동 순서, reconcile 4분기). §5.5 → Task 1(LogicalRun)·Task 3(TerminalEffects)·Task 7(RECOVERING). §6 → Task 2(trace 코드·RUN_STARTED attrs). §7-8 → Task 8.
- 5차 리뷰 Phase 2 차단 8건 전부 §C 매트릭스에 테스트 위치 명시.
- 타입 일관성: `AttemptDecision`/`LogicalRun`은 Task 1 정의를 Task 3·6이 소비, `PageRuntimePort`는 Task 4 정의를 Task 6이 소비, `RunResult` 확장은 Task 5 내부에서 정의·소비.
- hot path: content 변경은 execute 체인의 `markExecuting`(WAITING_FOR_OPEN 이전)과 terminal 경계(`finish`/`transition`/`resolvePreparation`)에 한정 — `waitForOpen` 이후 diff 0 확인 단계 포함(Task 5 Step 5).
