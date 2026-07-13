# Tier 1 — 기준시계 신뢰성 구현 계획

**설계:** `20-design.md` · **분석:** `10-analysis.md` · **우산:** `../open-timing-performance-analysis.md`

TDD로 단계별 커밋한다. 각 단계 종료 시 `npm run check`(WSL) green. 커밋 트레일러 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. `.claude`는 커밋 제외.

## 파일

```text
src/shared/clock.ts                         # ReferenceClockEstimate 타입 + 구간 최대피복 추정
src/content/reference-clock-sampler.ts       # 신규: 저빈도 rolling 샘플러
src/content/clock-sync.ts                    # HEAD 표본을 ClockSample(구간 포함)로 반환하도록 조정
src/content/orchestrator.ts                  # 버스트 2회 제거·샘플러 수명·armLead·3프레임 계측
tests/clock.test.mjs                         # 추정 알고리즘 단위 테스트
tests/reference-clock-sampler.test.mjs        # 신규: 샘플러 수명·rolling 테스트
tests/orchestrator.test.mjs                  # armLead 진입·3프레임 필드 회귀
```

## 불변 (behavior-neutral 가드)

- 슬롯 감지·클릭·토글 산식·자동화 경계 무변경. Tier 1은 **진입 시점(armLead)과 시계 추정**만 바꾼다.
- `MonotonicEpochClock` 앵커 모델 유지. 새 estimator는 `offsetCenter`만 공급.
- 기존 orchestrator 타이밍 테스트는 고정 estimate 주입 시 무수정 통과해야 한다.

## 단계

### 1단계: 구간 모델 + 최대피복 추정 (순수 함수)

- `ClockSample`에 `lowerMs = D - t1`, `upperMs = D + 1000 - t0` 계산 추가.
- `estimateReferenceClock(samples): ReferenceClockEstimate` 신설: fromCache·RTT 이상치 필터 → 오프셋 축 스윕으로 최대피복 구간(다수 클러스터) → 겹치지 않는 2등 피복(경쟁 클러스터) → confidence 판정 → 필드 산출.
- **테스트(RED→GREEN):**
  - 단일 풀(정상 톱니파) → HIGH, center가 진짜 오프셋 ±RTT/2.
  - 스큐 60%(다수 오염) → dominant가 오염 클러스터라도 competing 지지·separation이 크면 **LOW confidence + 넓은 uncertainty**(틀린 값 자신 있게 안 냄).
  - 50:50 모호 → LOW, uncertainty ≥ separation.
  - 저RTT 표본이 구간을 좁혀 center를 핀.
  - 빈 표본 → `source:"FALLBACK"`.
- 커밋: `feat: add interval max-coverage reference clock estimator`.

### 2단계: 연속성 히스테리시스

- `estimateReferenceClock(samples, previous?)`: 직전이 HIGH이고 새 다수 클러스터가 ~1000ms 떨어졌으며 지지 차 근소하면 이전 클러스터 유지.
- **테스트:** HIGH 확정 후 스큐 버스트 유입 → estimate가 ~1000ms 점프하지 않음. 강한 다수 증거(지지 차 큼)면 정상 갱신.
- 커밋: `feat: add hysteresis against skew-cluster jumps`.

### 3단계: Rolling 샘플러

- `ReferenceClockSampler`: `start()`/`stop()`, 주기(기본 1.75s) HEAD 표본을 링버퍼(기본 64)에 넣고 매번 `estimateReferenceClock` 재계산, 콜백으로 최신 estimate 방출. 팩토리 주입형(fake fetch·clock으로 테스트).
- **테스트:** N표본 후 rolling 갱신, 버퍼 상한 유지, `observationSpanMs` 반영, stop 후 미방출.
- 커밋: `feat: add rolling reference clock sampler`.

### 4단계: 오케스트레이터 통합 — 샘플러 수명 + armLead

**세부 설계는 20-design §3·§4(구현 중 확정 섹션)가 최신 — 여기 요약은 그걸 요약한 것.**

