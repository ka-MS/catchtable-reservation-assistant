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

## 3. Rolling 샘플러

```text
ReferenceClockSampler
 - WAITING_FOR_OPEN 진입 시 시작, 오픈(또는 stop) 시 종료.
 - 저빈도 주기(기본 1.5~2s, 배경 스로틀 ≥1s 위)로 HEAD 표본 수집.
 - 최근 N개(기본 64) 링버퍼 유지. 매 표본마다 estimate 재계산.
 - 표본 추가마다 MonotonicEpochClock.offset을 새 estimate.offsetCenter로 갱신
   (단, confidence가 직전보다 낮아지는 하향 교체는 히스테리시스 규칙 따름).
```

- 기존 초기/최종 2회 버스트는 제거. 대기 시간 전체가 관측 창이 된다.
- 표본은 시간 분산되므로 스큐 풀이 일시적으로 몰려도 다수 클러스터가 진짜 값으로 수렴한다.
- `observationSpanMs`로 "64개 2초 수집"과 "64개 2분 수집"의 품질 차를 노출한다.

## 4. adaptive armLead

오케스트레이터는 offset이 아니라 **불확실성 상한**으로 감시 조기 시작 시점을 정한다. 서버가 예상보다 최대 `uncertainty`만큼 앞설 수 있으므로 그만큼 먼저 관측한다(클릭은 앞당기지 않음).

```text
armLeadMs = clamp(
  MIN_ARM_LEAD,          // 기본 하한 (예 1500)
  MAX_ARM_LEAD,          // 상한 (예 10000)
  baseLeadMs
  + uncertaintyMs        // 불확실성 상한
  + p95RttMs             // 요청 왕복 여유
  + toggleRenderMarginMs // UI 토글·렌더 여유
)
```

- `WAITING_FOR_OPEN`은 `openAt − armLeadMs`에 감시(토글) 단계로 넘어간다. 기존 고정 `preOpenLeadMs`는 이 계산으로 대체.
- confidence LOW → uncertainty 큼 → armLead 큼 → 더 일찍 관측 시작. 응답 주도 구조와 정합.

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
