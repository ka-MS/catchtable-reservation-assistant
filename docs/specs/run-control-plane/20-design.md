# 실행 제어 평면 구조화 설계 (run-control-plane)

**기준일:** 2026-07-16
**선행:** `docs/specs/open-timing-performance/03-runtime-resilience/10-analysis.md`, `01-rt16-preparation-recovery/`(부분 구현, 재개방), `docs/specs/orchestrator-refactor/20-design.md`(behavior-neutral 분해 이력)
**상태:** 설계 검토 중

## 1. 목표

발생(사실) → 원인(분류) → 정책(결정) → 행동(실행) → 기록(telemetry)의 제어 책임을 인터페이스로 연결된 별도 모듈로 분리한다. 준비영역과 실행영역을 파이프라인으로 나누고, 논리 실행(logical run)을 감독하는 단일 주체를 둔다.

완료 후 상태 검증 기준: **동일 탭 URL 재진입(RESET_PAGE)이 "정책 테이블 행 1개 + Action variant 1개 + 실행 port 연결"만으로 추가된다.**

## 2. 비목표

- 실행영역 hot path(날짜 토글, 슬롯 감지·클릭, wake, EMPTY 조기 종료) 내부 변경. `ExecutionPhase` 경계 뒤에 무변경 격리한다.
- 자동화 경계 변경. 로그인·CAPTCHA·결제·최종 예약은 여전히 자동화하지 않는다.
- Side Panel UI 재설계(RECOVERING 표시 최소 추가만).
- 취소 스나이핑, 다중 탭.

## 3. 사전 red-team 판정 (직전 구조안 대비)

| 항목 | 판정 | 근거 |
|---|---|---|
| Classifier / Policy 별도 모듈 | 병합 | 새 원인 코드는 정책 행과 항상 함께 추가된다(변경 주기 동일). 순수 모듈 1개에 `classify()`/`decide()` 두 함수. |
| Recovery Dispatcher + Executor 레지스트리 | 기각 | 행동 3종에 레지스트리는 투기적 일반화. closed union + exhaustive switch가 타입 안전 레지스트리다. |
| Entry/Date/Person Step 클래스 3개 | 수정 | 병은 루프 복붙(현행 prepareEntry ≈ preparePerson). 제네릭 runner 1개 + 선언적 StepSpec으로 통합. |
| Background Run Supervisor | 유지·강화 | background에 이미 흩어진 반쪽 supervisor(stopRun, tabs.onRemoved, tabs.onUpdated, cancelledPendingRuns, assertPending)를 흡수 통합한다. |
| Execution Pipeline 즉시 4분해 | 보류 | 실오픈 검증 증거가 걸린 코드. 결합이 시간적(temporal)이라 공식 p95 하네스(RT-11/12) 확보 전 분해는 회귀 도박. |
| 정책 입력 | 보강 | deadline-aware 필수: RESET은 5~15초짜리 행동이라 오픈 임박 시 금지해야 한다. |

## 4. 아키텍처: Control Plane / Data Plane

```text
┌─ CONTROL PLANE — background, 저빈도·영속·멱등 ──────────────┐
│ RunSupervisor (process manager)                              │
│  ├─ LogicalRun 수명주기: attempt 생성·예산·종결·알림        │
│  ├─ decide(cause, budget, time) 실행: switch(action)         │
│  ├─ 기존 리스너 흡수: PANEL_STOP, tabs.onRemoved,            │
│  │   tabs.onUpdated(이탈), cancelledPendingRuns              │
│  └─ 진입점 통일: PANEL_START / 스케줄 알람                   │
│ PageRuntimePort: navigate·inject·ping (기존 코드 재배치)     │
└──────────────────────────────────────────────────────────────┘
        ▲ attempt terminal event(원인 포함, 기존 RUN_EVENT 경로)
        │ START {runId=attemptId, logicalRunId, ...}
┌─ DATA PLANE — content, attempt 1회 자율 실행 ────────────────┐
│ AttemptSession (기존 RunSession 축소)                        │
│  ├─ validate → clock sync (기존 유지)                        │
│  ├─ PreparationPhase: BoundedStepRunner ×1                   │
│  │    ← StepSpec: entry / month / date / person (데이터)     │
│  │    ← Adapter: 사실 관측 + 단일 클릭만                     │
│  └─ ExecutionPhase: 기존 waitForOpen~advancePostSlot 무변경  │
└──────────────────────────────────────────────────────────────┘
┌─ FUNCTIONAL CORE — shared/run-control/, 순수 ────────────────┐
│ classify(StepFacts) → Cause                                  │
│ decide(Cause, Budget, TimeView) → Action                     │
└──────────────────────────────────────────────────────────────┘
```

원칙: shared core는 chrome/DOM 무접근(기존 규칙), adapter만 querySelector, supervisor는 실행 hot path에 개입하지 않는다(EXECUTING 진입 후 content는 terminal까지 자율).

## 5. 계약

### 5.1 사실 (adapter/step이 반환하는 유일한 것)

