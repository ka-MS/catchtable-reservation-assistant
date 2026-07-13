# Tier 1 — 기준시계 신뢰성 설계

**분석:** `10-analysis.md` · **우산:** `../open-timing-performance-analysis.md`

## 1. 데이터 모델

각 HEAD 표본은 `Date`의 1초 양자화를 **오프셋 구간**으로 표현한다.

```text
t0 = 요청 직전 monotonic epoch
t1 = 응답 수신 monotonic epoch
D  = Date 헤더의 초 시작값 (ms)

offset ∈ [D - t1, D + 1000 - t0)
```

근거: 서버가 `Date=D`를 찍은 순간 `t_stamp ∈ [t0, t1]`이고 그때 진짜 서버시각 `∈ [D, D+1000)`. `offset = 진짜서버 − 로컬`을 `t_stamp` 양끝으로 넓히면 위 구간. **RTT가 작을수록 구간이 좁아 진짜 오프셋을 강하게 핀한다.**

```typescript
interface ClockSample {
  t0: number;            // monotonic epoch (요청 전)
  t1: number;            // monotonic epoch (응답 후)
  serverDateMs: number;  // D (초 정렬)
  rttMs: number;         // t1 - t0
  lowerMs: number;       // D - t1
  upperMs: number;       // D + 1000 - t0
  fromCache: boolean;    // age 헤더 등으로 캐시 판정 시 제외
}

interface ReferenceClockEstimate {
  offsetLowerMs: number;
  offsetCenterMs: number;
  offsetUpperMs: number;
  uncertaintyMs: number;            // (upper - lower)/2
  confidence: "HIGH" | "MEDIUM" | "LOW";
  dominantClusterSupport: number;   // 다수 클러스터 표본 수
  competingClusterSupport: number;  // 2등 클러스터 표본 수
  clusterSeparationMs: number;      // 두 클러스터 중심 거리 (없으면 -1)
  medianRttMs: number;
  p95RttMs: number;
  sampleCount: number;
  observationSpanMs: number;        // 가장 이른~늦은 표본 시간 간격
  source: "APP_HEAD_HTTP_DATE" | "FALLBACK";
  updatedAtMonoMs: number;
}
```

## 2. 추정 알고리즘 (최대 피복 스윕)

교집합이 아니라 **가장 많은 구간이 덮는 오프셋 영역**을 찾는다. 스큐 샘플 하나가 전체를 깨뜨리지 못한다.

```text
1. 표본 필터: fromCache 제외, rttMs > p95×배수(이상치) 제외.
2. 구간 경계 이벤트(+1 at lower, -1 at upper)를 오프셋 축에 정렬해 스윕.
3. 피복수 최대 구간 = 다수 클러스터. 그 구간을 [offsetLower, offsetUpper],
   중심을 offsetCenter로 삼는다.
4. 다수 구간과 겹치지 않는 다음 최대 피복 구간 = 경쟁 클러스터.
   clusterSeparation = |두 중심 거리|.
5. confidence 판정:
   - 경쟁 클러스터 없음 or separation < 임계   → 표본수·스팬으로 HIGH/MEDIUM
   - dominant ≥ 2×competing 그리고 스팬 충분   → MEDIUM~HIGH
   - dominant ≈ competing (모호)              → LOW, uncertainty = separation 포함해 확대
6. 히스테리시스: 직전 estimate가 HIGH였고 새 다수 클러스터가 그와 ~1000ms
   떨어졌으며 지지 차가 근소하면, 이전 클러스터를 유지(강한 증거 없이 점프 금지).
```

confidence 세부 순위: ① 다수 클러스터 지지수 ② median RTT 작은 클러스터 ③ 최근 표본 비율 ④ 이전 정상 estimate와의 연속성.

## 3. Rolling 샘플러 — 수명 (구현 중 확정, §3-old 정정)

10-analysis 초안은 "WAITING_FOR_OPEN 진입 시 시작"이라 썼으나, 실제 `orchestrator.ts` 흐름(`syncInitialClock → prepareEntry → prepareDate → preparePerson → confirmPageReady → waitForOpen`)을 대조하니 더 이른 시작이 맞다:

```text
시작: syncInitialClock의 부트스트랩 표본 직후 (SYNCING_CLOCK 단계 끝).
      → prepareEntry/Date/Person/confirmPageReady를 관통해 계속 관측(수 초~수십 초 추가 확보).
정지: waitForOpen()의 armLead 대기가 풀리는 순간 — REFRESHING_SLOTS(토글 루프) 진입 직전.
      → 정밀 그리드 구간(nextTogglePlan)은 앵커가 절대 흔들리지 않는다(기존 코드와 동일 성질).
```

이유: 부트스트랩은 단일 HEAD 1회(버스트 아님 — 표본 1개는 가짜 다수를 만들 수 없다)로 **거친 앵커**만 세운다. `prepareEntry` 등의 데드라인(`serverClock.now()+5000` 등)은 상대 타임아웃이라 ±1초 오차가 무해하다. 대신 이 구간 내내 샘플러를 돌려두면 armLead 계산 시점까지 관측 스팬이 늘어나 confidence가 자연히 개선된다(공짜 관측 시간).

```text
ReferenceClockSampler
 - 저빈도 주기(기본 1.75s, 배경 스로틀 ≥1s 위)로 HEAD 표본 수집.
 - 최근 64개 링버퍼. 매 표본마다 estimate 재계산 후 콜백으로 방출.
 - 콜백마다 MonotonicEpochClock을 재앵커(히스테리시스는 estimateReferenceClock 내부에서 처리 —
   오케스트레이터는 estimate.offsetCenterMs를 그대로 적용하면 된다, 추가 가드 불필요).
```

**⚠️ 앵커 단위 주의(실수하기 쉬운 지점).** `ReferenceClockSample.t0/t1`은 **monotonic** epoch(`monotonicClock.now()`)이다. 따라서 재앵커는

```ts
serverClock.anchor(this.deps.monotonicClock.now() + estimate.offsetCenterMs)
```

여야 한다. 옛 코드의 `serverClock.anchor(this.deps.clock.now() + this.offsetMs)`(wall clock 기반)를 그대로 재사용하면 서로 다른 시간 공간을 더하는 조용한 버그가 된다 — `deps.clock`이 아니라 `deps.monotonicClock`을 써야 한다.

- 기존 초기/최종 2회 버스트는 제거. 대기 시간 전체가 관측 창이 된다.
- 표본은 시간 분산되므로 스큐 풀이 일시적으로 몰려도 다수 클러스터가 진짜 값으로 수렴한다.
- `observationSpanMs`로 "64개 2초 수집"과 "64개 2분 수집"의 품질 차를 노출한다.

## 4. adaptive armLead (구현 중 확정 — 클램프 하한 제거)

오케스트레이터는 offset이 아니라 **불확실성 상한**으로 감시 조기 시작 시점을 정한다. 서버가 예상보다 최대 `uncertainty`만큼 앞설 수 있으므로 그만큼 먼저 관측한다(클릭은 앞당기지 않음).

```text
armLeadMs = min(
  MAX_ARM_LEAD_MS,        // 안전 상한(예 30_000) — 병리적 불확실성이 감시를 몇 분씩 당기지 않게
  config.preOpenLeadMs    // 사용자가 설정한 기본 리드타임 = base
  + estimate.uncertaintyMs
  + estimate.p95RttMs
)
```

원안(§4-old)의 `MIN_ARM_LEAD`(하한 clamp)와 `toggleRenderMarginMs`(별도 상수)는 **뺐다**. 이유:

1. **하한 clamp가 테스트 스케일과 충돌한다.** 프로덕션 스케일(분 단위)을 가정한 `MIN_ARM_LEAD≈1500`을 넣으면, `openAtMs`가 수천 ms인 기존 오케스트레이터 테스트(ms 스케일 시뮬레이션)에서 하한이 전체 타임라인을 집어삼켜 모든 토글 그리드 단언이 깨진다. `config.preOpenLeadMs` 자체가 이미 사용자가 설정한 최소 리드타임이므로 별도 하한이 불필요하다.
2. **margin은 estimate 자체에서만 끌어온다.** `toggleRenderMarginMs`처럼 항상 더해지는 별도 상수를 없애고 `uncertaintyMs`·`p95RttMs`(둘 다 estimate 필드)만 쓰면, **불확실성 0·RTT 0인 고정 estimate를 주입했을 때 `armLeadMs`가 정확히 `config.preOpenLeadMs`로 수렴** — 이게 4단계 무수정 통과 가드의 핵심이다. 테스트 하네스 기본 fake `referenceClock.latest`는 `{uncertaintyMs: 0, p95RttMs: 0, confidence: "HIGH", ...}`로 둔다.

