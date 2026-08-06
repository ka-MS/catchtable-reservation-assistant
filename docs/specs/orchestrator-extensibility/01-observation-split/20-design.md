# 01. 관측 분리 설계

**상태:** 초안 (구현 승인 전)
**작성일:** 2026-08-07
**부모 패키지:** [오케스트레이터 확장성 기반](../00-index.md)
**범위:** 동작 무변경(behavior-neutral) 순수 구조 리팩터

## 목표

`src/content/orchestrator.ts`에서 **관측(텔레메트리 payload 조립·전송)** 을
**제어(상태 전이·예약 흐름)** 와 분리한다. 실행 동작·이벤트 값·타이밍은
바뀌지 않는다.

## 해결하려는 것

[10-analysis.md](../10-analysis.md) §3의 측정값이다.

| 지표 | 현재 |
|---|---|
| 텔레메트리 payload 조립 | 354줄 / 14블록 (파일의 22%) |
| 빈 `catch` | 22개 (관측 전용 9 / 혼합 2 / 제어 복원력 11) |
| `serverAt`·`state` 스탬핑 중복 | 28곳 |

## 설계 원칙

1. **관측은 제어에 영향을 주지 않는다** — **관측 전용** 예외 경계만
   관측 계층 내부로 모은다. 제어 복원력 경계는 그대로 둔다.
2. **관측은 세션 상태를 받지 않고 읽는다** — 스탬핑을 관측 계층이
   소유한다 (28곳 소멸).
3. **payload 조립은 순수 함수** — 세션 없이 단위 테스트 가능하게 한다.

### 원칙 1의 경계 — 무엇을 합치고 무엇을 두는가

`catch` 22개는 성격이 다르며, 전부 합치면 동작이 바뀐다.

| 성격 | 수 | 조치 |
|---|---|---|
| 관측 전용 (294, 309, 342, 361, 386, 391, 648, 686, 760) | 9 | **관측 계층으로 이동해 통합** |
| 혼합 (553, 569) | 2 | **제어·관측 분할 후 각각 유지** |
| 제어 복원력 (271, 435, 472, 479, 725, 730, 869, 913, 1035, 1173, 1377) | 11 | **그대로 둔다. 손대지 않는다** |

특히 다음은 관측이 아니므로 통합 대상이 아니다.

- **1173** `availabilityWake.wait()` 실패 → `deps.sleep` 폴백. 핫패스 제어.
- **869** `attemptPhase("EXECUTING")`. control plane 신호.
- **271** `mutationSnapshot()` 기본값 폴백.
- **1377** `new URL()` 파싱 실패 시 `shopSlug` 비움.

### 실패 의미를 각각 정의한다

관측 계층 안에서도 실패의 뜻이 다르므로 하나의 정책으로 뭉치지 않는다.

| 대상 | 실패 시 | 근거 |
|---|---|---|
| `trace` 전송 | 삼킨다 | 진단 목적. 예약 결과와 무관 |
| `diagnostics.breadcrumb` | 삼킨다 | 위와 같음 |
| `diagnostics.failure` | 삼키되 `null` 반환 | 실패해도 전이 payload는 나가야 한다 |
| `captureSnapshot` | 삼키되 `null` 반환 | **`diagnostics.failure`와 독립.** 현재 384·389행이 별도 블록이며, snapshot 실패 후에도 `failure()`가 실행된다 |
| **`deps.emit`** | **삼키지 않는다** | 현재 동작. `emit()`의 try/catch는 `diagnostics.breadcrumb`만 감싼다(292~297행). run event는 필수 경로다 |

`deps.emit`을 관측 계층으로 옮기면서 실수로 감싸면 회귀다. 이동 후에도
예외가 그대로 전파되어야 한다.

## 구조

```
src/content/observation/
  payloads.ts       순수 함수. 세션 의존 0.        (~330줄)
  run-observer.ts   스탬핑 + 예외 격리 + 관측 정책 (~220줄)

src/content/orchestrator.ts
  RunSession        제어만                        (~1,050줄)
```

### Layer 1 — `payloads.ts`

현재 파일 하단의 순수 함수를 그대로 옮기고, 인라인 attribute 리터럴을
같은 형태의 순수 함수로 승격한다.

이동 대상: `stageSnapshotData`, `postSlotEventData`,
`referenceClockMetricData`, `toggleCycleAttributes`, `targetClickMetricData`,
`slotDetectedEventData`, `slotClickDispatchedEventData`

승격 대상: `availabilityBodyAttributes`, `domCorrelationAttributes`,
`wakeResultAttributes`, `emptyExitAttributes`, `preparationAttributes`,
`clockSampleAttributes`

### Layer 2 — `RunObserver`

