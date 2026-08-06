# 01. 관측 분리 구현

**상태:** 완료
**작업일:** 2026-08-07
**브랜치:** `codex/refactor-observation-split`
**기준:** `main` @ `9bca880`
**부모 패키지:** [오케스트레이터 확장성 기반](../00-index.md)

## 결과

```
src/content/orchestrator.ts              1,630 → 1,190줄  (-440)
src/content/observation/payloads.ts        신규   401줄
src/content/observation/run-observer.ts    신규   332줄

tests/orchestrator-observation.test.mjs    신규  21개  특성화
tests/observation-payloads.test.mjs        신규  22개  순수 함수 golden
tests/observation-run-observer.test.mjs    신규  26개  예외 경계 계약

기존 테스트                                 540개 무수정
전체                                       609/609 통과
```

`src/content/index.ts`를 포함한 나머지 80개 파일은 변경하지 않았다.
`Dependencies` 계약은 그대로다.

## 커밋 순서

되돌리기 쉬운 순서로 다섯 개다. 각 커밋이 독립적으로 `npm run check` 그린이다.

| 커밋 | 내용 | 줄 변화 |
|---|---|---|
| `3142e70` | 현재 동작 고정 테스트 21개 (코드 변경 없음) | — |
| `3919cac` | payload 순수 함수 7개 → `payloads.ts` | 1,630 → 1,466 |
| `46d28dc` | `RunObserver` 도입, trace 10곳 이동 | 1,466 → 1,244 |
| `43df667` | run event·breadcrumb·`failureData` 이동 | 1,244 → 1,175 |
| `4ee4e20` | availability 콜백 개명, 경계 역할 명시 | 1,175 → 1,194 |
| (리뷰 반영) | 격리 경계 복구, 빌더 승격, 미사용 import 제거 | 1,194 → 1,190 |

`4ee4e20`에서 줄이 느는 것은 주석 때문이다.

## 계층

### `payloads.ts` — 순수 함수

세션 의존이 없다. orchestrator 없이 단위 테스트할 수 있다.

`postSlotEventData`, `stageSnapshotData`, `detectionClockData`,
`referenceClockMetricData`, `toggleCycleAttributes`, `targetClickMetricData`,
`slotDetectedEventData`, `slotClickDispatchedEventData`

`detectionClockData`는 세션 필드(`latestAppliedEstimate`)를 읽던 메서드였다.
`estimate`와 `wallOffsetMs`를 인자로 받게 바꿔 순수 함수가 됐다.

`stageSnapshotData`는 `tests/snapshot-data.test.mjs`가 `orchestrator.js`에서
직접 import하므로 re-export를 남겼다. 그 테스트는 수정하지 않았다.

### `run-observer.ts` — 스탬핑·예외 경계·관측 정책

```ts
interface ObservationContext {
  now(): number;              // wall clock (RunEvent.at)
  serverAt(): number | null;  // serverClockReady ? serverClock.now() : null
  state(): RunState;
  monoNow(): number;
}
```

세션은 클로저 넷으로 배선한다. 관측 계층이 `RunSession`을 알 필요가 없고
순환 의존도 없다.

관측 정책도 함께 옮겼다.

- `DIAGNOSTIC_BREADCRUMB_STATES` — 어느 상태가 breadcrumb 대상인지
- `DiagnosticsPort` 인터페이스

## 예외 격리 — 설계에서 가장 크게 바뀐 부분

설계 초안은 "관측 전용 `catch` 9개를 1개로 합친다"였다. **둘 다 틀렸다.**

### 발견 1: `catch` 22개가 전부 관측용이 아니다

분류하니 관측 9 / 혼합 2 / **제어 복원력 11**이었다.

| 행 | 내용 |
|---|---|
| 1173 | `availabilityWake.wait()` 실패 → `deps.sleep` 폴백. **핫패스 제어** |
| 869 | `attemptPhase("EXECUTING")`. control plane 신호 |
| 271 | `mutationSnapshot()` 기본값 폴백 |
| 1377 | `new URL()` 파싱 실패 시 `shopSlug` 비움 |
| 435·472·479·725·730·913·1035 | shadow·watch·기준시계 lifecycle |

→ 제어 11개는 손대지 않았다. 현재 `orchestrator.ts`에 남은 13개는
**제어 11 + 혼합 2**다.

### 발견 2: 관측 격리가 원래 비대칭이다

`trace` 호출 10곳 중 6곳만 격리돼 있었다. 실측 결과는 다음과 같다.

