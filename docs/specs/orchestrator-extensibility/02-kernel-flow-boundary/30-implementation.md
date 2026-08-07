# 02 커널·흐름 경계 — 구현

**상태:** 완료
**설계:** [20-design.md](20-design.md)

## 커밋 순서

| # | 커밋 | 내용 |
|---|---|---|
| 1 | `a25b8ad` | 설계, 착수 전 재평가, HANDOFF 갱신 |
| 2 | `c56a52f` | 생명주기 순서 특성화 테스트 (**추출 전**) |
| 3 | `3d00853` | `RunKernel`·`RunSession` 분리 |

2번을 3번보다 먼저 넣은 것이 이 단계의 핵심 절차다. 추출 후에 테스트를
쓰면 추출 결과를 정답으로 삼게 된다.

## 계층

```
orchestrator.ts  1,198 → 1,287줄
├─ RunFlowHooks   흐름이 커널에 끼우는 세 지점 (start / steps / cleanup)
├─ RunKernel        334줄   생명주기 봉투 · 안전 계약 · 공용 준비
└─ RunSession       719줄   오픈런 흐름 (RunFlowHooks 구현)
```

줄 수가 89줄 는 것은 인터페이스 선언, 훅 세 개, 커널 별칭을 잡는 생성자,
그리고 계약을 적은 주석 때문이다. 흐름 본문은 줄지 않았다 — 03의 대상이다.

## 커널이 소유하는 것

- `OneShotAuthorizationHandle`과 폐기 시점. 흐름에는 `takePin()`만 위임하므로
  흐름은 `dispose()`를 부를 수 없다.
- `execute(flow)` — `try`/`catch`/`finally` 봉투. `catch`의 `TERMINAL` 가드와
  `finally`의 순서가 여기 있다.
- terminal API: `transition`·`finish`·`finishStopped`·`handOff`·
  `diagnosticHandOff`·`timedOut`·`stopOrTimeout`
- `RunStateMachine`·`MonotonicEpochClock`·`RunObserver`·기준시계
- 공용 준비: `validate`·`syncInitialClock`·`prepareEntry`·`prepareDate`·
  `preparePerson`·`markExecuting`

## 흐름이 소유하는 것

`confirmPageReady`·`waitForOpen`·`searchAndReserve`·`runToggleCycle`·
`advanceFromSlot`·`waitForSlotTransition`·`advancePostSlot`·
`onAvailabilityBody`·`correlateDomCandidate`와 오픈런 전용 상태 8개
(`adjacentDate`·`toggleCycle`·`adjacentTiming`·`targetTiming`·`watchLive`·
`lastArrivalAt`·`availabilityCorrelation`·`availabilityWake`).

## 결합 5건 처리 결과

[20-design §문제](20-design.md#문제)의 표에 대응한다.

| # | 처리 |
|---|---|
| 1 | `availabilityWake.reset()`이 커널 `finally`에서 `flow.cleanup()` 안으로 이동 |
| 2 | `slotWatch.start` 콜백이 `flow.start()`로 이동. `watchLive`·`lastArrivalAt`을 흐름만 쓴다 |
| 3 | 흐름은 `this.kernel.takePin()`만 호출한다. 핸들 참조가 흐름에 없다 |
| 4 | 그대로 뒀다. 의도된 방향이며 `this.kernel.` 접두사로 소유권이 호출부마다 보인다 |
| 5 | `confirmPageReady`가 흐름의 `steps()` 첫 단계로 이동. `PREPARING_PAGE` 전이와 순서는 그대로 |

## 보존한 것

- **실행 순서.** `flow.start()` → `CONFIGURED` → 공용 준비 → `flow.steps()`
  → `finishStopped()`. `markExecuting()`은 커널 몫이지만 `confirmPageReady`
  뒤라는 자리를 지키려고 흐름의 `steps()` 안에서 호출한다.
- **cleanup 순서.** PIN 폐기 → `flow.cleanup()`(shadow stop → wake reset →
  slotWatch stop → mutationWatch stop) → 기준시계 정지 → 동결 샘플 trace →
  비동기 flush.
- **예외 모양.** `availabilityWake.reset()`과 `slotWatch.stop()`은 여전히
  `try`로 감싸지 않는다. 둘 중 하나가 던지면 이후 cleanup과 flush가 실행되지
  않고 예외가 `execute()` 밖으로 나간다. 개선이 아니라 보존 대상이며
  `tests/kernel-lifecycle.test.mjs` 3번이 이를 고정한다.
- 이벤트 payload·trace attribute·타이밍 상수. 흐름 본문은 커널 호출
  재작성 외에 손대지 않았다.

## 되돌린 설계 결정

커널을 `src/content/kernel/run-kernel.ts`로 빼려던 초안을 철회했다. 근거는
[20-design §왜 별도 파일로 빼지 않는가](20-design.md#왜-별도-파일로-빼지-않는가)에
있다. 요지는 `tests/build-regression.test.mjs`가 `dist/content/orchestrator.js`의
소스 텍스트를 읽는다는 것이고, 이 단계에 필요한 것은 클래스 경계이지 파일
경계가 아니라는 것이다.

## 방법 메모

흐름 본문 719줄을 손으로 옮기지 않았다. 원본 줄 구간을 잘라 재조립하는
일회용 스크립트를 썼고, 커널 호출만 정규식으로 `this.kernel.`을 붙였다.
손 편집이었다면 조용한 누락이 생겼을 구간이다.

그 과정에서 구간 자르기 특유의 실수를 두 번 했다.

1. `advancePostSlot` 구간이 클래스 닫는 괄호를 한 줄 더 먹었다.
2. `applyReferenceClockEstimate` 구간이 다음 메서드의 jsdoc을 반토막 내
   블록 주석이 닫히지 않았다. `tsc`는 이걸 **541번 줄의 클래스 선언 오류**로
   보고했다 — 실제 원인보다 40줄 아래다.

2번 때문에 스크립트에 구간별 블록 주석 균형 검사를 넣었다. 같은 실수가
다음에 나면 엉뚱한 줄이 아니라 구간 이름으로 실패한다.