Adapter는 관측과 단일 행동만 남긴다. `EntryAdapter.inspect()`, `CalendarAdapter`의 사실 관측(`displayedMonth`, 목표 셀 상태), `clickDate`, `PersonAdapter.inspect/select`. **CalendarAdapter의 pendingMonth/pendingDate/attempt 재시도 상태와 `beforeDispatch` 콜백, `errorCode` 생성은 제거한다** — 재시도 상태는 runner의 run-scoped 상태로 이동하므로 RT-16B의 `resetPreparation()`도 구조적으로 불필요해진다.

### 5.2 BoundedStepRunner + StepSpec

runner 1개가 `발견 → dispatch(≤max) → 확인 deadline → 정체 분류` 루프를 소유한다. 현행 RT-16C의 상수(2회, 1초 재시도, discovery/confirm deadline 분리)를 그대로 이식한다.

```ts
interface StepSpec<F> {
  stage: "entry" | "month" | "date" | "person";
  inspect(): F;                    // adapter 사실
  isReady(f: F): boolean;
  fatalCause(f: F): Cause | null;  // 예: WAITING_ONLY, PERSON_UNAVAILABLE
  canDispatch(f: F): boolean;
  dispatch(): boolean;             // 단일 행동
  conditionKey(f: F): string;      // condition_changed telemetry 중복 억제
  stalledCause: Cause;             // deadline 도달 시 원인
  discoveryTimeoutMs; confirmTimeoutMs; maxAttempts; retryDelayMs;
}
```

달력은 `month`(목표 월 이동) → `date`(목표 날짜 선택) 두 StepSpec의 순차 실행으로 모델링한다. entry의 홍보 인터스티셜 닫기는 entry spec의 dispatch 전 보조 행동으로 유지한다.

### 5.3 원인과 행동 (shared/run-control/decision.ts)

```ts
type Cause =
  | "ENTRY_CTA_MISSING" | "ENTRY_TRANSITION_STALLED" | "WAITING_ONLY"
  | "MONTH_TRANSITION_STALLED" | "DATE_NOT_IN_CALENDAR" | "DATE_UNAVAILABLE"
  | "DATE_SELECTION_STALLED" | "PERSON_UNAVAILABLE" | "PERSON_SELECTION_STALLED";
  // 기존 RT-16 코드 계승. 실행영역 원인(SETUP_INVALID 등)은 이번 decide() 범위 밖이며
  // 현행대로 즉시 인계한다 — 오픈 후 RESET은 시간 게이트가 어차피 차단한다.

type Action =
  | { kind: "RESET_PAGE"; cause: Cause }   // 동일 탭 URL 재진입 + 새 attempt
  | { kind: "HANDOFF"; cause: Cause };

decide(cause: Cause,
  budget: { resetCount: number },
  time: { msToOpen: number; msToStop: number },
  mode: { entryMode: EntryMode }): Action
```

단계 내 재시도(RETRY_STEP)는 runner의 기계적 예산(maxAttempts)이지 정책 결정이 아니다 — decide()는 **단계 예산 소진 이후**의 원인만 받는다.

기본 정책 표(상수는 튜너블, `RESET_MIN_LEAD_MS` 기본 45,000):

| 조건 | 행동 |
|---|---|
| 사실상 종결 원인(WAITING_ONLY, PERSON_UNAVAILABLE, DATE_UNAVAILABLE, DATE_NOT_IN_CALENDAR) | HANDOFF |
| 정체 원인 ∧ resetCount = 0 ∧ msToOpen > RESET_MIN_LEAD_MS ∧ entryMode = "auto" | RESET_PAGE |
| 그 외 | HANDOFF |

`entryMode="prepared"`는 사용자가 준비한 모달을 파괴하므로 RESET을 금지한다. dry-run은 RESET을 허용한다(탐색 검증 목적과 충돌 없음).

### 5.4 attempt 프로토콜: "attempt는 항상 terminal, supervisor가 revive"

content는 현행대로 attempt를 terminal 상태(원인 포함 HANDED_OFF 등)로 끝낸다. 새 대기 프로토콜을 만들지 않는다. supervisor는 terminal 이벤트(기존 RUN_EVENT → recordEvent 경로)에서 준비 원인을 읽고 decide()를 실행해, RESET_PAGE면 **새 attempt(새 runId)** 를 시작한다.

- 상태머신의 "terminal 불변" 계약과 IndexedDB `[runId, seq]` 키를 그대로 보존한다.
- 멱등성: supervisor는 `logicalRun.currentAttemptId`와 불일치하는 terminal 이벤트를 무시한다.
- SW 재시작: `logicalRun`은 storage 영속. `onStartup/onInstalled` reconcile에서 진행 중 logical run을 읽고, content PING 실패 + 시간 예산 초과면 종결한다.
- content가 background에 도달 불가한 경우: 현행과 동일하게 HANDED_OFF로 남는다(안전 기본값 = 현행 동작).

### 5.5 상태 모델과 표현