```ts
/** 관측이 세션에서 읽는 것 — 이 두 개가 전부다. */
interface ObservationContext {
  serverAt(): number | null;   // serverClockReady ? serverClock.now() : null
  state(): RunState;
}

interface ObservationDeps {
  trace?: Dependencies["trace"];
  emit: Dependencies["emit"];
  diagnostics?: DiagnosticsPort;
  captureSnapshot?(): StageSnapshot | null;
  capturePreparationContext?(): PreparationPageContext;
}

export class RunObserver {
  constructor(
    private readonly ctx: ObservationContext,
    private readonly deps: ObservationDeps,
    private readonly executionContext?: RunExecutionContext,
  ) {}

  /** trace 전송 격리 지점. 호출자는 try/catch를 쓰지 않는다. */
  private safeTrace(
    code: TraceCode, severity: TraceSeverity, message: string,
    attributes: TraceAttributes,
  ): void {
    try {
      this.deps.trace?.(code, severity, message, {
        serverAt: this.ctx.serverAt(),
        state: this.ctx.state(),
        attributes,
      });
    } catch {
      // 관측은 예약 결과를 바꾸지 않는다.
    }
  }

  // 관측 메서드는 '사실'만 받고 payload 조립은 내부에서 한다.
  availabilityBody(event, correlation, decision, selectedMinutes, wakeAtMonoMs): void {
    this.safeTrace(
      "AVAILABILITY_SHADOW",
      event.classification === "UNPARSABLE" ? "warn" : "trace",
      `슬롯 응답 shadow를 ${event.classification}로 분류했습니다.`,
      availabilityBodyAttributes(event, correlation, decision, selectedMinutes, wakeAtMonoMs),
    );
  }
  // toggleCycle / wakeResult / emptyExit / preparation / clockSamples / stateChanged ...
}
```

세션 쪽 배선은 클로저 두 개로 끝난다. 관측 계층이 `RunSession`을 통째로
알 필요가 없고, 순환 의존도 생기지 않는다.

```ts
this.observe = new RunObserver(
  {
    serverAt: () => this.serverClockReady ? this.serverClock.now() : null,
    state: () => this.machine.state,
  },
  deps,
  executionContext,
);
```

## 이동 매핑

| 현재 | 줄 | 이동 후 |
|---|---|---|
| 하단 순수 함수 7개 | ~250 | `payloads.ts` 그대로 |
| `traceAvailabilityDomCorrelation` | 33 | payloads + `observer.availabilityDom()` |
| `traceAvailabilityWakeResult` | 44 | payloads + `observer.wakeResult()` |
| `traceAvailabilityEmptyExit` | 37 | payloads + `observer.emptyExit()` |
| `tracePreparation` | 46 | `observer.preparation()` — 페이지 컨텍스트 캡처·격리 내부화 |
| `traceFrozenReferenceClockSamples` | 30 | `observer.clockSamples()` |
| `detectionClockData` | 9 | payloads (estimate를 인자로) |
| `emit()`의 breadcrumb 분기 | 6 | observer 내부 (emit 자체는 격리하지 않음) |
| `transition()`의 `DIAGNOSTIC_BREADCRUMB_STATES` 분기 | 8 | `observer.stateChanged()` |
| `runToggleCycle`의 `traceCycle` 클로저 | 29 | `observer.toggleCycle(trace)` — `ToggleCycleTrace` 타입이 이미 있어 인자 1개 |

## 주의 지점

### ① `failureData()`는 값을 반환한다

`diagnostics.failure()`가 만든 `diagnosticSnapshotId`를 전이 payload에
실어야 하므로 제어가 이 값을 소비한다. 원칙 1의 예외처럼 보이지만
**명령이 아니라 질의(query)** 이므로 관측 계층에 둔다.

관측이 제어에 값을 주는 **유일한 지점**임을 코드 주석으로 명시한다.
snapshot 캡처와 `diagnostics.failure()`의 **독립 실행 순서를 보존**한다.

### ② `observeAvailabilityBody`는 이름과 달리 제어다

`availabilityWake.offer()`의 반환값이 핫패스의 wake 신호를 결정한다
(`orchestrator.ts:502`). 66줄 중 제어는 약 18줄, 나머지 약 48줄이 trace다.

**분할하고 제어 쪽을 `onAvailabilityBody()`로 개명한다.** 현재
`observe*` 라는 이름이 오해를 만들고 있다. 분할 후에도 제어 쪽은
**자체 예외 경계를 유지**한다(비신뢰 bridge payload 처리이므로).

`observeAvailabilityDom`(569행)도 같은 구조다. `correlateDom` 호출은
제어, 이후 trace는 관측이다.

### ③ 핫패스 성능은 중립이다

