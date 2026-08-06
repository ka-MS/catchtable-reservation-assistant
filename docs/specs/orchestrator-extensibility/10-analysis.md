# 구조 측정과 판정

**상태:** 확정
**측정일:** 2026-08-07
**측정 기준:** `main` @ `76fab18`
**부모 패키지:** [오케스트레이터 확장성 기반](00-index.md)

## 왜 측정했나

"확장성 있는 구조를 의도했는데 갈수록 잘 안 되는 것 같다"는 판단을
감이 아니라 지표로 검증하기 위해서다. 특히 **과설계(over-abstraction)와
과소설계(God file)는 체감이 같은데 처방이 정반대**라, 방향을 잘못 잡으면
구조가 더 나빠진다.

이 문서는 그 판단 근거를 보존한다. 이후 같은 의심이 들 때 처음부터
다시 세지 않아도 되도록 측정 방법까지 남긴다.

## 측정 방법

대상은 git이 추적하는 `src` 하위 `.ts` 전체 83개다.

```bash
git ls-files 'src/**/*.ts' 'src/*.ts'
```

**줄 수는 전부 `wc -l` 기준으로 통일한다.** 초판에서 평균·중앙값만
`split("\n").length`(= `wc -l` + 1)로 계산해 합계와 어긋났다. 아래 값은
정정한 것이다.

영역 분류는 파일 경로 기준으로 **각 파일을 정확히 한 번만** 계상한다
(중복 0, 누락 0). 초판에서 `src/sidepanel/*.ts` 글롭이 하위
`telemetry/`·`diagnostics/`를 함께 잡아 사이드패널 UI가 과다 계상됐다.

## 1. 추상화 지표

검출 명령과 결과를 함께 남긴다.

| 지표 | 값 | 검출 |
|---|---|---|
| **클래스 상속** | **0건** | `grep -rn "class [A-Za-z]* extends"` |
| 인터페이스 확장 | 6건 | `grep -rn "interface .* extends"` |
| 제네릭 제약 | 8건 | `grep -rno "<[A-Z][A-Za-z]* extends "` |
| Factory·Registry·Container·Provider | 4파일 | 이름만 등장. DI 프레임워크 없음 |
| class 선언 | 34 | |
| interface 선언 | 150 | 대부분 데이터 shape이며 간접 계층이 아니다 |
| 파일 수 | 83 | |
| 파일당 평균 / 중앙값 | **150.6 / 82줄** | 대부분의 파일이 작고 응집돼 있다 |
| 300줄 초과 | 9개 | 아래 참조 |

`interface extends` 6건은 데이터 타입 확장이며 다형성 계층이 아니다
(`CycleRecord extends TargetCycleRegistration` 등). **클래스 상속은 0건**이고,
이 결론이 "컴포지션 기반 구조"라는 판정의 근거다.

과설계 코드베이스의 전형적 증상 — 얇은 래퍼 다수, 호출 추적 불가,
DI 컨테이너, 교체된 적 없는 인터페이스 — 은 **하나도 관측되지 않는다.**
포트 인터페이스(`Dependencies`)는 테스트에서 실제로 fake로 교체되므로
살아있는 seam이다.

### 300줄 초과 파일

```
1630  src/content/orchestrator.ts
1066  src/sidepanel/index.ts
 791  src/content/adapter/reservation-form.ts
 618  src/background/run-supervisor.ts
 426  src/content/diagnostics/dom-snapshot.ts
 394  src/background/index.ts
 369  src/content/completion-coordinator.ts
 321  src/content/adapter/post-slot.ts
 313  src/shared/run-control/logical-run.ts
```

## 2. 영역별 규모와 흐름 종속성

흐름이 늘어날 때의 증가 양상으로 세 가지로 나눈다.

### 흐름별 — 흐름마다 새로 작성

| 영역 | 줄 |
|---|---|
| DOM 어댑터 | 2,066 |
| `orchestrator.ts` | 1,630 |
| 준비 스테이지 엔진 | 383 |
| 예약 완주 | 369 |
| **소계** | **4,448 (35.6%)** |

준비 스테이지 엔진은 엔진 자체가 아니라 흐름별 스펙이 추가된다.
예약 완주는 흐름 간 공유 가능성이 있으나 확인 전까지 보수적으로 넣는다.

### 공유하지만 증가 — 기존 코드를 고치며 늘어남