**DI 교체.** `Dependencies.syncClock(...)`(구 `ClockEstimate` 기반)을 제거하고 `referenceClock: ReferenceClockPort`로 교체한다. `ReferenceClockPort`는 `reference-clock-sampler.ts`에 신설(패턴은 `SlotRefreshWatchPort`와 동일한 narrow-port):
```ts
export interface ReferenceClockPort {
  readonly latest: ReferenceClockEstimate | null;
  sampleOnce(signal: AbortSignal): Promise<ReferenceClockSample | null>;
  ingest(sample: ReferenceClockSample): ReferenceClockEstimate;
  start(onEstimate: (estimate: ReferenceClockEstimate) => void): Promise<void>;
  stop(): void;
}
```
`ReferenceClockSampler implements ReferenceClockPort`(명시적 implements로 계약 고정). `content/index.ts`의 `syncClock: (config, signal) => syncServerClock(...)` 배선을 `referenceClock: createReferenceClockSampler(...)`로 교체 — 구 `clock-sync.ts`(`syncServerClock`)는 더 이상 배선하지 않는다(파일 자체는 남겨도 무해하나 dead export 정리는 별도 판단).

**syncInitialClock 재작성 — 단일 부트스트랩 표본.**
```ts
private async syncInitialClock(): Promise<RunResult | null> {
  this.transition("SYNCING_CLOCK", "캐치테이블 서버 시계를 측정합니다.");
  const sample = await this.deps.referenceClock.sampleOnce(this.controller.signal);
  if (this.controller.signal.aborted) return this.finishStopped();
  const estimate = sample
    ? this.deps.referenceClock.ingest(sample)
    : this.deps.referenceClock.latest ?? estimateReferenceClock([]); // FALLBACK
  this.applyReferenceClockEstimate(estimate);
  this.emit("metric",
    estimate.source === "FALLBACK" ? "서버 시계 측정 실패로 로컬 시계를 사용합니다." : "서버 시계 보정을 완료했습니다.",
    referenceClockMetricData(estimate, "bootstrap"));
  void this.deps.referenceClock.start((next) => this.applyReferenceClockEstimate(next)); // fire-and-forget, stop()이 종료시킴
  return null;
}

private applyReferenceClockEstimate(estimate: ReferenceClockEstimate): void {
  this.offsetMs = estimate.offsetCenterMs;
  // ⚠️ monotonicClock 사용 필수(wall clock 아님) — 20-design §3 단위 주의 참고.
  this.serverClock.anchor(this.deps.monotonicClock.now() + this.offsetMs);
  this.serverClockReady = true;
  this.latestAppliedEstimate = estimate; // SLOT_DETECTED 3프레임용 보관
}
```
`estimateReferenceClock`을 orchestrator에서 직접 import(FALLBACK 생성용) — `shared/clock.ts`에서 export 필요(현재 이미 export됨, 확인).

**waitForOpen 재작성 — finalClockSyncAt 분기 전체 삭제, armLead 1회 계산.**
```ts
private async waitForOpen(): Promise<RunResult | null> {
  const config = this.config;
  const controller = this.controller;
  const serverClock = this.serverClock;
  this.transition("WAITING_FOR_OPEN", "예약 오픈 직전까지 대기합니다.");
  const estimate = this.deps.referenceClock.latest ?? this.latestAppliedEstimate;
  const armLeadMs = computeArmLeadMs(config.preOpenLeadMs, estimate);
  this.emit("metric", "예약 오픈 직전 진입 시점을 결정했습니다.",
    referenceClockMetricData(estimate, "armed", armLeadMs));
  const waitResult = await waitUntil(config.openAtMs - armLeadMs, {
    clock: serverClock, stopAtMs: config.stopAtMs, signal: controller.signal, sleep: this.deps.sleep,
  });
  this.deps.referenceClock.stop(); // 토글 루프 진입 전 앵커 동결(정밀 구간 시계 흔들림 방지)
  const waitingExit = this.stopOrTimeout(waitResult);
  if (waitingExit) return waitingExit;
  return null;
}

function computeArmLeadMs(preOpenLeadMs: number, estimate: ReferenceClockEstimate): number {
  const MAX_ARM_LEAD_MS = 30_000;
  return Math.min(MAX_ARM_LEAD_MS, preOpenLeadMs + estimate.uncertaintyMs + estimate.p95RttMs);
}
```
`finalClockSyncAt` import·호출은 orchestrator.ts에서 제거(함수 자체는 `shared/clock.ts`에 남겨도 무방 — 다른 소비자 없으면 정리는 별도 판단 사항으로 worklog에 남긴다).