- `WAITING_FOR_OPEN`은 `openAt − armLeadMs`에 감시(토글) 단계로 넘어간다. 기존 고정 `preOpenLeadMs` 진입은 이 계산으로 대체.
- confidence LOW → uncertainty 큼 → armLead 큼 → 더 일찍 관측 시작. 응답 주도 구조와 정합.
- armLead는 **WAITING_FOR_OPEN 진입 시 1회만 계산**한다(그 시점까지의 누적 관측 반영). 대기 도중 값이 바뀌어도 wait 목표 시각은 재계산하지 않는다(동적 재무장은 비목표 — 복잡도 대비 이득 낮음, YAGNI). 단, 앵커 자체는 대기 내내 계속 갱신되어(§3) 토글 루프 진입 순간 가장 신선한 오프셋을 쓴다.

### 옛 2단계 재보정과의 관계 — 제거 대상 코드/테스트

`waitForOpen()`의 `finalClockSyncAt` 기반 분기(오픈 5초 전 재동기화 대기 → `deps.syncClock` 재호출)는 **통째로 제거**한다(연속 샘플링이 대체). 이에 따라:

- `shared/clock.ts`의 `finalClockSyncAt` export는 orchestrator에서 더 이상 쓰이지 않는다(다른 소비자 없으면 orchestrator import만 제거, 함수·테스트 자체는 유지해도 무해 — 판단은 실제 grep으로).
- `tests/orchestrator.test.mjs`의 **`"long waits resynchronize the server clock shortly before opening"`**(옛 `syncCalls`/`syncTimes` 2회 호출 검증)은 옛 메커니즘 전용이라 **재작성 대상**(무수정 가드의 예외로 명시). 새 동작(연속 샘플링 + 1회 armLead 결정)에 맞는 대체 테스트로 바꾼다 — 예: "긴 대기 동안 샘플러가 여러 번 틱하며 offset이 갱신된다" + "WAITING_FOR_OPEN 진입 시 정확히 1번 armed 메트릭이 찍힌다".

## 5. 3-프레임 텔레메트리

한 이벤트에 세 시간 프레임을 함께 싣는다.

```text
1. monotonic  : 런 시작 이후 실제 경과(mono)
2. reference  : reference-clock 기준 오픈 대비 delta + offset/uncertainty/confidence
3. availability: 첫 empty / 첫 populated / 슬롯 DOM 등장 / 클릭 시점
```

- CLOCK_SYNCED 계열에 `offsetCenter/Lower/Upper·uncertainty·confidence·dominant/competing support·clusterSeparation·medianRtt·p95Rtt·sampleCount·observationSpanMs` 추가.
- SLOT_DETECTED 계열에 `monoFromRunStart·referenceOpenDelta·clockConfidence·arrivalToDetectMs·arrivalToClickMs` 추가(앞쪽 배치 — trace-view 6속성 제한 고려).
- 목적: 시계 오차 / 서버 지연 / DOM 렌더 / 클릭 코드 중 무엇이 느렸는지 사후에 절대 혼동하지 않게.

## 6. 변경 경계

- `shared/clock.ts`: `ReferenceClockEstimate` 타입 + 최대 피복 추정 함수 추가. 기존 `selectClockEstimate`는 유지하거나 새 함수로 대체(하네스 테스트로 회귀 가드).
- `content/clock-sync.ts` → 저빈도 rolling 샘플러로 재구성(또는 `reference-clock-sampler.ts` 신설).
- `content/orchestrator.ts`: 2회 버스트 호출 제거, 샘플러 수명 관리, `armLead` 계산으로 `WAITING_FOR_OPEN` 전이, 3-프레임 계측 필드.
- **변경 없음:** 슬롯 adapter, 토글 계획 산식, 슬롯 선택, post-slot, Background, 자동화 경계.

## 7. 네이밍

새 컴포넌트·필드는 `ReferenceClock*`로 명명한다(예: `ReferenceClockEstimate`, `referenceOffsetMs`). `ServerClock`은 "예약 서버의 절대 진실"을 함의하므로 쓰지 않는다 — 이 시계는 오픈 구간 접근용 관측 기준값이다(우산 §2 P3).
