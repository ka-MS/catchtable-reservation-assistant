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

1. **현재의 예외 격리 동작을 한 곳도 바꾸지 않는다** — 관측 전용 경계는
   관측 계층 내부로 모으되, **격리 여부 자체는 지금과 동일하게 보존**한다.
   제어 복원력 경계는 그대로 둔다.
2. **관측은 세션 상태를 받지 않고 읽는다** — 스탬핑을 관측 계층이
   소유한다 (28곳 소멸).
3. **payload 조립은 순수 함수** — 세션 없이 단위 테스트 가능하게 한다.

### ⚠️ 원칙 1이 "전부 격리한다"가 아닌 이유

**현재 관측 예외 격리는 비대칭이다.** 설계 초안은 "관측은 제어에 영향을
주지 않는다"를 현재 불변식처럼 서술했으나, 실측 결과 사실이 아니다.

`main` @ `9bca880`에서 fake dependency가 던지도록 하고 실행한 결과다.
`tests/orchestrator-observation.test.mjs`가 이 동작을 고정한다.

```
[DATE_TOGGLE_CYCLE trace가 던짐]  state=FAILED  message="trace boom"  ← 실행이 죽는다
[SLOT_CLICKED trace가 던짐]       state=FAILED  message="trace boom"  ← 실행이 죽는다
[AVAILABILITY_SHADOW가 던짐]      state=DRY_RUN_COMPLETED             ← 영향 없음
[CLOCK_SAMPLE이 던짐]             state=DRY_RUN_COMPLETED             ← 영향 없음
[breadcrumb·captureSnapshot·
 diagnostics.failure가 던짐]      영향 없음
[emit이 던짐]                     start()가 reject — RunResult 없음
[모든 trace가 던짐]               start()가 reject — RunResult 없음
```

격리되지 않은 `trace`가 던지면 `start()`가 reject되는 것이 아니라
`execute()`의 catch가 예외를 받아 **`FAILED`로 종결**한다. reject는
`emit`이 던지거나(FAILED 전이가 다시 `emit`을 부르므로) `RUN_FAILED`
trace까지 함께 던질 때만 발생한다. 어느 쪽이든 **관측 실패가 예약 실행을
끝낸다**는 사실은 같다.

`trace` 호출 10곳 중 **6곳은 격리, 4곳은 전파**한다.

| 행 | 위치 | 격리 |
|---|---|---|
| 313 `tracePreparation` / 515 `observeAvailabilityBody` / 578 `traceAvailabilityDomCorrelation` / 618 `wakeResult` / 666 `emptyExit` / 742 `clockSamples` | | 격리됨 |
| **457** | `execute()` catch의 `RUN_FAILED` | **전파** |
| **951** | `runToggleCycle`의 `traceCycle` | **전파** |
| **1237 / 1257** | `advanceFromSlot`의 `SLOT_CLICKED` | **전파** |

`emit`은 전파할 뿐 아니라 `execute()`의 catch가 시도하는 `FAILED` 전이에서
다시 던져 **`RunResult`가 반환되지 않는다.** `content/index.ts:210`의
`.then()`이 실행되지 않아 `ATTEMPT_FINISHED`도 전달되지 않는다.

따라서 `safeTrace` 하나를 10곳에 모두 적용하면 **4곳의 동작이 바뀐다.**
이는 이 단계의 선언된 범위(동작 무변경)를 벗어난다.

