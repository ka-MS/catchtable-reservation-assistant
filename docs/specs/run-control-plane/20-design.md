# 실행 제어 평면 구조화 설계 (run-control-plane)

**기준일:** 2026-07-16 (2차 red-team 리뷰 반영 개정)
**선행:** `docs/specs/open-timing-performance/03-runtime-resilience/10-analysis.md`, `01-rt16-preparation-recovery/`(부분 구현, 재개방), `docs/specs/orchestrator-refactor/20-design.md`(behavior-neutral 분해 이력)
**상태:** 설계 승인, 구현 계획 `30-implementation.md`

## 1. 목표

발생(사실) → 원인(분류) → 정책(결정) → 행동(실행) → 기록(telemetry)의 제어 책임을 인터페이스로 연결된 별도 모듈로 분리한다. 준비영역과 실행영역을 파이프라인으로 나누고, 논리 실행(logical run)을 감독하는 단일 주체를 둔다.

완료 후 상태 검증 기준: **동일 탭 URL 재진입(RESET_PAGE)이 "정책 테이블 행 1개 + Action variant 1개 + 실행 port 연결"만으로 추가된다.**

핵심 불변식: RunSupervisor는 DOM 세부사항을 모르고, 준비 파이프라인은 Chrome 페이지 수명주기를 모르며, Telemetry는 어떤 행동도 결정하지 않는다.

## 2. 비목표

- 실행영역 hot path(날짜 토글, 슬롯 감지·클릭, wake, EMPTY 조기 종료) 내부 변경. `ExecutionPhase` 경계 뒤에 무변경 격리한다.
- 자동화 경계 변경. 로그인·CAPTCHA·결제·최종 예약은 여전히 자동화하지 않는다.
- Side Panel UI 재설계(RECOVERING 표시 최소 추가만).
- 취소 스나이핑, 다중 탭.

## 3. red-team 판정 이력

1차 판정(직전 구조안 대비):

| 항목 | 판정 | 근거 |
|---|---|---|
| Recovery Dispatcher + Executor 레지스트리 | 기각 | 행동 소수에 레지스트리는 투기적 일반화. closed union + exhaustive switch가 타입 안전 레지스트리다. |
| Entry/Date/Person Step 클래스 3개 | 수정 | 병은 루프 복붙(현행 prepareEntry ≈ preparePerson). 제네릭 runner 1개로 통합. |
| Background Run Supervisor | 유지·강화 | background에 이미 흩어진 반쪽 supervisor(stopRun, tabs.onRemoved, tabs.onUpdated, cancelledPendingRuns, assertPending)를 흡수 통합한다. |
| Execution Pipeline 즉시 4분해 | 보류 | 실오픈 검증 증거가 걸린 코드. 결합이 시간적(temporal)이라 공식 p95 하네스(RT-11/12) 확보 전 분해는 회귀 도박. |
| 정책 입력 | 보강 | deadline-aware 필수: RESET은 5~15초짜리 행동이라 오픈 임박 시 금지해야 한다. |

2차 리뷰 반영(수정 6건):

| 항목 | 판정 | 반영 |
|---|---|---|
| RUN_EVENT를 supervisor 입력으로 사용 | 결함 인정 | best-effort 채널(전송 실패를 삼킴)은 제어에 부적합. typed·ACK `AttemptControlMessage`로 교체(§5.4). Telemetry는 관측 전용. |
| StepSpec이 Cause를 직접 생성 | 결함 인정 | 분류는 `classifier.ts` 단독 소유. runner는 주입된 분류 함수를 호출만 한다(§5.2). |
| Classifier/Policy 병합 | 근거 철회 | 사실→원인 매핑은 실측 변경으로 단독 진화한다(이 저장소의 선택자 변경 이력이 반례). 같은 패키지, 파일 분리(§5.3). |
| terminal 효과 실행 순서 | 결함 인정 | 결정이 효과보다 먼저. supervisor가 terminal ingress 소유, `TerminalEffects` 분리(§5.5). |
| onStartup/onInstalled reconcile | 결함 인정 | SW 재기동을 못 잡는다. 모듈 top-level bootstrap reconcile로 교체(§5.4). |
| RESET 실행 계약 부족 | 결함 인정 | `navigateIfNeeded`/`forceReenter` 분리 + flush→ACK→reenter 순서 명문화(§5.4). |

기각 2건(근거 유지):

