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

```bash
# 대상: git 추적 중인 src 하위 .ts 전체 (83개)
git ls-files 'src/**/*.ts' 'src/*.ts'
```

영역 분류는 파일 경로 기준으로 **각 파일을 정확히 한 번만** 계상한다
(중복 0, 누락 0). 줄 수는 `wc -l` 기준이다.

초기 측정에서 `src/sidepanel/*.ts` 글롭이 하위 `telemetry/`·`diagnostics/`를
함께 잡아 사이드패널 UI가 과다 계상됐다. 아래 값은 그 중복을 제거한 것이다.

## 1. 추상화 지표

| 지표 | 값 | 판정 |
|---|---|---|
| 상속 (`extends`, `abstract`) | **0건** | 검출된 8건은 전부 제네릭 제약(`<T extends HTMLElement>`) |
| Factory·Registry·Container·Provider | 4파일 | DI 프레임워크 흔적 없음 |
| class / interface | 34 / 147 | interface는 대부분 데이터 shape이며 간접 계층이 아니다 |
| 파일 수 | 83 | |
| 파일당 평균 / 중앙값 | 152 / **83줄** | 대부분의 파일이 작고 응집돼 있다 |
| 300줄 초과 | 9개 | 아래 참조 |

과설계 코드베이스의 전형적 증상 — 얇은 래퍼 다수, 호출 추적 불가,
DI 컨테이너, 교체된 적 없는 인터페이스 — 은 **하나도 관측되지 않는다.**

포트 인터페이스(`Dependencies`)는 테스트에서 실제로 fake로 교체되고
있으므로 살아있는 seam이다.

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

## 2. 영역별 규모

| 영역 | 줄 | 비중 | 흐름 추가 시 |
|---|---|---|---|
| DOM 어댑터 | 2,066 | 16.5% | **증가** |
| 관측·텔레메트리·진단 | 1,888 | 15.1% | 거의 불변 |
| 사이드패널 UI | 1,748 | 14.0% | 거의 불변 |
| 기타(설정·타입·스케줄·저장) | 1,699 | 13.6% | 소폭 |
| `orchestrator.ts` | 1,630 | 13.0% | **증가** |
| MV3 복구·durable claim | 1,373 | 11.0% | 불변 |
| XHR shadow·상관관계 | 998 | 8.0% | 불변 |
| 준비 스테이지 엔진 | 383 | 3.1% | 스펙만 추가 |
| 예약 완주 | 369 | 3.0% | 공유 |
| 서버시계 측정 | 347 | 2.8% | 불변 |
| **합계** | **12,501** | | |

### 판정: "1개 흐름에 12,501줄"은 잘못된 해석이다

흐름에 실제로 종속된 영역은 **4,448줄(35.6%)** 이다
(DOM 어댑터 + orchestrator + 준비 엔진 + 완주).

나머지 **8,053줄(64.4%)** 은 흐름 수와 무관한 고정비다.

- **관측·진단 1,888** — `AGENTS.md`의 "실측 근거 없이 추측 구현 금지"
  원칙을 코드로 지불한 비용이다. 진단 ZIP·CSV·IndexedDB trace가 여기 있다.
- **MV3 복구 1,373** — 서비스워커가 임의로 종료되는 플랫폼에서
  durable claim과 reconcile을 유지하기 위한 세금이다.
- **XHR shadow 998 + 서버시계 347** — ms 단위 경쟁에서 이기기 위한
  도메인 요구다.
- **사이드패널 UI 1,748** — 흐름이 늘어도 폼 필드만 추가된다.

따라서 흐름을 2개 더 추가해도 총량이 3배가 되지 않는다. 어댑터와
핫패스만 늘어 **대략 +3,000~4,000줄**로 추정된다. 고정비가 흐름 수에
곱해지지 않는다는 것이 **현재 구조가 실제로 작동하고 있다는 증거**다.

## 3. `orchestrator.ts` 내부: 제어와 관측의 혼재

문제는 총량이 아니라 이 파일 하나에 있다.

| 지표 | 값 | 영향 |
|---|---|---|
| 텔레메트리 payload 조립 | **354줄 / 14블록** (전체의 22%) | 제어 흐름 사이에 끼어 있다 |
| 관측 격리용 빈 `catch` | **22개** | 제어 코드를 읽을 때마다 "왜 예외를 삼키지?"를 되묻게 된다 |
| `serverAt`·`state` 스탬핑 중복 | **28곳** | 모든 trace 호출이 세션 상태를 직접 읽어 조립한다 |
| `trace` 호출 지점 | 10곳 | 각각 40~50줄짜리 attribute 리터럴을 인라인 보유 |
| `emit` 호출 지점 | 7곳 | |

`SP-009`에서 626줄짜리 단일 메서드를 단계 메서드로 분해했는데,
이후 1,630줄로 다시 자랐다. 원인은 분해 실패가 아니라 **관측이라는
관심사에 경계가 없어서**다. 새 기능(shadow wake, empty-exit, correlation)이
들어올 때마다 제어 로직은 조금 늘고 관측 코드는 많이 늘었다.

### 25ms 루프 안에는 관측이 없다

`runToggleCycle`의 `traceCycle`은 사이클 종료 시 1회만 호출된다.
25ms·10ms·5ms polling 루프 내부에서 호출되는 관측 코드는 없다.
따라서 관측 분리는 핫패스 성능에 중립이다.

이 사실은 관측 분리 후에도 유지되어야 하며, 설계 문서에 명시한다.

## 4. 판정

| 질문 | 답 |
|---|---|
| 과설계인가 | **아니다.** 상속 0, DI 없음, 중앙값 83줄, 죽은 인터페이스 없음 |
| 총량이 과한가 | **아니다.** 64%가 흐름 무관 고정비이며 각각 도메인 요구로 설명된다 |
| 그럼 무엇이 문제인가 | **`orchestrator.ts`의 제어·관측 혼재.** 과소설계다 |
| 처방은 | 추상화를 걷어내는 것이 아니라 **경계를 하나 추가**하는 것 |

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
이 패키지의 세 단계는 이 목록을 줄이는 것을 목표로 한다.

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

## 관련 문서

- 세 단계 계획: [00-index.md](00-index.md)
- 01 설계: [01-observation-split/20-design.md](01-observation-split/20-design.md)
- 선행 리팩터: [orchestrator-refactor/20-design.md](../orchestrator-refactor/20-design.md)
- 후속 흐름 후보: [next-development.md](../../plans/next-development.md) §5 취소 자리 감시