**결정:** 01은 비대칭을 그대로 보존한다. 격리 통일 여부는 별도 판단이
필요한 사안이므로 [#20](https://github.com/ka-MS/catchtable-reservation-assistant/issues/20)에서
다룬다. 01이 끝나면 지금은 우연인 비대칭이 `RunObserver`의 메서드 구분으로
**코드에 명시**되므로, 그 판단의 입력이 된다.

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

각 대상은 **fallback 값이 다르므로 독립 경계**다. 하나로 합칠 수 없다.

| 대상 | 현재 행 | 실패 시 | 이동 후 |
|---|---|---|---|
| `trace` — 격리된 6곳 | 313, 515, 578, 618, 666, 742 | `undefined` (무시) | `safeTrace()` |
| **`trace` — 전파하는 4곳** | **457, 951, 1237, 1257** | **전파** | **`emitTrace()`** |
| `diagnostics.breadcrumb` | 294, 361 | `undefined` (무시) | `safeCall` |
| `capturePreparationContext` | 309 | `null` → payload에서 생략 | `safeCall` |
| `captureSnapshot` | 386 | `null` → `{}` 병합 | `safeCall`. **`diagnostics.failure`와 독립** — 현재 384·389행이 별도 블록이며 snapshot 실패 후에도 `failure()`가 실행된다 |
| `diagnostics.failure` | 391 | `null` → `diagnosticSnapshotId` 생략 | `safeCall` |
| **`deps.emit`** | — | **전파** | 격리하지 않음 |

따라서 관측 계층 안의 **격리 경계는 5개**이며, 범용 헬퍼
`safeCall(fn, fallback)` 하나를 5곳에서 쓰는 형태가 된다. 인라인
`try/catch`는 호출부에서 0이 되지만 경계 수 자체는 1이 아니다.

**격리하지 않는 지점이 5개 더 있다**(`trace` 4곳 + `emit`). 이동 후에도
예외가 그대로 전파되어야 한다. 실수로 감싸면 회귀다.

이 구분이 01의 부산물 중 가장 값이 크다. 지금은 어느 관측이 실행을 죽일
수 있는지가 `try/catch` 유무로만 드러나 읽어야 알 수 있지만, 이동 후에는
`safeTrace` / `emitTrace` 호출 여부로 한눈에 보인다.

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

  /** 범용 격리 헬퍼. 대상마다 fallback이 다르므로 값을 받는다. */
  private safeCall<T>(fn: () => T, fallback: T): T {
    try {
      return fn();
    } catch {
      return fallback;   // 관측은 예약 결과를 바꾸지 않는다.
    }
  }

  /** 스탬핑만 하고 예외는 전파한다. 현재 격리되지 않은 4개 지점용. */
  private emitTrace(
    code: TraceCode, severity: TraceSeverity, message: string,
    attributes: TraceAttributes,
  ): void {
    this.deps.trace?.(code, severity, message, {
      serverAt: this.ctx.serverAt(),
      state: this.ctx.state(),
      attributes,
    });
  }

  /** 스탬핑 + 예외 격리. 현재 try/catch로 감싸인 6개 지점용. */
  private safeTrace(
    code: TraceCode, severity: TraceSeverity, message: string,
    attributes: TraceAttributes,
  ): void {
    this.safeCall(() => this.emitTrace(code, severity, message, attributes), undefined);
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

### ③ 핫패스 성능은 중립이다 — 단 "루프 안에 관측이 없다"는 아니다

지켜야 할 불변식은 **"매 반복 경로에 관측이 없다"** 이다. 루프 안에
관측 호출 자체는 있다([10-analysis.md](../10-analysis.md) §3).

- `applyPendingEmptyExit` → `traceAvailabilityEmptyExit` — `empty_exit`
  wake 신호가 대기 중일 때만, 사이클당 최대 1회
- `traceCycle("EMPTY_EARLY_EXIT")` — 조기 종료 확정 시에만, 사이클당 최대 1회

둘 다 실행 직후 `break` 하거나 `return` 하므로 반복 비용에 누적되지 않는다.

이 구분을 `runToggleCycle`에 주석으로 못박는다. "루프 안에 관측 금지"로
적으면 기존 코드와 모순돼 주석이 무시되므로, **"반복 경로에 관측 금지,
종료 직전 1회는 허용"** 으로 적는다.

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
3. **관측 실패 격리 테스트 추가** — `diagnostics.breadcrumb`,
   `diagnostics.failure`, `captureSnapshot`, `capturePreparationContext`가
   각각 던져도 실행 결과(terminal state·message)가 바뀌지 않음을 확인한다.
4. **비격리 보존 테스트 추가** — `deps.emit`과 전파하는 `trace` 4곳이
   던지면 현재와 동일하게 예외가 `start()` 밖으로 전파됨을 고정한다.
   실수로 삼키게 되는 회귀를 막는다.
5. **호출 순서 테스트 추가** — `failureData()`에서 `captureSnapshot` →
   `diagnostics.failure` 순서와 상호 독립성을 고정한다.
6. `git diff --check` 통과.
7. Chrome 수동 로드 dry-run 1회.
8. **주장 대조** — 이 문서가 코드에 대해 주장하지만 테스트로 고정되지
   않는 두 가지를 diff에서 직접 확인한다.
   - (a) 제어 복원력 `catch` 11개(271·435·472·479·725·730·869·913·
     1035·1173·1377)가 변경되지 않았을 것
   - (b) `runToggleCycle` 스캔 루프의 **매 반복 경로**에 observer 호출이
     추가되지 않았을 것. 기존의 조건부 1회 호출
     (`traceAvailabilityEmptyExit`, `traceCycle("EMPTY_EARLY_EXIT")`)은
     그대로 두며, 이들이 실행 직후 루프를 벗어나는 구조도 유지할 것

2~5는 이 단계에서 새로 추가하는 테스트이며, 추출 **이전에** 현재
동작을 고정하는 용도로 먼저 작성한다(실패 테스트 우선). 8은 리뷰
시점의 확인 항목이며, "문서와 코드를 대조하라"는 일반 지침이 아니라
**대조 대상을 행 번호로 지정**한 것이다.

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
관측 전용 인라인 catch          9 → 0   (호출부에서 사라짐)
  └ 관측 계층 독립 경계             5     (safeCall 헬퍼 1개를 5곳에서 사용)
제어 복원력 catch             11 → 11  (불변)
혼합 catch                     2 → 2 (불변)  ← 아래 참조
```

경계가 1개가 아닌 이유는 `trace`·`breadcrumb`·페이지 컨텍스트 캡처·
snapshot·`diagnostics.failure`의 fallback 값이 각각 다르기 때문이다
(위 "실패 의미를 각각 정의한다" 표).

**혼합 `catch` 2개는 쪼개지 못한다.** 코드 자체는 제어(세션)와 관측
(`RunObserver`)으로 나뉘지만 **예외 경계는 하나로 남는다.**
`onAvailabilityBody`의 catch는 trace 실패 시 뒤따르는 late DOM 비교까지
함께 건너뛰는데, 두 개로 쪼개면 그 건너뜀이 사라져 동작이 바뀐다.
따라서 이 단계에서는 경계를 유지하고, 그 이중 역할을 주석으로 명시하는
데까지만 한다.

후속 단계(`03` 핫패스 전략 추출)의 대상이 1,630줄에서 약 1,050줄로 줄어든다.