25ms·10ms·5ms 루프 **안에서 호출되는 관측은 없다.** `traceCycle`은
사이클 종료 시 1회다([10-analysis.md](../10-analysis.md) §3).

이 사실을 `runToggleCycle`에 주석으로 못박는다. 이후 누군가 루프 안에
관측을 추가하는 것을 막는 유일한 수단이다.

## 검증

### 기존 테스트만으로는 부족하다

`tests/orchestrator.test.mjs`(2,046줄) 무수정 통과는 **필요조건이지
충분조건이 아니다.**

- `assert.deepEqual`은 값 비교이지 바이트 비교가 아니며, **객체 키 순서를
  검증하지 않는다.** `deepStrictEqual`도 사용하지 않는다.
- `attributes` 객체 **전체를 고정하는 단언은 `CLOCK_SAMPLE` 하나뿐**이다
  (`:268`). 나머지 `deepEqual`은 `phase`·`result` 한 필드만 map해서
  비교한다(`:363`, `:548` 등).
- 개별 필드 단언은 72곳이지만 14개 payload 블록 전체를 덮지 않는다.
- 예외 격리 동작과 호출 순서는 검증하지 않는다.

### 성공 기준

1. **기존 전체 스위트 무수정 통과** (`npm run check`).
2. **payload golden test 추가** — `payloads.ts`의 각 순수 함수에 대해
   대표 입력의 출력 객체 전체를 고정한다. 추출 전후로 동일해야 한다.
   추출 대상 함수마다 최소 1개.
3. **관측 실패 격리 테스트 추가** — `trace`, `diagnostics.breadcrumb`,
   `diagnostics.failure`, `captureSnapshot`이 각각 던져도 실행 결과
   (terminal state·message)가 바뀌지 않음을 확인한다.
4. **`deps.emit` 비격리 테스트 추가** — `emit`이 던지면 현재와 동일하게
   전파됨을 고정한다. 실수로 삼키게 되는 회귀를 막는다.
5. **호출 순서 테스트 추가** — `failureData()`에서 `captureSnapshot` →
   `diagnostics.failure` 순서와 상호 독립성을 고정한다.
6. `git diff --check` 통과.
7. Chrome 수동 로드 dry-run 1회.

2~5는 이 단계에서 새로 추가하는 테스트이며, 추출 **이전에** 현재
동작을 고정하는 용도로 먼저 작성한다(실패 테스트 우선).

### 영향 범위

```
src/content/index.ts          무변경 (Dependencies 계약 불변)
tests/snapshot-data.test.mjs  무변경 (orchestrator.ts에서 stageSnapshotData를 re-export)
그 외 80개 파일                무변경 (신규 테스트 파일 제외)
```

`stageSnapshotData`는 `tests/snapshot-data.test.mjs`가 `orchestrator.js`에서
직접 import하므로, `payloads.ts`로 옮긴 뒤 `orchestrator.ts`에서 re-export해
테스트 무수정을 유지한다.

## 커밋 순서

각 단계가 독립적으로 그린이며, 중간에 멈춰도 손해가 없다.

| # | 내용 | 위험 |
|---|---|---|
| 0 | 현재 동작 고정 테스트 추가 (성공 기준 2~5) | 없음 |
| 1 | `payloads.ts` 추출 — 순수 함수 7개 이동 + re-export | 거의 0 |
| 2 | `RunObserver` 도입 + 관측 전용 trace 메서드 이동 | 낮음 |
| 3 | `emit`·`transition`의 breadcrumb 정책 이동 | 낮음 |
| 4 | `observeAvailabilityBody`·`observeAvailabilityDom` 제어·관측 분할 + 개명 | 중간 |

0번을 먼저 하는 이유는, 추출 전후 동작 동일성을 비교할 기준선이
현재 테스트만으로는 부족하기 때문이다.

## 범위 밖

- payload **값** 변경 — attribute 이름·반올림·키 순서까지 동일하게 유지
- trace code 추가·삭제
- `Dependencies` 인터페이스 변경
- 어댑터·준비 엔진 수정
- 핫패스 상수(25ms·10ms·5ms·700ms·250ms) 변경
- **제어 복원력 `catch` 11개 수정**

## 예상 결과

```
orchestrator.ts              1,630 → 약 1,050  (제어만)
observation/payloads.ts               약 330   (순수, golden test 대상)
observation/run-observer.ts           약 220
관측 전용 빈 catch             9 → 1
제어 복원력 catch             11 → 11 (불변)
혼합 catch                     2 → 분할 후 각각 유지
```

후속 단계(`03` 핫패스 전략 추출)의 대상이 1,630줄에서 약 1,050줄로 줄어든다.
