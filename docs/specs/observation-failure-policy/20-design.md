# 관측 실패 정책 — 설계

**상태:** 승인됨
**작성일:** 2026-08-07
**부모 문서:** [10-analysis.md](10-analysis.md)
**출처 이슈:** [#20](https://github.com/ka-MS/catchtable-reservation-assistant/issues/20)

## 계약

> **관측은 예약 실행을 중단시키지 않는다. 대신 실패를 셈해 드러낸다.**

`RunObserver`의 모든 메서드는 예외를 밖으로 내보내지 않는다. 이는 이제
**계약**이며, 지점별로 다르지 않다.

## 결정

### A. 전부 격리한다

관측은 정의상 부수적이다. 예약 오픈 순간에 `DATE_TOGGLE_CYCLE` trace 하나가
던져서 슬롯을 놓치는 것은 어떤 시나리오로도 정당화되지 않는다.

이슈에 적었던 반대 논리("trace exporter가 OOM으로 던진다면 조용히 계속
가는 쪽이 더 위험할 수도")는 채택하지 않는다. **OOM이면 다른 경로에서도
죽는다.** trace에 장애 감지 센서 역할을 맡기려면 의도적으로 설계해야지,
우연히 감싸지 않은 지점을 근거로 삼을 수 없다.

### B. 삼키되 반드시 드러낸다

`catch {}`만으로는 진단 파이프라인이 죽은 것을 아무도 모른다.

`RunObserver`가 삼킨 횟수를 세고, terminal 상태 전이 event에
`observationFailureCount`로 싣는다. `BatchTraceProcessor.droppedTraceCount`와
같은 방식이다.

- 실패가 0이면 attribute를 넣지 않는다(기존 payload 무변화)
- 실패가 있으면 terminal event와 trace CSV에 드러난다

### C. `event`(`deps.emit`)도 격리한다

`emit` 실패가 최악인 이유는 삼키지 않아서가 아니라 **종결 보고까지 막기
때문**이다. 격리하면 최소한 `RunResult`가 반환되고 `ATTEMPT_FINISHED`가
전달돼 logical run이 정상 종결한다.

**관측이 깨진 채로 예약이 성공하는 것이 옳은 우선순위다.**

다만 `emit`이 죽으면 Side Panel이 빈 채로 실행이 돈다. 그래서 B가 더
중요해진다 — 최소한 terminal event 하나는 나가야 하는데, 그것도 `emit`을
쓴다. `emit`이 계속 던지면 카운트도 전달되지 않는다(§한계 참조).

### 버린 선택지: 현행 유지 + 문서화

비대칭을 의도된 것으로 인정하려면 각 지점이 왜 다른지 설명할 수 있어야
하는데, 그 근거가 없다([10-analysis](10-analysis.md) §비대칭의 성격).
정당화할 수 없는 비대칭을 문서로 굳히면 그 문서가 곧 부채가 된다.

## 구현

### `RunObserver`

```ts
private failureCount = 0;

private safeCall<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    this.failureCount += 1;
    return fallback;
  }
}

/** 삼킨 관측 실패 횟수. terminal event가 읽는다. */
observationFailures(): number {
  return this.failureCount;
}
```

`send()`를 제거하고 모든 전송을 `sendSafe()` 경로로 통일한다.

| 메서드 | 이전 | 이후 |
|---|---|---|
| `preparation`, `wakeResult`, `emptyExit`, `clockSamples` | 격리 | 격리 (변화 없음) |
| `toggleCycle`, `slotClicked`, `runFailed` | **전파** | **격리** |
| `availabilityBody`, `availabilityDom` | **전파** | **격리** |
| `event` | **전파** | **격리** |

### `availabilityBody`의 부수 효과

호출자(`onAvailabilityBody`)의 `try/catch`는 현재 trace 실패 시 **뒤따르는
late DOM 비교까지 함께 건너뛴다.** 관측을 독립 격리하면 그 건너뜀이
사라지고 late DOM 비교가 계속 실행된다.

**의도된 변경이다.** 두 관측은 서로 독립이며, 하나가 실패했다고 다른
하나를 버릴 이유가 없다.

호출자의 `try/catch`는 그대로 둔다 — 비신뢰 bridge payload로부터 **제어**
(`correlateBody`, `wake.offer`)를 보호하는 것이 그 catch의 원래 목적이다.

### `event`의 격리 범위

```ts
event(kind, message, data?): void {
  this.safeCall(() => {
    const at = this.ctx.now();
    this.deps.emit({ at, serverAt: this.ctx.serverAt(), runId: this.runId, kind, message, data });
  }, undefined);
  if (kind === "action") {
    this.safeCall(() => this.deps.diagnostics?.breadcrumb(...), undefined);
  }
}
```

`emit`과 breadcrumb을 **별도 경계**로 둔다. `emit`이 실패해도 breadcrumb은
시도되어야 한다 — 서로 다른 저장 경로다.

### terminal event에 싣기

`RunSession.transition()`이 terminal 상태일 때만 붙인다.

```ts
const failures = this.observe.observationFailures();
this.observe.event("state", reason, {
  state,
  ...(TERMINAL.has(state) && failures > 0 ? { observationFailureCount: failures } : {}),
  ...extra.data,
});
```

실패가 0이면 attribute가 없다 — 기존 payload가 바뀌지 않는다.

## 한계 — 해결하지 않는다

### 1. `finally` 단계의 실패는 집계되지 않는다

`clockSamples()`는 `execute()`의 `finally`에서 terminal 전이 **뒤에**
호출된다. 그 시점의 실패는 이미 나간 terminal event에 반영될 수 없다.

새 trace code를 추가해 마지막에 한 번 더 내보내는 방법이 있으나, `TraceCode`
union과 CSV 열이 늘어나고 그 trace 자체도 실패할 수 있다. 비용 대비 이득이
낮다고 판단해 하지 않는다.

집계되는 범위: **run 시작부터 terminal 전이까지**의 관측 실패.

### 2. `emit`이 지속적으로 실패하면 카운트도 전달되지 않는다

카운트는 terminal event를 통해 나가고, 그 event 역시 `emit`을 쓴다.
`emit`이 계속 던지면 카운트도 사라진다.

이 경우에도 **예약 실행 자체는 정상 종결**한다(C의 목적). 진단이 전무한
상태가 되지만, 그건 `emit`이 죽었다는 사실 자체가 원인이다. 별도 채널을
만드는 것은 이 패키지 범위 밖이다.

### 3. 관측 실패의 원인은 남지 않는다

카운트만 세고 예외 메시지·스택은 버린다. 어느 메서드에서 몇 번 실패했는지도
구분하지 않는다. 원인 추적이 필요해지면 그때 확장한다 — 지금은 "실패가
있었다"를 아는 것이 먼저다.

## 검증

### ⚠️ 테스트 수정 신호가 SP-025/01과 반대다

| | 기존 테스트를 고쳐야 한다면 |
|---|---|
| SP-025/01 (동작 무변경) | 경계를 잘못 그었다는 신호. 설계 재검토 |
| **이 패키지 (동작 변경)** | **의도된 변경. 고치는 것이 맞다** |

뒤집히는 테스트는 미리 열거한다. 이 목록에 없는 테스트가 깨지면 그것은
의도하지 않은 회귀다.

**`tests/observation-run-observer.test.mjs`**

- `availabilityDom(): trace가 던지면 전파한다`
- `toggleCycle(): trace가 던지면 전파한다`
- `slotClicked(): trace가 던지면 전파한다`
- `runFailed(): trace가 던지면 전파한다`
- `event(): deps.emit이 던지면 전파한다`

**`tests/orchestrator-observation.test.mjs`**

- `deps.emit이 던지면 예외가 start() 밖으로 전파된다`
- `격리되지 않은 trace 지점(DATE_TOGGLE_CYCLE)이 던지면 실행이 FAILED로 죽는다`
- `격리되지 않은 trace 지점(SLOT_CLICKED)이 던지면 실행이 FAILED로 죽는다`
- `모든 trace가 던지면 FAILED 전이의 RUN_FAILED도 던져 start()가 reject된다`
- `captureSnapshot이 던지면 snapshot 필드 없이 진단 id만 payload에 남는다`
  ← **초안 목록에서 빠졌던 항목**

### 초안 예측이 불완전했다

위 마지막 항목은 실행해보고 나서야 드러났다. 초안은 **A(격리)의 효과만**
열거하고 **B(카운터)의 payload 효과**를 빠뜨렸다. `captureSnapshot` 실패도
관측 실패로 집계되므로 terminal payload에 `observationFailureCount`가 붙는다.

의도한 동작이며 회귀가 아니다. 다만 "목록에 없는 테스트가 깨지면 의도하지
않은 회귀"라는 규칙을 세워놓고 목록을 A 기준으로만 만든 것은 예측 실패다.
**변경이 여러 축을 건드리면 축마다 영향 목록을 따로 만들어야 한다.**

### 성공 기준

1. 위 9개를 **새 계약으로 뒤집어** 통과한다. 그 외 기존 테스트는 무수정.
2. `RunObserver`의 모든 공개 메서드가 `serverAt`·`state`·`trace`·`emit`
   실패에서 던지지 않음을 확인한다.
3. `observationFailureCount`가 실패 0일 때 payload에 없고, 실패가 있을 때
   terminal event에 실린다.
4. `availabilityBody`의 trace가 실패해도 late DOM 비교가 실행됨을 확인한다.
5. `npm run check` 통과.
6. `git diff --check` 통과.
7. **주장 대조** — 이 문서가 주장하지만 테스트로 고정되지 않는 것을
   diff에서 직접 확인한다.
   - (a) 제어 복원력 `catch` 11개가 변경되지 않았을 것
   - (b) `onAvailabilityBody`·`correlateDomCandidate`의 `try/catch`가
     제거되지 않았을 것 (제어 보호 목적이므로 유지)
   - (c) `failureCount` 증가가 스캔 루프의 매 반복 경로에 들어가지 않았을 것

기준 7은 SP-025/01의 교훈을 따른다 — 다만 이번에는 **개수가 아니라
경계의 범위와 위치**를 본다
([99-agent-process-notes](../orchestrator-extensibility/99-agent-process-notes.md) §3).

## 검증 결과

```
npm run check          618/618 통과
git diff --check       통과

주장 대조
  (a) 제어 복원력 catch      11/11 유지 (orchestrator.ts 빈 catch 13개 불변)
  (b) onAvailabilityBody     catch 1개 유지
      correlateDomCandidate  catch 1개 유지
  (c) 스캔 루프 매 반복 카운터 참조   0건
```

성공 기준 1~3, 5~7 충족. **기준 4는 직접 검증하지 못했다** — 아래 참조.

### 미검증: 기준 4 (late DOM 비교 계속 실행)

`lateDomCorrelation`은 DOM 상관관계가 먼저 잡힌 뒤 같은 cycle의 body가
도착해야 생성된다(`availability-correlation.ts:134`). dry-run 하네스에서
그 순서를 만들려면 shadow 배선과 타이밍 제어가 필요해 비용이 크다.

**구조적으로는 성립한다.** `availabilityBody()`가 더 이상 던지지 않음이
테스트로 고정돼 있으므로(`observation-run-observer.test.mjs`), 호출자의
catch가 이 경로로 진입할 수 없고 따라서 뒤따르는 late DOM 분기는 항상
실행된다.

직접 확인하지 않았다는 사실을 남긴다. shadow 시나리오 테스트가 생기면
그때 덮는다.
