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
│  ├─ validate → reference clock pre-sampler 기동(실행영역 소유)│
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

content는 현행대로 attempt를 terminal 상태로 끝낸다(상태머신 terminal 불변·IndexedDB `[runId, seq]` 보존). 다만 supervisor 통지는 기존 RUN_EVENT(best-effort, 유실 허용)가 아니라 **전용 typed 메시지**로 한다:

```ts
// shared/run-control/protocol.ts
type AttemptPhase = "PREPARING" | "EXECUTING";
type AttemptOutcome =
  | { kind: "terminal"; state: RunState }                                   // 실행영역 종결(현행 의미)
  | { kind: "preparation_failed"; cause: PreparationCause; attempts: number };
type AttemptControlMessage =
  | { type: "ATTEMPT_PHASE_CHANGED"; logicalRunId: string; attemptId: string; phase: AttemptPhase }
  | { type: "ATTEMPT_FINISHED"; logicalRunId: string; attemptId: string; outcome: AttemptOutcome };
```

준비 실패 시 순서(각 화살표가 계약):

```text
content terminal 확정 → trace/diagnostics flush 완료
  → ATTEMPT_FINISHED 전송 (sendMessage response = ACK, 실패 시 제한 재시도)
  → supervisor decide()
  → RESET_PAGE: TerminalEffects 억제 → forceReenter() → inject → 새 attempt START
  → HANDOFF: logical run terminal 확정 → TerminalEffects 실행
```

- **flush 후 전송, ACK 후 reenter**: `forceReenter()`는 페이지를 unload하므로, ACK 이전에 실행하면 trace가 유실된다. content는 flush 완료 뒤에만 `ATTEMPT_FINISHED`를 보내고, supervisor는 이 메시지 수신(= flush 완료 증거) 후에만 reenter한다.
- **안전 기본값**: content가 background에 도달하지 못하면(ACK 없음) 자동 reset 없이 현재 attempt의 terminal 상태로 끝난다 — 현행 동작과 동일.
- **멱등성**: supervisor는 `logicalRun.currentAttemptId`와 불일치하는 메시지를 무시한다. `ATTEMPT_PHASE_CHANGED(EXECUTING)` 수신 후에는 어떤 RESET도 금지한다.
- **SW 재기동**: `logicalRun`은 storage 영속. reconcile은 `onStartup`/`onInstalled`가 아니라 **service worker 모듈 top-level에서 매 기동마다** 실행한다(리스너 등록을 막지 않도록 비동기로). 진행 중 logical run을 읽고, content PING 실패 + 시간 예산 초과면 종결한다.
- RUN_EVENT는 계속 흐르되(사이드패널 projection·이벤트 로그) 제어 결정에 사용하지 않는다.

### 5.5 상태 모델·terminal 효과

- 신규: `LogicalRun { logicalRunId, attempts: [{ runId, startedAt, finalState?, cause? }], resetCount, config, tabId, status: PREPARING | EXECUTING | RECOVERING | TERMINAL }` — background 단독 소유 storage 키.
- 기존 `RunState`/`activeRun`은 attempt 단위 projection으로 **무변경 유지**(sidepanel 라벨·trace·CSV 하위호환).
- **TerminalEffects 모듈**: 예약 작업 종료(finishJob)·배지·OS 알림. logical run terminal에서만, supervisor 결정 이후에만 실행한다. 현행 `recordEvent`의 해당 분기들은 이 모듈로 이동한다 — "저장 즉시 알림"이 사라져 RESET 중 오보(인계됨 알림)가 구조적으로 불가능해진다.
- Side Panel: `logicalRun` 구독으로 "재시도 중"(RECOVERING) 표시 1줄 추가.

### 5.6 시계 소유권

reference clock(부트스트랩 표본 + rolling sampler + 앵커·armLead)은 **실행영역 소유**다. 준비 파이프라인은 시계를 소유하지 않고 주입된 `Clock` view만 사용한다. 단 sampler는 attempt 시작 시 조기 기동한다 — 이름은 **reference clock pre-sampler**로 명시한다. 근거: 준비 deadline은 현행대로 serverClock 위에서 돌고(동작 보존), rolling estimator는 관측 span이 길수록 confidence가 개선되므로 준비 구간(수 초~수십 초)을 샘플링 창으로 쓰는 것이 armLead 품질에 기여한다. 동기화 실행 순서는 현행과 동일하다(validate → pre-sampler 기동 → 준비).

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
7. AttemptControlMessage 배선(flush→ACK→reenter 계약 포함) + decide() 배선 + RESET_PAGE 실행 + 알림 억제 + Side Panel RECOVERING 표시.
8. Chrome DevTools MCP E2E: DATE_SELECTION_STALLED 유도 → RESET 1회 → 재준비 → dry-run 완주. 오픈 임박 시 HANDOFF, EXECUTING 진입 후 RESET 금지 확인.

**Phase 3 — 범위 밖(후속):** ExecutionPhase 내부 분해(Slot/PostSlot coordinator). 공식 p95 측정 하네스(RT-11/12) 확보 후 착수한다.

## 8. 하위호환·회귀 위험 지점

1. **hot path 무변경**: `waitForOpen` 이후 코드는 diff가 없어야 한다. ExecutionPhase 경계는 메서드 호출 경계일 뿐 런타임 간접층을 추가하지 않는다.
2. **orchestrator 테스트**: 준비 단계 관련 테스트는 coordinator/runner 단위로 이동·갱신되지만, 실행 단계 테스트(토글·슬롯·post-slot)는 한 줄도 수정하지 않고 통과해야 한다.
3. **storage 계약**: `activeRun`/`runEvents`/`reservationConfig` 형식 불변. `logicalRun`은 추가 키.
4. **제어 메시지 유실**: ATTEMPT_FINISHED ACK 실패 시 재시도 후 포기 — 안전 기본값은 "reset 없음, 현행 terminal 유지". reconcile이 잔여 logical run을 정리한다.
5. **flush-reenter 순서**: ACK 이전 forceReenter는 trace 유실. E2E에서 reset 전후 IndexedDB eventCount·seq 연속성을 확인한다.
6. **RESET 루프 폭주**: resetCount 예산(기본 1)과 RESET_MIN_LEAD_MS가 이중 방어. E2E에서 2회째 정체가 HANDOFF로 끝나는지 확인한다.
7. **terminal 효과 오보**: TerminalEffects가 supervisor 결정 이전에 실행되면 RESET 중 "인계됨" 알림이 나간다. 효과 호출 경로가 supervisor 하나뿐인지 타입 수준에서 강제한다(recordEvent에서 해당 분기 삭제).
8. **scheduled job 경로**: launchScheduledJob이 supervisor를 경유하므로 job 상태 전이(markJobRunning/finishJob)는 logical run 종결 기준으로 이동한다.

## 9. 테스트 전략

- classifier.ts / policy.ts: 순수 테이블 테스트(사실·원인 × 예산 × 시간 조합 전수).
- BoundedStepRunner: fake clock/port로 발견·재시도·확인·정체·progressKey 리셋 시나리오.
- Coordinator: fake 포트로 단계 의미(메시지·pair-loop·재순환) 검증. entry/person 중복 시나리오는 데이터만 바꿔 재사용.
- Adapter: 기존 fixture 테스트를 사실 반환 계약으로 축소.
- Supervisor(Phase 2): fake chrome ports로 revive·멱등·phase 가드·bootstrap reconcile·효과 순서.
- E2E(Phase 2): Chrome DevTools MCP로 §7-8 시나리오.
