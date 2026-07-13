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

- `execute()`에서 `WAITING_FOR_OPEN` 진입 시 샘플러 start, 오픈/종료 시 stop. estimate 갱신마다 `MonotonicEpochClock.offset` 교체(히스테리시스 존중).
- `armLeadMs = clamp(MIN, MAX, baseLead + uncertaintyMs + p95RttMs + toggleRenderMarginMs)`로 감시 단계 진입 시각 계산. 기존 고정 `preOpenLeadMs` 진입 대체(설정값은 baseLead 힌트로 격하 or 유지 — 20-design §4).
- 버스트 2회(`syncInitialClock`·최종 재보정) 제거, 샘플러로 일원화.
- **테스트:** 
  - 고정 estimate 주입 시 기존 타이밍 단언 무수정 통과(폴백 가드).
  - uncertainty 큰 estimate → armLead 큼 → 더 이른 감시 진입 단언.
  - LOW confidence여도 클릭 시점은 슬롯 감지에만 의존(응답 주도 불변).
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