| 항목 | 판정 | 근거 |
|---|---|---|
| clock sync를 준비 뒤로 이동 | 소유권만 수용, 순서 이동 기각 | 준비 deadline이 serverClock 위에서 돌고(동작 보존), rolling sampler는 관측 span이 길수록 confidence가 개선된다(HIGH = 5표본+3초 span; 오픈 임박 실행에선 준비 구간이 span의 상당 부분). 절충: 시계는 실행영역 소유로 명명하고, attempt 시작 시 조기 기동하는 "reference clock pre-sampler"로 명시한다(§5.6). |
| `RETRY_ACTION{delayMs}` policy variant | 기각(미채택) | 단계 내 재시도는 runner의 기계적 예산이고, 예산 소진 후 동일 행동 재시도는 현행 동작에 없다(RESET이 그 역할). closed union은 추후 variant 추가 시 컴파일러가 전 소비처를 강제하므로 선제 추가의 이득이 없다. |

3차 리뷰 반영(수정 5건 + 보강 2건):

| 항목 | 판정 | 반영 |
|---|---|---|
| AttemptOutcome 정보 부족 | 결함 인정 | `message`/`finishedAt` 포함, `TerminalRunState`로 제한 — TerminalEffects·finishJob이 telemetry를 다시 읽지 않는다(§5.4). |
| ACK 유실 재전송 미방어 | 결함 인정 | attempt별 decision 영속 + 재전송 시 저장된 decision 재ACK. 최초 처리에서만 resetCount 증가(§5.4). |
| ACK 전 forceReenter | 결함 인정 | 결정 영속 → ACK → supervisor queue에서 reenter. ACK = "결정이 영속 접수됨"(§5.4). |
| PING만으로 reconcile | 결함 인정 | `GET_ATTEMPT_STATUS(attemptId) → { running, phase }` 추가 + handler들의 `supervisorReady` barrier(§5.4). |
| DATE_NOT_IN_CALENDAR 이중 사용 | 결함 인정 | 원인 코드와 제어흐름 신호 분리: 셀 일시 소실은 runner `interrupted("target_cell_missing")` 내부 토큰, 월 단계 최종 판정만 `DATE_NOT_IN_CALENDAR`(§5.2). |
| pre-sampler 명칭 | 보강 | 초기 동기화·anchor까지 수행하므로 **attempt reference clock**으로 정정(§5.6). |
| LogicalRun 필드 | 보강 | `currentAttemptId`/`startedAt`/`updatedAt`/`origin`/attempt별 `decision` 추가(§5.5). |

4차 리뷰 반영(P0 1건 + 소규모 3건):

| 항목 | 판정 | 반영 |
|---|---|---|
| ACK 후 SW 사망 복구 불완전 (P0) | 결함 인정 | "영속 ACK" 선언의 완성: attempt에 `message` 영속, `recovery` intent(`nextAttemptId` 사전 생성) 영속, `terminalEffectsCompletedAt` 마커, reconcile 4분기 표(§5.4·§5.5). ACK 이전 단일 쓰기로 복구 재개 정보 전부 저장. |
| ATTEMPT_PHASE_CHANGED ACK 미정의 | 인정 | `AttemptPhaseChangedAck` 별도 정의(§5.4). |
| stale/missing에 성공 ACK | 인정 | `{ok:false, reason}` 응답 — content가 재시도 중단을 판단한다(§5.4). |
| interrupt 임의 string | 인정 | `PreparationInterrupt` closed union으로 제한(§5.2, 계획 Task 2·3). |

5차 리뷰 반영(Phase 1 보완 4건 + Phase 2 차단 8건):

| 항목 | 판정 | 반영 |
|---|---|---|
| 오류 코드 세분화 vs 동작 보존 모순 | 인정 | 의도된 계약 변경으로 명시. 구→신 매핑 표와 테스트로 고정(§8, 계획 Task 5). |
| interrupt 비exhaustive 처리 | 인정 | coordinator가 token을 exhaustive switch + `assertNever`로 소비(계획 Task 3). |
| Entry/Person 사실 타입 이원화 | 인정 | adapter가 shared `EntryFacts`/`PersonFacts`를 직접 반환 — 사실 타입 단일 소유 완성(계획 Task 4). |
| CalendarAdapter 테스트 유실 위험 | 인정 | 보존 대상 6종을 명시하고 이전처를 고정(계획 Task 4·6). |
| durable flush 부재 | 인정(Phase 2) | flush가 저장 ACK 여부를 반환하도록 확장, ATTEMPT_FINISHED에 결과 동반(§5.4). |
| ACK disposition 부족 | 인정(Phase 2) | `decision: RESET_PAGE \| HANDOFF \| TERMINAL`(§5.4). |
| 재전송 조회 순서 | 인정(Phase 2) | attempt 기록 우선 → payload 검증 → stale 판정(§5.4). |
| phase 비단조 | 인정(Phase 2) | PREPARING→EXECUTING 단조, 중복 재ACK, 역행 거부(§5.4). |
| RESET intent 시효 | 인정(Phase 2) | 실행 직전 decide() 재평가 — 늦은 SW 재기동에서 시간 창 초과 시 HANDOFF 전환(§5.4). |
| nextAttempt 전이 원자성 | 인정(Phase 2) | 단일 쓰기 전이 + content START의 attemptId 멱등 처리(§5.4). |
| TerminalEffects 비멱등 | 인정(Phase 2) | deterministic notification ID + 멱등 효과 실행(§5.4). |
| reconcile-terminal 전송 경쟁 | 인정(Phase 2) | `FINISHING` phase + outcome-bearing status 응답(§5.4). |