- 신규: `LogicalRun { logicalRunId, attempts: [{ runId, startedAt, finalState?, cause? }], resetCount, config, tabId, status: PREPARING | EXECUTING | RECOVERING | TERMINAL }` — background 단독 소유 storage 키.
- 기존 `RunState`/`activeRun`은 attempt 단위 projection으로 **무변경 유지**(sidepanel 라벨·trace·CSV 하위호환).
- 알림·배지: supervisor가 revive하는 attempt의 terminal에서는 억제하고, logical run 종결에서만 발화한다(현행 recordEvent의 알림 분기가 logicalRun을 참조).
- Side Panel: `logicalRun` 구독으로 "재시도 중" 표시 1줄 추가.

## 6. Telemetry

발화점을 runner와 supervisor의 수명주기 지점으로 고정한다. RunSession에 흩어진 `tracePreparation()` 30여 호출점은 소멸한다.

- 기존 `PREPARATION_OBSERVED` 재사용: stage_start / condition_changed / dispatch / decision(원인 포함) — runner가 방출.
- 신규 TRACE_CODES 2종: `RECOVERY_DECIDED`(cause, action, budget, time 스냅샷), `RECOVERY_DISPATCHED`(reset 결과) — supervisor가 background component로 방출.
- attempt 연결: RUN_STARTED attributes에 `logicalRunId`, `attemptIndex`, `resetCause`를 기록한다.
- 사용자 노출 메시지와 기존 오류 코드 문자열은 유지한다. trace attribute 구조 변경은 허용하되 CSV/진단 bundle export 경로 회귀 테스트로 보호한다.

## 7. 이행 단계 (각 단계 `npm run check` green + 커밋)

**Phase 1 — Data Plane 순수화(동작 보존):**
1. `shared/run-control/` 신설: Cause/Action 타입, classify(), decide() + 테이블 주도 테스트.
2. BoundedStepRunner + entry/month/date/person StepSpec. prepareEntry/prepareDate/preparePerson 3벌을 runner 호출로 대체. 원인→HANDOFF 매핑은 현행과 동일하게 유지(decide()는 아직 미배선).
3. CalendarAdapter에서 재시도 정책 상태·beforeDispatch·errorCode 제거, 사실 관측으로 축소. 관련 fixture 테스트 갱신.
4. telemetry 발화점을 runner로 이동, `tracePreparation()` 제거.

**Phase 2 — Control Plane:**
5. `background/run-supervisor.ts` + `logicalRun` storage + PageRuntimePort(기존 navigateTab/ensureContent 재배치). 기존 리스너 5개 흡수. 진입점(PANEL_START/알람) 통일.
6. decide() 배선 + RESET_PAGE 실행(동일 탭 navigate → inject → 새 attempt START). 알림 억제, Side Panel RECOVERING 표시.
7. Chrome DevTools MCP E2E: DATE_SELECTION_STALLED 유도 → RESET 1회 → 재준비 → dry-run 완주. 오픈 임박(RESET_MIN_LEAD 미만) 시 HANDOFF 확인.

**Phase 3 — 범위 밖(후속):** ExecutionPhase 내부 분해(Slot/PostSlot coordinator). 공식 p95 측정 하네스(RT-11/12) 확보 후 착수한다.

## 8. 하위호환·회귀 위험 지점

1. **hot path 무변경**: `waitForOpen` 이후 코드는 diff가 없어야 한다. ExecutionPhase 경계는 메서드 호출 경계일 뿐 런타임 간접층을 추가하지 않는다.
2. **orchestrator 테스트**: 준비 단계 관련 테스트는 runner 단위로 이동·갱신되지만, 실행 단계 테스트(토글·슬롯·post-slot)는 한 줄도 수정하지 않고 통과해야 한다.
3. **storage 계약**: `activeRun`/`runEvents`/`reservationConfig` 형식 불변. `logicalRun`은 추가 키.
4. **알림 이중 발화**: revive 시 attempt terminal 알림을 억제하지 못하면 사용자에게 "인계됨" 오보가 간다. recordEvent-supervisor 순서를 SerialTaskQueue로 직렬화한다.
5. **RESET 루프 폭주**: resetCount 예산(기본 1)과 RESET_MIN_LEAD_MS가 이중 방어. E2E에서 2회째 정체가 HANDOFF로 끝나는지 확인한다.
6. **scheduled job 경로**: launchScheduledJob이 supervisor를 경유하도록 바뀌므로 job 상태 전이(markJobRunning/finishJob)는 logical run 종결 기준으로 이동한다.

## 9. 테스트 전략

- decision.ts: 순수 테이블 테스트(원인 × 예산 × 시간 조합 전수).
- BoundedStepRunner: fake clock/port로 발견·재시도·확인·정체 시나리오. entry/person 중복 시나리오는 spec 데이터만 바꿔 재사용.
- Adapter: 기존 fixture 테스트를 사실 반환 계약으로 축소.
- Supervisor: fake chrome ports(tabs/scripting/alarms/storage)로 revive·멱등·SW 재시작 reconcile.
- E2E: Chrome DevTools MCP로 Phase 2 시나리오(7번 항목).