**테스트 하네스 갱신(`tests/orchestrator.test.mjs`).**
- `syncClock: async () => ({...})` 팩토리를 `referenceClock: { latest, sampleOnce, ingest, start, stop }` fake로 교체. 기본 fake `latest` = `{ uncertaintyMs: 0, p95RttMs: 0, confidence: "HIGH", offsetCenterMs: 0, source: "APP_HEAD_HTTP_DATE", ... }` — **이 기본값이 무수정 통과 가드의 실체**(armLeadMs가 정확히 preOpenLeadMs로 수렴).
- `sampleOnce`/`ingest`는 고정 estimate를 반환하는 스텁으로 충분(1~3단계 알고리즘은 이미 별도 단위 테스트로 커버됨 — 여기서 재검증하지 않는다).
- `start(onEstimate)`는 테스트가 명시적으로 `fireEstimate(next)`를 호출할 수 있게 콜백을 캡처만 하고 반환(옛 `slotWatch`의 `arrivalCallback` 캡처 패턴과 동일).
- **재작성 대상(무수정 예외):** `"long waits resynchronize the server clock shortly before opening"` — 옛 `syncCalls===2` 단언은 더 이상 성립하지 않는다. 새 동작에 맞게 교체:
  - `"WAITING_FOR_OPEN 진입 시 정확히 한 번 armed 메트릭을 emit한다"`
  - `"긴 대기 동안 fake 샘플러가 여러 번 estimate를 방출하면 매번 offsetMs가 갱신된다"`(스파이로 `applyReferenceClockEstimate` 호출 횟수 또는 emit된 `serverAt` 값 변화로 간접 검증).
- **신규 테스트:**
  - 고정(`uncertaintyMs:0,p95RttMs:0`) estimate 주입 시 **기존 토글 그리드 타이밍 단언(전부) 무수정 통과** — 이게 폴백 가드의 실제 검증.
  - `uncertaintyMs`를 크게 준 fake → `WAITING_FOR_OPEN`이 더 이른 `serverClock.now()`에 REFRESHING_SLOTS로 전이함을 단언(토글 그리드 자체는 `openAtMs` 절대 기준이라 안 흔들림 — `nextTogglePlan` 재확인).
  - `referenceClock.stop()`이 REFRESHING_SLOTS 진입 직전 정확히 1회 호출됨을 단언.
- 커밋: `feat: drive open-window entry by reference clock uncertainty`.

### 5단계: 3-프레임 텔레메트리

- CLOCK_SYNCED 계열에 `offsetCenter/Lower/Upper·uncertainty·confidence·dominant/competingSupport·clusterSeparation·medianRtt·p95Rtt·sampleCount·observationSpanMs`.
- SLOT_DETECTED 계열에 `monoFromRunStart·referenceOpenDelta·clockConfidence·arrivalToDetectMs·arrivalToClickMs`(앞쪽 배치 — trace-view 6속성 제한).
- trace-view 상세에 confidence·uncertainty 표시(worklog 08 CLOCK_SYNCED 렌더 확장).
- **테스트:** 필드 전달·표시, uncertainty/confidence 렌더.
- 커밋: `feat: log three time frames for clock/server/dom separation`.

### 6단계: E2E 검증 + 문서

- `use-chrome-devtools`로 확장 재로드 → 연습 실런에서 3-프레임 로그·estimate 필드 확인.
- **실오픈 검증(다음 실제 오픈):** 오픈 전 불필요 토글이 사라지는지, estimate가 스큐를 안 물고 HIGH/충분한 uncertainty로 내리는지, openDelta가 진짜 프레임으로 정합한지.
- worklog 작성, site-behavior §8 갱신(스큐 폭·빈도 관측), `40-verification.md`·`50-adversarial-review.md` 채움.

## 검증 기준 (성공)

- 스큐 재현 표본에서 estimator가 다수 클러스터를 고르거나, 못 고르면 LOW + 넓은 uncertainty → armLead 확대.
- 실오픈에서 오픈 전 토글 소멸, 3-프레임으로 지연 원인 분리 판독 가능.
- 기존 클릭·감지 동작 회귀 없음(단위·fixture 무수정 통과).
