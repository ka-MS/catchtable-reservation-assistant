# 2026-07-13-02 Tier 1 기준시계 신뢰성 구현

## 개요

`docs/specs/open-timing-performance/01-reference-clock-reliability/30-implementation.md`의 6단계를 TDD로 진행. 브랜치 `codex/tier1-reference-clock`(main에서 분기), main 대비 10커밋, 212/212 테스트 green.

이전 세션이 1~3단계(구간 최대피복 estimator, 히스테리시스, rolling 샘플러)를 이미 커밋해뒀고, 이번 세션에서 4~6단계를 이어 완료했다.

## 커밋

```
b363092 feat: add interval max-coverage reference clock estimator     (1단계, 이전 세션)
b5d04b1 feat: add hysteresis against skew-cluster jumps                (2단계, 이전 세션)
f36599f feat: add rolling reference clock sampler                      (3단계, 이전 세션)
56291da docs: refine Tier 1 step 4 design from code inspection         (설계 정정, 이번 세션)
e0aec8d feat: drive open-window entry by reference clock uncertainty   (4단계)
4159d1e refactor: remove the burst clock-sync mechanism superseded     (죽은 코드 정리)
975c286 feat: log three time frames for clock/server/dom separation    (5단계)
f8d11a9 fix: swallow AbortError from an in-flight fetch                (리뷰 발견 버그 1)
8e1917d fix: give the FALLBACK reference-clock estimate an honest uncertainty (리뷰 발견 버그 2)
```

## 4단계 — 오케스트레이터 통합에서 실제 코드 대조로 정정한 것

설계 문서 원안을 실제 `orchestrator.ts`/`MonotonicEpochClock`과 대조하며 3가지를 구체화·정정(20-design §3·§4에 기록):

1. 샘플러는 "WAITING_FOR_OPEN 진입 시"가 아니라 **부트스트랩(단일 HEAD 1회) 직후부터** 시작해 `prepareEntry`~`confirmPageReady`를 관통 관측하고, **토글 루프 진입 직전 정지**.
2. **재앵커는 `monotonicClock.now() + offsetCenterMs`여야 한다** — `ReferenceClockSample.t0/t1`이 monotonic epoch라, wall clock(`deps.clock`) 기반으로 더하면 서로 다른 시간 공간을 섞는 조용한 버그가 된다.
3. **armLead 클램프는 하한 없이 상한(30s)만** — 원안의 `MIN_ARM_LEAD`는 ms 스케일 기존 테스트를 전부 깨뜨린다. `config.preOpenLeadMs` 자체가 최소 리드타임 역할을 한다.

`Dependencies.syncClock(config, signal): Promise<ClockEstimate>`를 `Dependencies.referenceClock(config): ReferenceClockPort` 팩토리로 교체(런마다 새 포트 — 이전 런 표본이 새 런에 섞이지 않게). `waitForOpen()`의 `finalClockSyncAt` 2단계 재보정 분기를 통째로 제거하고 armLead 1회 계산으로 대체.

죽은 코드 정리(별도 커밋): `clock-sync.ts`(구 버스트 메커니즘), `shared/clock.ts`의 `ClockMeasurement`/`ClockEstimate`/`createMeasurement`/`finalClockSyncAt`/`selectClockEstimate`를 grep으로 무사용 확인 후 제거.

## 5단계 — 3-프레임 텔레메트리

CLOCK_SYNCED 필드는 이미 4단계에서 구현 완료라, 5단계는 SLOT_DETECTED/SLOT_SELECTED에 `monoFromRunStartMs`(wall-clock 점프·기준시계 오차와 무관한 실제 경과)와 `clockConfidence`(그 순간 기준시계 신뢰도)를 추가하고, SLOT_SELECTED에 `arrivalToClickMs`(arrivalToDetectMs와 구분되는 응답→클릭 지연)를 추가하는 데 집중했다. `openDeltaMs`는 이미 기준시계 기반 델타라 `referenceOpenDelta`라는 별도 필드는 추가하지 않음(원안 명칭이 중복이었음, 구현 중 정정).

`trace-view.ts`의 CLOCK_SYNCED 렌더러도 새 estimate 모양(offset/uncertainty/confidence/RTT/경쟁 클러스터/armLead)에 맞게 재작성 — 4단계에서 옛 필드(clockMethod/clockPrecisionMs/clockSamples 등)가 사라져 표시가 깨져 있던 것을 고쳤다.

## 6단계 — 적대적 리뷰에서 실제 버그 2건 발견·수정

E2E는 `chrome-devtools` MCP 연결 해제로 이번 세션에서 수행하지 못했다(40-verification에 기록, 다음 세션 과제). 대신 코드를 다시 읽으며 적대적 리뷰를 했고, 진짜 버그 2건을 TDD로 잡았다(50-adversarial-review 상세):

1. **`stop()`이 진행 중인 fetch를 abort하면 매 런마다 unhandled promise rejection.** `sampleOnce`가 `TypeError`만 무해하게 취급했는데, abort는 `AbortError`(DOMException)라 재throw되어 fire-and-forget `start()` 프라미스가 매번 reject했다.
2. **FALLBACK 추정치가 `confidence:"LOW"`인데 `uncertaintyMs:0`.** armLead 산식이 uncertainty만 보므로 "시계를 전혀 모른다"가 armLead 계산에서 완전히 무시되고 있었다 — Tier 1의 핵심 안전장치(모호하면 일찍 감시)가 표본이 아예 없는 최악의 경우에 오히려 작동을 안 하는 역설이었다.

## 검증

`npm run check` 212/212 테스트 green, dist·독립성 게이트 통과. 실오픈 E2E는 미완료 — 다음 세션이 `use-chrome-devtools` 스킬로 이어간다.