| 영역 | 줄 | 증가 지점 |
|---|---|---|
| 사이드패널 UI | 1,748 | 흐름 선택 UI, 조건부 폼 필드, 상태 라벨 |
| 설정·타입·스케줄·저장 | 1,699 | `ReservationConfig` 분기, `configFingerprint`, `occupancyWindow` |
| **소계** | **3,447 (27.6%)** |

§5의 결합 지점 목록이 이 영역에 해당한다.

### 고정 — 흐름 수와 무관

| 영역 | 줄 | 근거 |
|---|---|---|
| 관측·텔레메트리·진단 | 1,888 | 실측 근거 원칙의 비용. 진단 ZIP·CSV·IndexedDB trace |
| MV3 복구·durable claim | 1,373 | 서비스워커 임의 종료 플랫폼의 세금 |
| XHR shadow·상관관계 | 998 | ms 단위 경쟁의 도메인 요구 |
| 서버시계 측정 | 347 | 위와 같음 |
| **소계** | **4,606 (36.8%)** |

**합계 12,501줄.**

### 판정: "1개 흐름에 12,501줄"은 잘못된 해석이다

흐름에 종속된 코드는 **35.6%** 이고, **36.8%는 흐름 수와 무관**하다.
나머지 27.6%는 공유되지만 흐름당 일부 증가한다.

따라서 흐름을 추가해도 총량이 흐름 수에 비례해 늘지 않는다. 고정
영역이 곱해지지 않는다는 것이 **현재 구조가 작동하고 있다는 증거**다.

증가량의 구체적 추정치는 제시하지 않는다. 새 흐름의 어댑터 규모와
핫패스 형태를 결정할 실측 근거가 아직 없어, 파일 단위 매핑 없이
추정하면 근거 없는 수치가 된다.

## 3. `orchestrator.ts` 내부: 제어와 관측의 혼재

문제는 총량이 아니라 이 파일 하나에 있다.

| 지표 | 값 |
|---|---|
| 텔레메트리 payload 조립 | 354줄 / 14블록 (파일의 22%) |
| 빈 `catch` | 22개 (분류는 아래) |
| `serverAt`·`state` 스탬핑 중복 | 28곳 |
| `trace` 호출 지점 | 10곳 (각각 40~50줄짜리 attribute 리터럴 인라인 보유) |
| `emit` 호출 지점 | 7곳 |

`SP-009`에서 626줄짜리 단일 메서드를 단계 메서드로 분해했는데,
이후 1,630줄로 다시 자랐다. 원인은 분해 실패가 아니라 **관측이라는
관심사에 경계가 없어서**다. 새 기능(shadow wake, empty-exit, correlation)이
들어올 때마다 제어 로직은 조금 늘고 관측 코드는 많이 늘었다.

### 빈 `catch` 22개의 분류

**전부 관측 격리용이 아니다.** 절반 이상이 제어 복원력 경계다.
따라서 "하나로 합친다"는 접근은 동작을 바꾼다.

| 성격 | 수 | 행 | 내용 |
|---|---|---|---|
| **관측 전용** | 9 | 294, 309, 342, 361, 386, 391, 648, 686, 760 | breadcrumb, 페이지 컨텍스트 캡처, snapshot, `diagnostics.failure`, wake·empty-exit·clock sample trace |
| **혼합** | 2 | 553, 569 | `observeAvailabilityBody`·`observeAvailabilityDom`. 상관관계 계산·`wake.offer`(제어)와 trace(관측)가 한 블록 |
| **제어 복원력** | 11 | 271, 435, 472, 479, 725, 730, 869, 913, 1035, 1173, 1377 | 아래 |

제어 복원력 경계 중 특히 주의할 것:

- **1173** — `availabilityWake.wait()` 실패 시 `deps.sleep`으로 폴백한다.
  **핫패스 제어 경로**다.
- **869** — `attemptPhase("EXECUTING")`. control plane 신호다.
- **271** — `mutationSnapshot()`이 기본값을 반환하는 폴백이다.
- **435 / 472 / 479 / 725 / 913 / 1035** — shadow·watch·기준시계 lifecycle과
  정리.
- **1377** — `new URL()` 파싱 실패 시 `shopSlug`를 비운다.

또한 다음 두 가지는 현재 동작이므로 변경 시 회귀가 된다.

- `deps.emit`은 **예외를 삼키지 않는다.** `emit()`의 try/catch는
  `diagnostics.breadcrumb`만 감싼다(292~297행).