## 4. 아키텍처: Control Plane / Data Plane

```text
┌─ CONTROL PLANE — background, 저빈도·영속·멱등 ──────────────┐
│ RunSupervisor (process manager)                              │
│  ├─ LogicalRun 수명주기: attempt 생성·예산·종결              │
│  ├─ terminal ingress 소유: 결정 → 효과 순서 보장             │
│  ├─ decide(cause, budget, time) 실행: switch(action)         │
│  ├─ 기존 리스너 흡수: PANEL_STOP, tabs.onRemoved,            │
│  │   tabs.onUpdated(이탈), cancelledPendingRuns              │
│  └─ 진입점 통일: PANEL_START / 스케줄 알람                   │
│ PageRuntimePort: navigateIfNeeded·forceReenter·inject·ping   │
│ TerminalEffects: job 종료·배지·알림 — logical terminal에서만 │
└──────────────────────────────────────────────────────────────┘
        ▲ ATTEMPT_PHASE_CHANGED / ATTEMPT_FINISHED (typed·ACK)
        │ START {runId=attemptId, logicalRunId, ...}
┌─ DATA PLANE — content, attempt 1회 자율 실행 ────────────────┐
│ AttemptSession (기존 RunSession 축소)                        │
│  ├─ validate → attempt reference clock 기동(실행영역 소유)   │
│  ├─ PreparationPipeline                                      │
│  │    EntryCoordinator / CalendarCoordinator / PersonCoord.  │
│  │      └─ BoundedStepRunner ×1 (기계 루프 소유)             │
│  │           └─ Adapter: 사실 관측 + 단일 클릭만             │
│  └─ ExecutionPhase: 기존 waitForOpen~advancePostSlot 무변경  │
└──────────────────────────────────────────────────────────────┘
┌─ FUNCTIONAL CORE — shared/run-control/, 순수 ────────────────┐
│ facts → classifier.ts → Cause → policy.ts → Action           │
│ protocol.ts: attempt 제어 메시지 타입                        │
└──────────────────────────────────────────────────────────────┘
```

원칙: shared core는 chrome/DOM 무접근(기존 규칙), adapter만 querySelector, supervisor는 실행 hot path에 개입하지 않는다(EXECUTING 진입 후 content는 terminal까지 자율 — `ATTEMPT_PHASE_CHANGED`가 그 가드다).

## 5. 계약

### 5.1 사실 (adapter가 반환하는 유일한 것)

Adapter는 관측과 단일 행동만 남긴다. `EntryAdapter.inspect()`, `CalendarAdapter`의 사실 관측(`displayedMonth`, 목표 셀 상태, 월 이동 가능 여부), `clickMonth`/`clickDate`, `PersonAdapter.inspect/select`. **CalendarAdapter의 pendingMonth/pendingDate/attempt 재시도 상태와 `beforeDispatch` 콜백, `errorCode` 생성은 제거한다** — 재시도 상태는 runner의 run-scoped 상태로 이동하므로 RT-16B의 `resetPreparation()`도 구조적으로 불필요해진다. 사실 타입(`EntryFacts`/`CalendarFacts`/`PersonFacts`)은 `shared/run-control/facts.ts`가 단일 소유한다.

### 5.2 BoundedStepRunner + Coordinator