```
DATE_TOGGLE_CYCLE trace가 던짐  → state=FAILED   실행이 죽는다
SLOT_CLICKED trace가 던짐       → state=FAILED   실행이 죽는다
AVAILABILITY_SHADOW가 던짐      → 영향 없음
CLOCK_SAMPLE이 던짐             → 영향 없음
emit이 던짐                     → start()가 reject, RunResult 없음
```

`safeTrace` 하나로 통일하면 4곳의 동작이 바뀐다. 동작 무변경 범위를
벗어나므로 **비대칭을 그대로 보존**하고, 격리 통일 여부는
[#20](https://github.com/ka-MS/catchtable-reservation-assistant/issues/20)으로
분리했다.

### 구현: `send` / `sendSafe`

`RunObserver`가 두 전송 경로를 갖는다.

| 경로 | 대상 | 이동 전 |
|---|---|---|
| `sendSafe()` | `wakeResult`, `clockSamples`(표본별) | 자체 `try/catch` 있었음 |
| `safeCall()` 블록 | `preparation`, `emptyExit` | 메서드 전체가 감싸여 있었음 |
| `send()` | `toggleCycle`, `slotClicked`, `runFailed` | **감싸여 있지 않았음** |
| `send()` | `availabilityBody`, `availabilityDom` | 호출자가 감싸고 있음 |

마지막 항목이 중요하다. `availabilityBody`를 `sendSafe`로 바꾸면 안 된다.
호출자(`onAvailabilityBody`)의 catch는 trace 실패 시 **뒤따르는 late DOM
비교까지 함께 건너뛴다.** 여기서 삼키면 그 건너뜀이 사라져 동작이 바뀐다.

결과적으로 관측 계층 안의 격리 경계는 **5개**다. 범용 헬퍼
`safeCall(fn, fallback)` 하나를 다섯 곳에서 쓴다. 대상마다 fallback이
다르기 때문에 하나로 합칠 수 없다.

| 대상 | fallback |
|---|---|
| `trace` (격리 대상) | `undefined` |
| `diagnostics.breadcrumb` | `undefined` |
| `capturePreparationContext` | `null` → payload에서 생략 |
| `captureSnapshot` | `null` → `{}` 병합 |
| `diagnostics.failure` | `null` → `diagnosticSnapshotId` 생략 |

### 혼합 `catch` 2개는 쪼개지 못했다

코드는 제어(세션)와 관측(`RunObserver`)으로 나뉘었지만 **예외 경계는
하나로 남는다.** `onAvailabilityBody`의 catch가 제어 보호와 관측 흡수를
겸하고 있고, 쪼개면 late DOM 건너뜀이 사라진다.

설계의 "분할 후 각각 유지"를 "2 → 2 불변"으로 정정하고, 이중 역할을
주석으로 명시하는 데까지만 했다.

## 세부 보존 항목

동작 무변경을 위해 의도적으로 유지한 것들이다. 리뷰 시 확인 대상이다.

| 항목 | 이유 |
|---|---|
| `deps.emit`은 격리하지 않는다 | 이동 전에도 감싸여 있지 않았다. run event는 필수 경로 |
| `toggleCycle`·`slotClicked`의 `serverAt`·`state`는 호출자 명시값 | 이동 전에도 컨텍스트가 아니라 `"REFRESHING_SLOTS"` 같은 상수였다 |
| `clockSamples`의 `state: null` | terminal prune 반복 트리거 방지 |
| `clockSamples`의 표본 읽기·비우기는 세션에 잔류 | 세션 상태 변경이므로 관측이 소유하면 안 된다 |
| `emptyExit`의 `exitAtMonoMs`는 격리 블록 안에서 계산 | 이동 전 위치와 동일 |
| `transition`은 `event()` → `stateChanged()` 순서 | breadcrumb에 넘기는 data가 병합본이 아니라 `extra.data` 원본인 것까지 동일 |
| `failureData`의 snapshot ↔ `failure` 독립 | snapshot이 실패해도 `failure`는 실행된다 |
| `failureData`가 값을 반환 | 관측이 제어에 값을 주는 유일한 지점. 명령이 아니라 질의 |

## 개명

| 이전 | 이후 | 이유 |
|---|---|---|
| `observeAvailabilityBody` | `onAvailabilityBody` | 이름과 달리 제어다. `availabilityWake.offer()`의 반환이 핫패스 wake 신호를 결정한다 |
| `observeAvailabilityDom` | `correlateDomCandidate` | 상관관계 자료 구조를 갱신하는 제어다 |

## 핫패스 계약을 주석으로 고정

`runToggleCycle`의 스캔 루프에 다음을 박았다.

```ts
// 관측 계약(SP-025/01): 이 루프의 **매 반복 경로**에는 관측 호출을 넣지
// 않는다. 25ms·10ms 간격으로 도는 슬롯 감지 구간이다. 종료가 확정된
// 직후의 1회 관측(applyPendingEmptyExit 내부, EMPTY_EARLY_EXIT)은
// 허용된다 — 실행 즉시 break 하거나 return 하므로 반복 비용에 누적되지
// 않는다.
```

초안은 "루프 안에 관측을 넣지 않는다"였다. 그렇게 적었으면 바로 아래
`applyPendingEmptyExit`와 모순돼 주석이 무시됐을 것이다. 예외를 명시하고
**왜 예외인지**까지 적어야 새 관측을 추가하려는 사람이 자기 경우를
판단할 수 있다.

## 설계에서 정정한 사실 오류

구현 중 설계 문서의 서술 오류를 세 건 고쳤다. 상세는
[99-agent-process-notes.md](../99-agent-process-notes.md) 참조.

| 오류 | 실제 | 발견 계기 |
|---|---|---|
| "관측 전용 catch 9 → 1" | fallback이 5종이라 1로 합칠 수 없다 | 리뷰 |
| "trace가 던지면 `start()` reject" | `FAILED` 종결. reject는 `emit`일 때만 | 특성화 테스트 작성 |
| "25ms 루프 안에 관측 없음" | 조건부 관측 2개가 루프 안에 있다 | 성공 기준 8 실행 |

## PR #21 리뷰 반영

리뷰에서 네 건이 지적됐고 **전부 사실이었다.**

### [P1] 격리 경계가 축소돼 있었다 — 동작 무변경 위반

`sendSafe(code, severity, message, options)` 형태였을 때 **options 객체가
호출 전에 평가**돼 `ctx.serverAt()`·`ctx.state()` 예외가 경계 밖으로 샜다.
이동 전에는 스탬핑 계산까지 `try` 안에 있었다.

```
수정 전:  wakeResult()     ❌ 전파됨: serverAt boom
          clockSamples()   ❌ 전파됨: serverAt boom
수정 후:  전부 ✅ 격리됨
```

`clockSamples()`가 특히 위험했다. `execute()`의 `finally`에서 호출되므로
던지면 terminal `RunResult`를 덮고 flush를 건너뛴다.

`sendSafe`를 **thunk 기반**으로 바꿔 스탬핑·payload 조립을 전부 경계
안에 넣었다. `preparation`·`emptyExit`과 동일한 패턴이 됐다.

`tests/observation-run-observer.test.mjs`(26개)를 추가해 메서드별 경계
계약을 고정했다 — 격리 메서드 4개 × (`serverAt`·`state`·`trace` 실패),
전파 메서드 4개 + `emit`, 표본별 독립 격리, 스탬핑 계약, `failureData`
순서·독립성.

### [P1] HANDOFF가 #20을 건너뛰게 돼 있었다

`Blocking backlog: 없음`으로 두고 다음 작업을 02로 적어, `AGENTS.md` §5에
따라 다음 작업자가 #20을 건너뛸 수 있었다. #20을 blocking으로 지정하고
다음 작업을 **#20 격리 통일 판단**으로 바꿨다.

### [P2] 설계와 구현이 어긋나 있었다

설계는 인라인 attribute 빌더 6개를 `payloads.ts`로 승격한다고 선언했으나
실제로는 `RunObserver`에 인라인으로 남아 있었다. 의도적 범위 축소가
아니라 그냥 하지 않은 것이었으므로 **승격을 완료**했다.

`preparationAttributes`, `availabilityBodyAttributes`,
`domCorrelationAttributes`, `wakeResultAttributes`, `emptyExitAttributes`,
`clockSampleAttributes` — 각각 golden test를 붙였다(10개 추가).

컨텍스트 멤버 수(2 → 4)와 결과 크기도 실제 값으로 갱신했다.

### [P3] 미사용 import

`toggleCycleAttributes`, `TimingMark`, `ToggleCycleTrace`, `TogglePlan`이
추출 후 `orchestrator.ts`에서 쓰이지 않았다. `noUnusedLocals`가 꺼져 있어
typecheck가 잡지 못했다. 제거했다.