- `failureData()`는 snapshot 캡처가 실패해도 `diagnostics.failure()`를
  **독립적으로 실행한다.** 384행과 389행이 별도 블록이다.

### 25ms 루프 안에는 관측이 없다

`runToggleCycle`의 `traceCycle`은 사이클 종료 시 1회만 호출된다.
25ms·10ms·5ms polling 루프 내부에서 호출되는 관측 코드는 없다.
따라서 관측 분리는 핫패스 성능에 중립이다.

이 사실은 관측 분리 후에도 유지되어야 하며, 설계 문서에 명시한다.

## 4. 판정

| 질문 | 답 |
|---|---|
| 과설계인가 | **아니다.** 클래스 상속 0, DI 없음, 중앙값 82줄, 죽은 인터페이스 없음 |
| 총량이 과한가 | **아니다.** 36.8%가 흐름 무관 고정 영역이며 각각 도메인 요구로 설명된다 |
| 그럼 무엇이 문제인가 | **`orchestrator.ts`의 제어·관측 혼재.** 과소설계다 |
| 처방은 | 추상화를 걷어내는 것이 아니라 **경계를 추가**하는 것 |

### 과설계와 과소설계의 구분

| | 증상 | 처방 |
|---|---|---|
| 과설계 | 얇은 파일 다수, 호출 추적 어려움, 교체된 적 없는 인터페이스 | 걷어내기 |
| 과소설계 | God file, 한 파일이 계속 자람 | **seam 추가** |

둘 다 "구조가 잘 안 된다"고 느껴지므로, 여기서 방향을 반대로 잡아
추상화를 제거하면 상황이 악화된다.

### 재사용 가능한 판별 기준

줄 수로는 과설계를 판단할 수 없다. 도메인이 어려우면 코드는 원래 길다.
대신 다음을 본다.

1. **기능 하나 추가에 건드리는 파일 수** — 늘면 결합, 안 늘면 건강
2. **실제로 교체된 적 있는 인터페이스인가** — 프로덕션에서든 테스트에서든
   한 번도 교체되지 않은 인터페이스가 과설계다
3. **"이 파일을 지우면 제품이 무엇을 잃는가"** — 답할 수 있으면 과설계 아님

## 5. 새 흐름 추가 시 실제 결합 지점

웨이팅·줄서기 같은 흐름을 가정했을 때 수정이 강제되는 곳이다.
이 패키지의 단계들은 이 목록을 줄이는 것을 목표로 한다.

| 위치 | 이유 |
|---|---|
| `orchestrator.ts:443-452` `execute()` | 단계 체인이 하드코딩. 흐름 분기점이 없다 |
| `orchestrator.ts:908-1212` 핫패스 | 인접 날짜 토글 전제. 다른 흐름엔 무의미 |
| `shared/types.ts:31-54` + `config.ts:62-144` | `ReservationConfig`에 흐름 discriminator 없음. 검증이 전 필드를 무조건 요구 |
| `state-machine.ts:12-38` `ALLOWED` | `Record<RunState, RunState[]>` 전수 테이블 |
| `run-control/policy.ts:16`, `classifier.ts:5`, `entry-coordinator.ts:14` | `WAITING_ONLY`가 지금은 terminal 실패로 분류돼 있다. 웨이팅 지원 시 **같은 사실을 흐름별로 다르게 해석**해야 한다 |
| `sidepanel/index.ts:140-190` | `Record<RunState, string>` 두 개. 타입이 누락을 강제하므로 안전장치로는 양호 |
| TERMINAL 집합 | **8개 파일에 중복 정의.** 현재는 동일하나 흐름이 늘면 표류 위험 |
| `saved-configs.ts:20` `configFingerprint` | 흐름을 해싱하지 않아, 같은 매장·날짜의 다른 흐름 설정이 서로를 덮어쓴다 |
| `scheduled-jobs.ts:14` `occupancyWindow` | `openAtMs` 기준 충돌 판정. 오픈 시각 개념이 다른 흐름은 규칙 재정의 필요 |

## 6. 재사용되는 영역

반대로 흐름이 늘어도 그대로 쓰이는 부분이다. 구조가 이미 잘 잡힌 곳이다.

- **포트 계층** (`orchestrator.ts:39-118`) — 어댑터 추가가 기존 어댑터를
  건드리지 않는다.