- **runner는 기계 루프만 소유한다**: 관측 폴링(50ms) → dispatch 예산(`maxAttempts`, `retryDelayMs`) → 확인 deadline → 기계적 실패. 현행 RT-16C 상수(2회·1초, 달력 월 750ms×3, 날짜 1s×2)를 그대로 이식한다.
- **원인 분류는 runner가 소유하지 않는다**: fatal 판정은 매 관측마다 필요하므로 runner가 `classifier.ts`의 stage별 분류 함수를 주입받아 호출하고, 정체 원인은 `classifyStall(stage, attempts)`를 호출한다. 분류 로직의 정의는 전부 `classifier.ts`에 있다.
- **단계 의미는 coordinator가 소유한다**: `entry-coordinator`(홍보 인터스티셜 규칙 포함), `calendar-coordinator`(월 이동 → 날짜 선택 순서와 셀 소실 시 재순환 규칙), `person-coordinator`. 사용자 가시 메시지 표도 coordinator에 있다. coordinator는 루프를 재구현하지 않는다 — 루프-내 특수 행동(홍보 닫기)은 runner의 옵션 훅으로 지원한다.
- `progressKey`가 비어 있지 않은 값으로 바뀌면 attempt 예산 리셋(다단 월 이동). 빈 문자열은 "판독 불가"로 리셋하지 않는다.
- **interrupt 훅**: 원인 코드는 제어흐름 신호를 겸하지 않는다. 단계 내부 재순환이 필요한 관측(예: 날짜 준비 중 목표 셀 일시 소실)은 `interrupt(f)`가 내부 토큰을 반환해 runner가 `{ kind: "interrupted", token }`으로 종료하고, coordinator가 토큰을 해석한다(달력: `"target_cell_missing"` → 남은 deadline 안에서 월 단계부터 재순환). 토큰은 임의 string이 아니라 closed union(`PreparationInterrupt = "target_cell_missing"`)으로 제한한다. `DATE_NOT_IN_CALENDAR`는 월 단계의 최종 판정(목표 월인데 셀 없음)에서만 나온다.

### 5.3 순수 core (shared/run-control/)

```text
shared/run-control/
  facts.ts       # EntryFacts · CalendarFacts · PersonFacts
  causes.ts      # PreparationStage · PreparationCause · FailureVia
  classifier.ts  # 사실 → 원인 (stage별 fatal 분류 + classifyStall)
  policy.ts      # decide(cause, budget, time, mode) → Action
  protocol.ts    # AttemptControlMessage 타입 (Phase 2 배선)
```

```ts
type PreparationCause =
  | "ENTRY_CTA_MISSING" | "ENTRY_TRANSITION_STALLED" | "WAITING_ONLY"
  | "MONTH_NAVIGATION_UNAVAILABLE" | "MONTH_TRANSITION_STALLED"
  | "DATE_NOT_IN_CALENDAR" | "DATE_UNAVAILABLE" | "DATE_SELECTION_STALLED"
  | "PERSON_UNAVAILABLE" | "PERSON_SELECTION_STALLED";
// 실행영역 원인(SETUP_INVALID 등)은 이번 decide() 범위 밖 — 현행대로 즉시 인계.

type Action =
  | { kind: "RESET_PAGE"; cause: PreparationCause }
  | { kind: "HANDOFF"; cause: PreparationCause };
// RETRY_ACTION variant는 미채택(§3 기각 근거). 필요해지면 additive로 추가한다.

decide(cause, budget: { resetCount }, time: { msToOpen; msToStop },
  mode: { entryMode }): Action
```

단계 내 재시도는 runner의 기계적 예산이지 정책 결정이 아니다 — decide()는 단계 예산 소진 이후의 원인만 받는다.

기본 정책 표(상수는 튜너블, `RESET_MIN_LEAD_MS` 기본 45,000):

| 조건 | 행동 |
|---|---|
| 사실상 종결 원인(WAITING_ONLY, PERSON_UNAVAILABLE, DATE_UNAVAILABLE, DATE_NOT_IN_CALENDAR, MONTH_NAVIGATION_UNAVAILABLE) | HANDOFF |
| 정체 원인 ∧ resetCount = 0 ∧ msToOpen > RESET_MIN_LEAD_MS ∧ msToStop > RESET_MIN_LEAD_MS ∧ entryMode = "auto" | RESET_PAGE |
| 그 외 | HANDOFF |

`entryMode="prepared"`는 사용자가 준비한 모달을 파괴하므로 RESET을 금지한다. dry-run은 RESET을 허용한다.

### 5.4 attempt 제어 프로토콜 — Telemetry는 제어에 사용하지 않는다

