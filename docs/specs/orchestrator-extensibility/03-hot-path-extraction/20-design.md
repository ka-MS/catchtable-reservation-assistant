# 03 핫패스 전략 추출 — 설계

**상태:** 승인 대기
**선행:** [02 커널·흐름 경계](../02-kernel-flow-boundary/40-verification.md) 완료·병합
**패키지:** [00-index](../00-index.md)

## 착수 전 재평가

[00-index §재평가 지점](../00-index.md#재평가-지점)이 요구하는 네 판단이다.

| 판단 | 결과 |
|---|---|
| 03의 전제가 유지되는가 | **유지된다.** 핫패스와 흐름 상태 8개가 `RunSession` 안에 그대로 있다 |
| 02가 예상보다 많은 것을 해결했는가 | **부분적으로.** 아래 참조 |
| 04 진입 조건 2번이 확보됐는가 | **미확보.** 두 번째 흐름의 실측 근거 없음 |
| HANDOFF에 blocking backlog가 있는가 | **없다** |

### 02가 03에서 덜어낸 것

00-index가 03의 미결로 적었던 세 가지 중 하나가 해소됐다.

- **`confirmPageReady`의 인접 날짜 확인 위치** — 02에서 흐름으로 확정했다.
  03에서 다시 다루지 않는다.
- `advanceFromSlot`의 소속, shadow listener 생명주기는 **여전히 미결**이며
  이 문서에서 정한다.

02는 또 `start`/`cleanup` 훅을 만들어 **흐름 상태의 생명주기 경계를
드러냈다.** `watchLive`·`lastArrivalAt`은 `start()`에서 쓰이고
`availabilityWake`는 `cleanup()`에서 원복된다. 03이 이 상태를 옮기면 두 훅도
따라 바뀐다는 것이 지금은 눈에 보인다.

### 기준선

`orchestrator.ts` **1,310줄**. `RunKernel` 191~551, `RunSession` 552~1282,
`OpenRunOrchestrator` 1283~.

| 메서드 | 줄 | 길이 |
|---|---|---|
| `onAvailabilityBody` | 661–701 | 41 |
| `correlateDomCandidate` | 702–717 | 16 |
| `confirmPageReady` | 718–727 | 10 |
| `waitForOpen` | 728–750 | 23 |
| `searchAndReserve` | 751–772 | 22 |
| **`runToggleCycle`** | 773–1055 | **283** |
| `advanceFromSlot` | 1056–1149 | 94 |
| `waitForSlotTransition` | 1150–1165 | 16 |
| `advancePostSlot` | 1166–1293 | 128 |

## 결정 1 — 경계는 "슬롯을 찾을 때까지"다

핫패스를 **슬롯 감지까지**로 긋는다. 슬롯 이후는 `RunSession`에 남긴다.

```
OpenRunHotPath   날짜 토글로 슬롯을 찾는다
  runToggleCycle · waitForSlotTransition · onAvailabilityBody · correlateDomCandidate
  상태 8개 전부

RunSession       흐름 전체를 엮는다
  confirmPageReady · waitForOpen · searchAndReserve(루프 구동)
  advanceFromSlot · advancePostSlot
```

근거는 폴링 성격이다. `runToggleCycle`은 25ms·10ms·5ms 간격으로 도는 구간을
포함하고 `waitForSlotTransition`이 그 뒤를 잇는다. `advanceFromSlot` 이후는
슬롯을 찾은 뒤 **한 번** 실행되는 경로이며 폼·결제 화면을 다룬다. 성격이
다르고, 묶으면 "핫패스 클래스"가 예약 완주까지 삼킨다.

### `advanceFromSlot`은 남긴다 (미결 해소)

`lastArrivalAt`을 두 곳(1056·1095)에서 읽지만 **읽기 전용**이다. 도착
시각 telemetry를 쓸 뿐 갱신하지 않는다. 상태를 핫패스가 소유하고
`advanceFromSlot`은 읽기 접근자로 받는다.

소유권을 기준으로 나누면 이 메서드는 핫패스가 아니다.

### shadow listener는 핫패스가 소유한다 (미결 해소)

`onAvailabilityBody`·`correlateDomCandidate`가 쓰는 것은
`availabilityWake`·`availabilityCorrelation` 둘뿐이고, 그 둘은
`runToggleCycle`이 wake 신호로 소비한다. 관측 이름이 붙어 있지만
**제어다**(02에서 확인한 주석 그대로).

따라서 shadow 콜백은 핫패스로 간다. `RunSession.start()`가 등록하는
listener는 `hotPath.onAvailabilityBody`를 부른다.

## 결정 2 — 별도 파일로 뺀다

`src/content/flow/open-run-hot-path.ts`를 신설한다.

02는 `tests/build-regression.test.mjs`가 `dist/content/orchestrator.js`의
소스 텍스트를 검사해 파일 분리를 못 했다. **03은 해당되지 않는다.** 검사
문자열 5개가 전부 `RunKernel`과 `OpenRunOrchestrator`에 있고 둘 다
`orchestrator.ts`에 남는다.

| 검사 문자열 | 소재 |
|---|---|
| `this.authorizationHandle.dispose();` | `RunKernel` |
| `await Promise.allSettled([` | `RunKernel` |
| `new RunSession(` | `OpenRunOrchestrator` |
| `authorization = undefined;` | `OpenRunOrchestrator` |
| `return await session.execute();` | `OpenRunOrchestrator` |

## 설계

### 상태 소유권 이동

여덟 개 전부 `OpenRunHotPath`로 옮긴다.

| 상태 | 현재 사용처 | 이동 후 |
|---|---|---|
| `availabilityWake` | cleanup, shadow 콜백, 토글 | 핫패스 소유. `cleanup()`이 `hotPath.reset()` 호출 |
| `availabilityCorrelation` | shadow 콜백, 토글 | 핫패스 소유 |
| `watchLive`·`lastArrivalAt` | `start()` 콜백, 토글, `advanceFromSlot` | 핫패스 소유. `start()`가 `hotPath.noteArrival()` 호출, `advanceFromSlot`은 읽기 접근자 |
| `adjacentTiming`·`targetTiming` | 토글 | 핫패스 소유 |
| `toggleCycle` | `searchAndReserve` | 핫패스 소유. 루프 구동은 `RunSession`에 남고 사이클 번호는 핫패스가 센다 |
| `adjacentDate` | `confirmPageReady`가 쓰고 토글이 읽음 | 핫패스 소유. `armAdjacentDate()`로 흐름이 확정값을 넘긴다 |

### 생성자 주입은 철회했다

초안은 `adjacentDate`를 생성자로 주입해 "인접 날짜 없는 핫패스는 존재할 수
없다"를 타입으로 강제하려 했다. **구현에서 되돌렸다.**

`start()` 훅은 `confirmPageReady`보다 **먼저** 돈다(02의 실행 순서). 그
훅이 등록하는 slotWatch 콜백이 핫패스의 `noteArrival()`을 부르므로, 핫패스는
`confirmPageReady`보다 앞서 존재해야 한다. 생성자 주입으로 두면 객체가 늦게
생겨 **그 사이 도착 신호가 유실된다** — 동작 변경이며 이 단계의 조건 위반이다.

따라서 생성은 `RunSession` 생성자에서 하고, 인접 날짜는
`armAdjacentDate()`로 나중에 넘긴다. `adjacentDate`의 타입은 이전과 같은
`string | null`이라 판정 동작도 그대로다.

### `advanceFromSlot`이 읽는 상태는 셋이다

초안은 `lastArrivalAt` 하나로 적었으나 실제로는 `adjacentTiming`·
`targetTiming`도 읽는다(`slotDetectedEventData` 인자). 셋을 묶어
`detectionTiming` 접근자 하나로 노출한다. 쓰기는 핫패스만 한다.

### 커널 접근

핫패스도 커널의 terminal API가 필요하다(`timedOut`·`diagnosticHandOff` 등).
02에서 `RunSession`이 쓰던 방식을 그대로 쓴다 — 생성자로 `RunKernel`을 받고
`this.kernel.X`로 부른다. **새 컨텍스트 타입을 만들지 않는다.** 그 모양을
정하는 것은 04이고 게이트가 걸려 있다.

## 성공 기준

[00-index §성공 기준](../00-index.md#성공-기준) 1·3·4·5에 더해 이 단계의
추가 검증은 다음이다.

6. **핫패스 타이밍 무영향을 기존 단언으로 확인한다.** `tests/orchestrator.test.mjs`
   에 토글 그리드 시각을 고정하는 단언이 이미 있다. 이 단계는 그것들을
   **수정 없이** 통과해야 한다. 통과하지 못하면 경계를 잘못 그은 것이다
   ([00-index §중단 조건](../00-index.md#중단-조건)).
7. **생명주기 순서가 유지된다.** `tests/kernel-lifecycle.test.mjs` 3건이
   무수정 통과한다. `start`/`cleanup`이 핫패스로 위임을 바꾸므로 이 테스트가
   위임 실수를 잡는 자리다.
8. **상태 누출 없음을 타입으로 강제한다.** 이동한 8개 필드가
   `RunSession`에 남아 있지 않음을 확인한다. 읽기가 필요한
   `lastArrivalAt`은 접근자로만 노출한다.

## 하지 않는 것

- **전략 인터페이스를 만들지 않는다.** `OpenRunHotPath`는 구현체 하나뿐인
  구체 클래스다. 인터페이스화는 04이며 두 번째 흐름의 실측 근거가 없다.
- **`advancePostSlot`·`advanceFromSlot`을 옮기지 않는다.**
- **핫패스 상수·payload·trace attribute 변경.** 한 글자도 바꾸지 않는다.
- `RunKernel.offsetMs` 죽은 필드는 **별도 커밋으로** 지운다. 이 단계의
  이동과 섞지 않는다.

## 위험

`runToggleCycle` 283줄이 이 패키지에서 가장 큰 단일 이동이다. 02에서 쓴
방법(원본 줄 구간 재조립 스크립트 + 구간별 주석 균형 검사)을 그대로 쓴다.
손 편집하지 않는다.