- **`runPreparationStep`** (`preparation/step-runner.ts:67`) — 스펙만 주면
  도는 범용 스테이지 엔진. 이 코드베이스에서 가장 완성된 플러그인 seam이다.
- **Background 전체** — `RunSupervisor`는 config를 불투명하게 통과시킨다.
  내용을 보는 곳은 `entryMode`와 `availabilityProbeMode` 두 군데뿐이다.
- **시계·스케줄러** — 흐름 중립.

## 7. 오픈런 전용 세션 상태의 사용처

[00-index.md](00-index.md)의 03·04 분리 근거이자, **03의 범위를 정하는
표**다.

8개 필드는 **핫패스(908~1212) 안에만 있지 않다.** setup, 핫패스 제어,
telemetry 소비, cleanup 네 곳에 걸쳐 있다.

| 필드 | setup | 핫패스 제어 | telemetry 소비 | cleanup |
|---|---|---|---|---|
| `adjacentDate` | 881 `confirmPageReady` | 950 | — | — |
| `toggleCycle` | — | 935 | — | — |
| `adjacentTiming` | — | 1003 set | **1224** `advanceFromSlot` | — |
| `targetTiming` | — | 1043 set | **1224** `advanceFromSlot` | — |
| `watchLive` | 439 `slotWatch` 콜백 | 1089 `detectDeadline` | 971 | — |
| `lastArrivalAt` | 440 `slotWatch` 콜백 | 1090 `detectDeadline` | 972, **1225**, **1270** | — |
| `availabilityWake` | 432 listener 등록, 502 `offer` | 1027, 1138, 1154, 1166, 1184, 1205, 1210 | — | **475** `reset` |
| `availabilityCorrelation` | 499 `correlateBody`, 562 `correlateDom` | 1020 `registerCycle` | 562 이후 trace | — |

### 확정된 것

**8개 전부 오픈런 전용이다.** 인접 날짜, 토글 사이클, XHR 도착 시각,
wake 신호는 다른 흐름에 해당 개념이 없다. `execute`·`confirmPageReady`에
걸친 setup도 그 자체가 오픈런 전용이다(인접 가용 날짜 확인, `slotWatch`
등록, shadow listener 등록).

따라서 **"전략이 자기 상태를 소유한다"는 원칙은 이 표만으로 도출된다.**
새 흐름의 근거 없이 결정·검증할 수 있다. 이것이 03에 게이트가 없는 근거다.

### 확정되지 않은 것 — 03의 정확한 경계

03은 "핫패스 약 300줄을 옮기는 단순 추출"이 아니다. 위 표대로라면
setup·cleanup·post-slot 결과 소비·telemetry 계약까지 경계를 새로 그어야
한다. 다음은 아직 미결이다.

- `advanceFromSlot`(1214~)이 전략에 속하는가, 커널에 남는가
  (`adjacentTiming`·`targetTiming`·`lastArrivalAt`을 소비한다)
- shadow listener 등록(432)과 `reset`(475)을 전략 생명주기로 옮기는가
- `confirmPageReady`의 인접 가용 날짜 확인을 준비 단계에 남기는가

### 01 완료 후 이 표를 재도출한다

굵게 표시한 telemetry 소비 지점(971, 972, 1224, 1225, 1270)은 전부
payload 조립이다. **01(관측 분리) 이후에는 이들이 관측 계층의 입력이
되므로 제어 코드에서 사라진다.** `availabilityCorrelation`의 499·562도
제어(correlate)와 관측(trace)으로 갈라진다.

즉 01이 끝나면 이 표가 실질적으로 단순해진다. **03의 무게이트 범위는
01 완료 시점의 재측정 결과로 확정하며**, 그 전에는 위 미결 항목을
설계로 확정하지 않는다.

### 04에 게이트가 있는 이유

커널이 전략에 넘길 컨텍스트의 모양은 이 표만으로 정할 수 없다. 지금
정하면 위 8개 개념이 컨텍스트에 들어가고, 두 번째 흐름이 오면 맞지
않는다.

## 관련 문서

- 단계 계획: [00-index.md](00-index.md)
- 01 설계: [01-observation-split/20-design.md](01-observation-split/20-design.md)
- 선행 리팩터: [orchestrator-refactor/20-design.md](../orchestrator-refactor/20-design.md)
- 후속 흐름 후보: [next-development.md](../../plans/next-development.md) §5 취소 자리 감시
