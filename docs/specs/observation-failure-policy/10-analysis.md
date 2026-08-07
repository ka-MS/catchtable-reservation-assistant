# 관측 실패 정책 — 분석

**상태:** 확정
**측정일:** 2026-08-07
**측정 기준:** `main` @ `13027bf`
**출처 이슈:** [#20](https://github.com/ka-MS/catchtable-reservation-assistant/issues/20)
**선행 패키지:** [오케스트레이터 확장성 기반](../orchestrator-extensibility/00-index.md) (SP-025)

## 문제

`RunObserver`의 예외 격리가 **호출 지점마다 다르다.** 관측 실패가 예약
실행을 종료시킬 수 있고, 어느 지점이 그런지에 대한 근거가 없다.

SP-025/01에서 관측을 제어와 분리하며 발견했다. 01은 동작 무변경 범위였고
격리 통일은 판단이 필요한 사안이라 이 패키지로 분리했다.

## 현재 동작

`tests/orchestrator-observation.test.mjs`와
`tests/observation-run-observer.test.mjs`가 고정하고 있는 값이다.

| 관측 | 실패 시 | 결과 |
|---|---|---|
| `preparation` | 삼킴 | 영향 없음 |
| `wakeResult` | 삼킴 | 영향 없음 |
| `emptyExit` | 삼킴 | 영향 없음 |
| `clockSamples` | 표본별 삼킴 | 영향 없음 |
| **`toggleCycle`** | **전파** | 실행이 `FAILED`로 종결 |
| **`slotClicked`** | **전파** | 실행이 `FAILED`로 종결 |
| **`runFailed`** | **전파** | `execute()`의 catch 안에서 던져 `start()`가 reject |
| **`availabilityDom`** | **전파** | 호출자 catch가 흡수 |
| **`availabilityBody`** | **전파** | 호출자 catch가 흡수. **뒤따르는 late DOM 비교가 건너뛰어진다** |
| **`event`** (`deps.emit`) | **전파** | `RunResult` 미반환 |

### `event`가 가장 나쁘다

`deps.emit`이 던지면 다음 순서로 번진다.

1. 호출한 `transition()`이 던짐
2. `execute()`의 catch가 `FAILED` 전이를 시도 → 그 전이가 다시 `event()` 호출 → 또 던짐
3. `start()`가 reject되고 **`RunResult`가 반환되지 않음**
4. `content/index.ts:210`의 `.then()`이 실행되지 않아 **`ATTEMPT_FINISHED` 미전달**
5. `RunSupervisor`의 logical run이 종결되지 않고 `GET_ATTEMPT_STATUS` reconcile이나 탭 종료까지 남음

관측 실패가 **제어 평면의 종결 보고까지** 막는다.

## 비대칭의 성격

**의도된 설계가 아니다.** 각 지점이 왜 다른지 설명할 수 있는 근거가
코드·문서·이력 어디에도 없다. 기능이 추가될 때마다 개별적으로 `try/catch`를
넣거나 넣지 않은 결과다.

SP-025/01이 이 비대칭을 `send()`(전파) / `sendSafe()`(격리) 구분으로
코드에 명시했다. 그전에는 `try/catch` 유무를 읽어야만 알 수 있었다.

## 도달 가능성 — 낮다

과장하지 않기 위해 프로덕션 배선을 확인했다.

- `PortTraceTransport.send`는 `try/catch`로 보호된다 (`port-transport.ts:13`)
- `dispatchRunEvent`는 동기 throw까지 명시적으로 처리한다 (`dispatch.ts`)
- 남는 표면은 `TraceLogger.record()`의 `redact`·`cleanAttributes`와
  `BatchTraceProcessor.record()`의 큐 조작·`schedule()` 정도다

**지금 당장 터지는 문제는 아니다.** 다만 그 안전성이 **계약이 아니라
우연**이다. `Dependencies`의 관측 포트는 인터페이스로 주입되는데 "던지지
않는다"는 계약이 어디에도 없다. 진단·telemetry 구현을 바꿀 때 전제가
깨져도 알 수 없고, 깨지면 예약 오픈 순간에 실행이 죽는다.

## 진짜 공백은 격리가 아니라 관측성이다

이슈 본문은 "삼킬 것인가"만 물었다. 다시 보니 그것보다 중요한 문제가 있다.

**지금은 삼킨 6곳에서 실패가 나도 아무도 모른다.** 로그도 카운터도 없다.
진단 파이프라인이 죽은 채로 실행이 끝나고, 사용자는 trace CSV가 비어 있는
이유를 알 수 없다.

이 코드베이스는 "실측 근거 없이 추측 구현하지 않는다"를 제품 원칙으로
삼는다(`AGENTS.md`). 증거를 조용히 잃는 것은 실행이 죽는 것만큼 나쁘다.

### 이미 있는 선례

`BatchTraceProcessor`는 큐 초과로 버린 event 수를 세어 다음 event의
attribute에 싣는다.

```ts
// batch-processor.ts:53
if (this.droppedCount > 0) event.attributes.droppedTraceCount = this.droppedCount;
```

관측 실패도 같은 방식으로 드러낼 수 있다.

## 결정할 것

세 축이며 서로 독립이다.

| | 질문 |
|---|---|
| A | 관측 실패 시 실행을 계속하는가 |
| B | 삼켰다면 그 사실을 어떻게 아는가 |
| C | `event`(`deps.emit`)를 `trace`와 다르게 다루는가 |

이슈 본문의 선택지 3개("전부 격리 / 관측만 격리하고 emit은 유지 / 현행
유지")는 A와 C를 섞어 놓은 것이라 그대로 쓰지 않는다.

## 범위 밖

- `TraceLogger`·`BatchTraceProcessor`·`DiagnosticRecorder` 내부의 예외 처리.
  이 패키지는 `RunObserver` 경계만 다룬다.
- 관측 실패 시 재시도. 삼키거나 전파하거나 둘 중 하나다.
- Background(`RunSupervisor`) 쪽 관측 경로.

## 관련 문서

- 설계: [20-design.md](20-design.md)
- 비대칭이 드러난 경위: [SP-025/01 구현](../orchestrator-extensibility/01-observation-split/30-implementation.md)
- 현재 동작 고정: `tests/observation-run-observer.test.mjs`