content는 현행대로 attempt를 terminal 상태로 끝낸다(상태머신 terminal 불변·IndexedDB `[runId, seq]` 보존). 다만 supervisor 통지는 기존 RUN_EVENT(best-effort, 유실 허용)가 아니라 **전용 typed 메시지**로 한다. outcome은 TerminalEffects·finishJob이 필요로 하는 전부(사용자 메시지·종료 시각)를 싣는다 — telemetry를 다시 읽지 않는다:

```ts
// shared/run-control/protocol.ts
type TerminalRunState = Extract<RunState,
  "DRY_RUN_COMPLETED" | "HANDED_OFF" | "COMPLETED" | "STOPPED" | "TIMED_OUT" | "FAILED">;
type AttemptPhase = "PREPARING" | "EXECUTING";

type AttemptOutcome =
  | { kind: "preparation_failed"; state: "HANDED_OFF"; cause: PreparationCause;
      attempts: number; message: string; finishedAt: number }
  | { kind: "terminal"; state: TerminalRunState; message: string; finishedAt: number };

// content → background
type AttemptControlMessage =
  | { type: "ATTEMPT_PHASE_CHANGED"; logicalRunId: string; attemptId: string; phase: AttemptPhase }
  | { type: "ATTEMPT_FINISHED"; logicalRunId: string; attemptId: string; outcome: AttemptOutcome };

// sendResponse = ACK. 실패를 침묵으로 삼키고 성공 ACK를 주지 않는다 —
// content가 재시도 중단 여부를 reason으로 판단한다.
type AttemptAckFailureReason =
  | "unknown_logical_run" | "stale_attempt" | "outcome_conflict" | "phase_regression";
type AttemptFinishedAck =
  // TERMINAL = 일반 종결(COMPLETED/STOPPED/FAILED 등) 접수 — 복구 결정이 아니다.
  | { ok: true; decision: "RESET_PAGE" | "HANDOFF" | "TERMINAL" }
  | { ok: false; reason: AttemptAckFailureReason };
type AttemptPhaseChangedAck =
  | { ok: true }
  | { ok: false; reason: AttemptAckFailureReason };

// background → content (reconcile 전용). FINISHING = terminal 도달 후 ATTEMPT_FINISHED
// 전송 중 — reconcile이 "미실행"으로 오판해 안전 terminal을 덮는 경쟁을 막는다.
interface AttemptStatusRequest { type: "GET_ATTEMPT_STATUS"; attemptId: string; }
interface AttemptStatusResponse {
  attemptId: string;
  running: boolean;
  phase: AttemptPhase | "FINISHING" | null;
  pendingOutcome?: AttemptOutcome; // FINISHING이면 상태 응답이 outcome 수신 경로를 겸한다
}
```

준비 실패 시 순서(각 화살표가 계약 — **ACK 이전에 복구 재개에 필요한 전부가 영속돼 있어야 한다**):

```text
content terminal 확정 → trace/diagnostics flush 완료
  → ATTEMPT_FINISHED 전송 (ACK 없으면 제한 재시도, ok:false면 중단)
  → supervisor: decide()
  → outcome(message·finishedAt 포함) + decision + resetCount + status + recovery intent를 단일 쓰기로 영속
      · RESET_PAGE: status=RECOVERING, recovery={sourceAttemptId, nextAttemptId(사전 생성), action}
      · HANDOFF: status=TERMINAL
  → sendResponse(ACK = "결정이 영속 접수됨". 행동 완료가 아님)
  → RESET_PAGE: recovery queue에서 forceReenter() → inject → nextAttemptId로 START → recovery.dispatchedAt 기록
  → HANDOFF: TerminalEffects 실행 → terminalEffectsCompletedAt 기록
```

`nextAttemptId`를 결정 시점에 생성·영속하는 이유: ACK 후 SW가 죽어도 reconcile 재개가 **같은 attemptId를 재사용**하므로 이중 attempt가 생기지 않는다(멱등 재개).

