# 02 커널·흐름 경계 — 설계

**상태:** 승인 대기
**선행:** [01 관측 분리](../01-observation-split/40-verification.md) 완료·병합
**패키지:** [00-index](../00-index.md)

## 착수 전 재평가

[00-index §재평가 지점](../00-index.md#재평가-지점)이 요구하는 네 판단이다.

| 판단 | 결과 |
|---|---|
| 02의 전제가 유지되는가 | **유지된다.** 01은 제어와 **관측**을 갈랐고, 제어 안의 **커널과 흐름**은 건드리지 않았다 |
| 01이 예상보다 많은 것을 해결했는가 | **아니다.** 아래 결합 5건은 01 이후에도 전부 남아 있다 |
| 04 진입 조건 2번이 확보됐는가 | **미확보.** 02와 무관하다 |
| HANDOFF에 blocking backlog가 있는가 | **없다.** [#20](https://github.com/ka-MS/catchtable-reservation-assistant/issues/20)은 SP-026으로 해소 |

### 기준선 줄 수

`orchestrator.ts`는 현재 **1,198줄**이다. 01의 산출물은 1,190줄이고
([01/40-verification](../01-observation-split/40-verification.md)),
그 뒤 SP-026이 관측 실패 카운트 주석과 분기로 8줄을 더했다. 두 숫자는
어긋난 것이 아니라 서로 다른 시점의 값이다. **02의 기준선은 1,198줄이다.**

## 문제

새 예약 흐름을 추가할 때 `execute()`를 복제하게 된다. 그 안에 안전
계약이 들어 있으므로, 복제는 곧 **PIN 폐기 순서·terminal 단정 금지·
cleanup 순서를 새 흐름이 다시 구현한다**는 뜻이다. 한 곳에서 고친 순서가
다른 곳에 반영되지 않는 것이 이 패키지가 막으려는 사고다.

측정한 결합은 다음 5건이다. 모두 현재 코드의 실제 줄이다.

| # | 결합 | 위치 | 방향 |
|---|---|---|---|
| 1 | 커널 cleanup이 흐름 소유 객체를 만진다 | `execute()` `finally` → `this.availabilityWake.reset()` (351) | 커널 → 흐름 |
| 2 | 커널 startup이 흐름 상태를 쓴다 | `execute()` `slotWatch.start` 콜백 → `watchLive`·`lastArrivalAt` (320–321) | 커널 → 흐름 |
| 3 | 흐름이 PIN 핸들을 직접 만진다 | `advancePostSlot` → `this.authorizationHandle.takePin()` (1103) | 흐름 → 커널 |
| 4 | 흐름이 terminal API를 42회 호출한다 | 595–1158 구간 | 흐름 → 커널 |
| 5 | 흐름 전용 판정이 공용 준비 사슬에 있다 | `confirmPageReady` → `adjacentDate` 요구 (595–603) | 혼재 |

4번 내역: `diagnosticHandOff` 13, `transition` 12, `timedOut` 6,
`finishStopped` 5, `finish` 3, `stopOrTimeout` 3, `handOff` 2.

1·2번이 핵심이다. **커널이 흐름을 아는 방향**의 결합이라, 두 번째 흐름이
생기면 커널 안에 흐름 분기가 들어간다.

## 결정: `confirmPageReady`는 흐름으로 간다

[00-index §재평가 지점](../00-index.md#재평가-지점)이 02에 미룬 미결
항목이다.

`confirmPageReady`는 인접 가용 날짜(`setup.adjacentDate`)가 없으면
`HANDED_OFF`로 끝낸다. 인접 날짜는 **날짜 토글로 슬롯을 갱신하기 위한
왕복 대상**이며(`runToggleCycle`, 670), 오픈런 외의 흐름에는 그런 왕복이
없다. 웨이팅·줄서기에 이 판정을 그대로 적용하면 근거 없이 실패한다.

따라서 준비 단계에 남기지 않고 흐름으로 옮긴다. 단계 순서와
`PREPARING_PAGE` 전이는 그대로 둔다.

`prepareEntry`·`prepareDate`·`preparePerson`은 커널에 남긴다. 예약창
진입·날짜·인원은 흐름과 무관하게 필요하고, `entryMode !== "auto"`면 셋 다
건너뛰는 동작도 흐름과 무관하다.

## 설계

### 경계

`RunSession`을 둘로 가른다.

```
RunKernel   (신규 src/content/kernel/run-kernel.ts)
  생명주기 봉투 · 안전 계약 · 상태 머신 · 시계 · 관측 · 공용 준비
RunSession  (orchestrator.ts에 잔류)
  오픈런 흐름 — confirmPageReady · waitForOpen · searchAndReserve · 핫패스
```

이름을 `RunSession` 그대로 두는 이유는 03이 여기서 핫패스를 다시 떼어내기
때문이다. 02에서 `OpenRunFlow`로 개명하면 03에서 또 바뀐다.

### 커널이 소유하는 것

- `OneShotAuthorizationHandle`과 그 폐기 시점
- `execute()`의 `try`/`catch`/`finally` 봉투 — terminal 단정 금지
  (`if (!TERMINAL.has(...))`)와 cleanup 순서
- terminal API: `transition`·`finish`·`finishStopped`·`handOff`·
  `diagnosticHandOff`·`timedOut`·`stopOrTimeout`
- `RunStateMachine`·`MonotonicEpochClock`·`RunObserver`
- 공용 준비: `validate`·`syncInitialClock`·`prepareEntry`·`prepareDate`·
  `preparePerson`·`markExecuting`과 `stepReporter`·`resolvePreparation`·
  `stepOptions`
- 기준시계: `stopReferenceClock`·`traceFrozenReferenceClockSamples`·
  `applyReferenceClockEstimate`·`wallOffsetMs`

### 결합 5건을 어떻게 끊는가

**1·2번 — 흐름 훅.** 커널은 흐름 객체를 알지 못하고, 두 개의 무인자 훅만
받는다.

```ts
interface RunFlowHooks {
  start(): void;                                  // CONFIGURED 전이 직전
  steps(): Promise<RunResult | null>;             // 공용 준비 뒤
  cleanup(): void;                                // PIN 폐기 직후
}
```

`start`는 shadow·slotWatch 기동을, `cleanup`은 그 원복을 가져간다. 흐름
상태(`watchLive`·`lastArrivalAt`·`availabilityWake`)는 흐름 안에서만
읽고 쓴다.

**3번 — PIN은 위임한다.** 커널이 `takePin(): string | undefined`를 노출하고
핸들 자체는 절대 넘기지 않는다. 흐름은 `kernel.takePin()`만 호출하므로
`dispose()`를 부를 방법이 없다.

**4번 — 그대로 둔다.** 흐름이 커널의 terminal API를 호출하는 것은 결합이
아니라 **의도된 방향**이다. 흐름이 스스로 종료 상태를 만들지 않고 커널에
요청하는 구조가 목표다. 42회 호출은 줄일 대상이 아니다.

**5번 — 위 결정대로 이동한다.**

### 실행 순서

현재 `execute()`의 순서를 한 칸도 바꾸지 않는다. 커널이 봉투를 소유하고,
흐름 몫만 훅으로 빠진다.

```
[커널] try
[흐름]   flow.start()                       ← 현재 313–322
[커널]   transition("CONFIGURED")           ← 현재 323
[커널]   validate() ?? syncInitialClock()
         ?? prepareEntry() ?? prepareDate() ?? preparePerson()
[흐름]   ?? await flow.steps()              ← confirmPageReady 부터
[커널]   ?? finishStopped()
[커널] catch  → TERMINAL 아닐 때만 FAILED
[커널] finally
[커널]   authorizationHandle.dispose()      ← 현재 345. 최우선 유지
[흐름]   flow.cleanup()                     ← 현재 346–357을 순서 그대로
[커널]   stopReferenceClock("terminal")
[커널]   traceFrozenReferenceClockSamples()
[커널]   await Promise.allSettled([flush])
```

`markExecuting()`은 커널 몫이지만 현재 `confirmPageReady` **뒤**에 있다.
순서를 지키기 위해 흐름 사슬 안에서 `kernel.markExecuting()`으로 호출한다.
자리를 옮기지 않는다.

`flow.cleanup()` 내부는 현재 346–357의 네 동작을 순서·`try`/`catch` 모양
그대로 옮긴다: `availabilityShadow.stop()`(try) → `availabilityWake.reset()`
→ `slotWatch.stop()` → `slotDomMutationWatch.stop()`(try).

## 성공 기준

[00-index §성공 기준](../00-index.md#성공-기준)의 1·3·4·5에 더해, 이
단계에 필요한 추가 검증은 다음이다.

6. **생명주기 순서 고정 테스트를 추출 전에 작성한다.** 이 단계의 위험은
   payload가 아니라 **순서**이며, 기존 스위트는 startup·cleanup 순서를
   고정하지 않는다. `tests/kernel-lifecycle.test.mjs`를 새로 만들어 한 번의
   실행에서 일어나는 호출을 시간순 배열로 기록하고 `deepStrictEqual`로
   못 박는다. 대상은 shadow start/stop, slotWatch start/stop,
   mutationWatch start/stop, PIN dispose, flush 두 건, 그리고 이들 사이의
   상대 순서다.
7. **PIN 폐기가 흐름 예외보다 먼저임을 증명한다.** `flow.cleanup()`이
   던지도록 만든 뒤에도 `dispose()`가 이미 호출됐고 terminal 결과가
   바뀌지 않음을 단언한다. 현재 주석(343–344)이 말하는 계약을 기계로
   고정하는 것이다.
8. **기대값은 추출 전 실행으로 덤프해 붙여넣는다.** 손으로 적지 않는다
   (01에서 이 방법으로 예측 누락을 잡았다).

## 하지 않는 것

- **흐름 인터페이스를 일반화하지 않는다.** `RunFlowHooks`는 오픈런
  하나만을 위한 구체 타입이며, 커널이 흐름에 넘기는 컨텍스트를 정의하지
  않는다. 그 모양을 지금 정하면 두 번째 흐름에서 다시 뜯게 된다
  ([00-index §03과 04를 나눈 이유](../00-index.md#03과-04를-나눈-이유)).
- **핫패스를 옮기지 않는다.** `runToggleCycle`·`advanceFromSlot`·
  `advancePostSlot`과 흐름 상태 8개는 `RunSession`에 그대로 둔다. 03의
  대상이다.
- 이벤트 payload·trace attribute·타이밍 상수 변경. 한 글자도 바꾸지 않는다.
- 테스트 수정. 기존 테스트를 고쳐야 통과한다면 경계를 잘못 그은 것이므로
  중단하고 보고한다([00-index §중단 조건](../00-index.md#중단-조건)).

## 03에 남기는 것

02가 끝나면 `RunSession`은 오픈런 흐름만 남는다. 03의 대상은 그 안에서
핫패스와 흐름 상태 8개를 다시 떼어내는 일이며, **정확한 범위는 02 완료
후 재측정으로 확정한다.** 02가 `confirmPageReady`와 흐름 훅을 정리하고
나면 03이 옮길 상태의 경계가 지금보다 좁아진다.