- **flush 후 전송, ACK 후 reenter**: `forceReenter()`는 페이지를 unload하므로 두 가지를 모두 지킨다. ① content는 flush 완료 뒤에만 `ATTEMPT_FINISHED`를 보낸다(전송 자체가 flush 완료 증거). ② supervisor는 **ACK를 보낸 뒤** 별도 queue에서 reenter한다 — ACK 전에 unload하면 응답 채널이 죽어 content 재시도가 허공에 간다.
- **멱등성(재전송 방어)**: `currentAttemptId` 비교만으로는 같은 attempt의 ACK 유실 재전송을 못 막는다. outcome 수신 시 attempt 레코드에 `decision`/`decidedAt`을 영속하고, **이미 결정된 attempt의 재전송에는 저장된 decision을 그대로 재ACK**한다. resetCount 증가·RESET 예약은 최초 처리에서만 일어난다. `currentAttemptId` 불일치 메시지는 무시하고, `ATTEMPT_PHASE_CHANGED(EXECUTING)` 이후에는 어떤 RESET도 금지한다.
- **안전 기본값**: content가 background에 도달하지 못하면(재시도 후에도 ACK 없음) 자동 reset 없이 현재 attempt의 terminal 상태로 끝난다 — 현행 동작과 동일.
- **SW 재기동**: `logicalRun`은 storage 영속. reconcile은 `onStartup`/`onInstalled`가 아니라 **service worker 모듈 top-level에서 매 기동마다** 실행한다. 리스너 등록은 동기로 먼저 하되, 모든 message·alarm handler 본문은 `supervisorReady` barrier(bootstrap reconcile 완료 promise)를 await한다. reconcile은 PING(주입 여부만 증명)이 아니라 `GET_ATTEMPT_STATUS`로 **해당 attempt가 실제 실행 중인지** 확인하고, status별로 분기한다 — 논리 실행을 고아로 남기지 않는다:

| reconcile 관측 | 재개 행동 |
|---|---|
| `RECOVERING` + recovery intent 있음 | forceReenter/inject/`nextAttemptId` START를 멱등 재개(`dispatchedAt` 유무·attempt 상태로 중복 방지) |
| `PREPARING`/`EXECUTING` + 해당 attempt 미실행 | 안전 terminal 확정(FAILED, "실행 문맥이 유실됐습니다") → TerminalEffects |
| `TERMINAL` + `terminalEffectsCompletedAt` 없음 | TerminalEffects 재개(attempt에 영속된 message·finishedAt 사용) |
| attempt 실행 중 확인됨 | 개입 없음 — content 자율 실행 계속 |
- **durable flush**: 현행 `forceFlush`(trace·diagnostics)는 timeout 후에도 무조건 resolve된다 — 저장 보장이 없다. Phase 2에서 저장 ACK 여부를 반환하도록 확장하고, content는 durable 실패 시 1회 재flush 후 결과를 `ATTEMPT_FINISHED`에 동반한다. 복구 진행은 flush 결과와 무관하게 계속한다(진단은 best-effort — 기존 telemetry 철학 유지), 단 유실 사실은 기록한다.
- **재전송 조회 순서**: ① attempt 기록 조회 — decision이 있으면 동일 payload는 저장된 ACK replay, payload 불일치는 `outcome_conflict` 거부. ② 그다음에야 `currentAttemptId` stale 판정. (순서를 바꾸면 이미 결정된 attempt의 재전송이 stale로 오판된다.)
- **phase 단조 전이**: PREPARING → EXECUTING만 허용. 동일 phase 중복은 재ACK, 역행은 `phase_regression` 거부.
- **RESET intent 재평가**: recovery 실행 직전 `decide()`를 현재 시각으로 다시 평가한다 — SW가 늦게 재기동해 RESET_MIN_LEAD 창이 지났으면 HANDOFF로 전환해 terminal 확정. intent는 영속된 계획이지 무조건 실행 티켓이 아니다.
- **nextAttempt 전이 원자성**: attempts 추가 · `currentAttemptId` 교체 · status(PREPARING) · recovery 제거를 단일 storage 쓰기로 수행한다. content START는 동일 attemptId 재수신을 멱등 처리한다(이미 실행 중이면 ok 재응답).
- **TerminalEffects 멱등**: 알림은 logicalRunId 기반 deterministic notification ID를 사용하고 badge·finishJob은 멱등 실행 — `terminalEffectsCompletedAt` 기록 직전 SW가 죽어도 중복 알림이 없다.
- RUN_EVENT는 계속 흐르되(사이드패널 projection·이벤트 로그) 제어 결정에 사용하지 않는다.

### 5.5 상태 모델·terminal 효과

- 신규 storage 키(background 단독 소유):

```ts
interface LogicalRun {
  logicalRunId: string;
  origin: { kind: "manual" } | { kind: "scheduled"; jobId: string };
  config: ReservationConfig;
  tabId: number;
  status: "PREPARING" | "EXECUTING" | "RECOVERING" | "TERMINAL";
  startedAt: number;
  updatedAt: number;
  resetCount: number;
  currentAttemptId: string;
  attempts: Array<{
    runId: string;            // = attemptId
    startedAt: number;
    finalState?: TerminalRunState;
    cause?: PreparationCause;
    message?: string;         // TerminalEffects 재개용 — ACK 후 SW가 죽어도 알림을 복원한다
    finishedAt?: number;
    decision?: "RESET_PAGE" | "HANDOFF";  // 멱등 재ACK의 근거
    decidedAt?: number;
  }>;
  /** RESET 결정 후 실행 전 SW 사망을 복구하는 영속 intent. nextAttemptId는 결정 시점에 생성한다. */
  recovery?: {
    sourceAttemptId: string;
    nextAttemptId: string;
    action: "RESET_PAGE";
    dispatchedAt?: number;
  };
  /** TerminalEffects(알림·배지·job 종료) 완료 마커 — 없으면 reconcile이 재개한다. */
  terminalEffectsCompletedAt?: number;
}
```
- 기존 `RunState`/`activeRun`은 attempt 단위 projection으로 **무변경 유지**(sidepanel 라벨·trace·CSV 하위호환).
- **TerminalEffects 모듈**: 예약 작업 종료(finishJob)·배지·OS 알림. logical run terminal에서만, supervisor 결정 이후에만 실행한다. 현행 `recordEvent`의 해당 분기들은 이 모듈로 이동한다 — "저장 즉시 알림"이 사라져 RESET 중 오보(인계됨 알림)가 구조적으로 불가능해진다.
- Side Panel: `logicalRun` 구독으로 "재시도 중"(RECOVERING) 표시 1줄 추가.

### 5.6 시계 소유권

reference clock(부트스트랩 표본 + rolling sampler + 앵커·armLead)은 **실행영역 소유**다. 준비 파이프라인은 시계를 소유하지 않고 주입된 `Clock` view만 사용한다. 단 이 서비스는 attempt 시작 시 조기 기동한다 — 초기 동기화와 anchor까지 수행하므로 "pre-sampler"가 아니라 **attempt reference clock**으로 명명한다. 근거: 준비 deadline은 현행대로 serverClock 위에서 돌고(동작 보존), rolling estimator는 관측 span이 길수록 confidence가 개선되므로 준비 구간(수 초~수십 초)을 샘플링 창으로 쓰는 것이 armLead 품질에 기여한다. 동기화 실행 순서는 현행과 동일하다(validate → attempt reference clock 기동 → 준비).

## 6. Telemetry — 관측 전용

Telemetry는 어떤 행동도 결정하지 않고, 어떤 제어 채널로도 쓰이지 않는다. 발화점은 runner·coordinator·supervisor의 수명주기 지점으로 고정한다. RunSession에 흩어진 `tracePreparation()` 30여 호출점은 reporter 구현 1곳으로 수렴한다.

- 기존 `PREPARATION_OBSERVED` 재사용: stage_start / condition_changed / dispatch / decision(원인 포함) — runner가 reporter를 통해 방출.
- 신규 TRACE_CODES 2종: `RECOVERY_DECIDED`(cause, action, budget, time 스냅샷), `RECOVERY_DISPATCHED`(reset 결과) — supervisor가 background component로 방출.
- attempt 연결: RUN_STARTED attributes에 `logicalRunId`, `attemptIndex`, `resetCause`를 기록한다.
- 사용자 노출 메시지와 기존 오류 코드 문자열은 유지한다. trace attribute 구조 변경은 허용하되 CSV/진단 bundle export 경로 회귀 테스트로 보호한다.

## 7. 이행 단계 (각 단계 `npm run check` green + 커밋)

**Phase 1 — Data Plane 순수화(동작 보존):** 상세는 `30-implementation.md`.
1. `shared/run-control/` 신설: facts/causes/classifier/policy/protocol + 테이블 주도 테스트. (decide·protocol은 타입과 테스트만 — 배선은 Phase 2.)
2. BoundedStepRunner(기계 루프) + 테스트.
3. Entry/Calendar/Person coordinator + 테스트. prepareEntry/prepareDate/preparePerson 3벌을 coordinator 호출로 대체. 원인→HANDOFF 매핑은 현행과 동일 유지.
4. CalendarAdapter 사실 API 추가 후 정책 상태·beforeDispatch·errorCode 제거.
5. telemetry 발화점을 runner/coordinator로 이동.

**Phase 2 — Control Plane:** Phase 1 병합 후 `31-control-plane-implementation.md`로 계획.
6. `logicalRun` storage + `background/run-supervisor.ts` + PageRuntimePort(`navigateIfNeeded`/`forceReenter`/inject/ping) + TerminalEffects. 기존 리스너 5개 흡수, 진입점 통일, top-level bootstrap reconcile.
7. AttemptControlMessage 배선(flush→결정 영속→ACK→reenter 계약, 재전송 재ACK, `GET_ATTEMPT_STATUS`, `supervisorReady` barrier 포함) + decide() 배선 + RESET_PAGE 실행 + 알림 억제 + Side Panel RECOVERING 표시.
8. Chrome DevTools MCP E2E: DATE_SELECTION_STALLED 유도 → RESET 1회 → 재준비 → dry-run 완주. 오픈 임박 시 HANDOFF, EXECUTING 진입 후 RESET 금지 확인.

**Phase 3 — 범위 밖(후속):** ExecutionPhase 내부 분해(Slot/PostSlot coordinator). 공식 p95 측정 하네스(RT-11/12) 확보 후 착수한다.

## 8. 하위호환·회귀 위험 지점

1. **hot path 무변경**: `waitForOpen` 이후 코드는 diff가 없어야 한다. ExecutionPhase 경계는 메서드 호출 경계일 뿐 런타임 간접층을 추가하지 않는다.
2. **orchestrator 테스트**: 준비 단계 관련 테스트는 coordinator/runner 단위로 이동·갱신되지만, 실행 단계 테스트(토글·슬롯·post-slot)는 한 줄도 수정하지 않고 통과해야 한다.
3. **storage 계약**: `activeRun`/`runEvents`/`reservationConfig` 형식 불변. `logicalRun`은 추가 키.
4. **제어 메시지 유실·중복**: ATTEMPT_FINISHED ACK 실패 시 재시도 후 포기 — 안전 기본값은 "reset 없음, 현행 terminal 유지". 같은 attempt의 재전송은 영속된 decision 재ACK로 흡수해 resetCount 이중 증가를 막는다. reconcile이 잔여 logical run을 정리한다.
5. **flush-ACK-reenter 순서**: ACK 이전 forceReenter는 trace 유실 + 응답 채널 사망(content 재시도 무한화). "결정 영속 → ACK → supervisor queue에서 reenter" 순서를 코드 구조로 강제하고, E2E에서 reset 전후 IndexedDB eventCount·seq 연속성을 확인한다.
6. **RESET 루프 폭주**: resetCount 예산(기본 1)과 RESET_MIN_LEAD_MS가 이중 방어. E2E에서 2회째 정체가 HANDOFF로 끝나는지 확인한다.
7. **terminal 효과 오보**: TerminalEffects가 supervisor 결정 이전에 실행되면 RESET 중 "인계됨" 알림이 나간다. 효과 호출 경로가 supervisor 하나뿐인지 타입 수준에서 강제한다(recordEvent에서 해당 분기 삭제).
8. **scheduled job 경로**: launchScheduledJob이 supervisor를 경유하므로 job 상태 전이(markJobRunning/finishJob)는 logical run 종결 기준으로 이동한다.
9. **오류 코드 세분화는 의도된 계약 변경**: 구 fallback `DATE_PREPARATION_BLOCKED`가 `DATE_UNAVAILABLE`/`DATE_NOT_IN_CALENDAR`/`MONTH_NAVIGATION_UNAVAILABLE`/`MONTH_TRANSITION_STALLED`로 세분화된다. "동작 보존"은 사용자 가시 메시지·상태 전이에 적용되고 `preparationErrorCode`에는 적용되지 않는다. 매핑은 `30-implementation.md` Task 5의 표와 테스트로 고정하며, CSV·진단 소비자는 코드 확장을 전제한다.

## 9. 테스트 전략

- classifier.ts / policy.ts: 순수 테이블 테스트(사실·원인 × 예산 × 시간 조합 전수).
- BoundedStepRunner: fake clock/port로 발견·재시도·확인·정체·progressKey 리셋 시나리오.
- Coordinator: fake 포트로 단계 의미(메시지·pair-loop·재순환) 검증. entry/person 중복 시나리오는 데이터만 바꿔 재사용.
- Adapter: 기존 fixture 테스트를 사실 반환 계약으로 축소.
- Supervisor(Phase 2): fake chrome ports로 revive·멱등(ACK 유실 재전송 replay 포함)·phase 가드·bootstrap reconcile(`GET_ATTEMPT_STATUS`)·`supervisorReady` barrier·효과 순서.
- E2E(Phase 2): Chrome DevTools MCP로 §7-8 시나리오.
