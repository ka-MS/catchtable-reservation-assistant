# HANDOFF

**갱신:** 2026-07-13
**브랜치:** `codex/tier1-reference-clock` (main에서 분기, main 대비 3커밋)
**작업 로그:** `docs/worklog/2026-07-13-01-open-timing-spec.md` (설계), 이 문서(구현 진행상황)

## 현재 상태 — Tier 1 구현 1~3단계 완료, 4단계 착수 직전

`docs/specs/open-timing-performance/01-reference-clock-reliability/30-implementation.md`의 6단계 TDD 중 **1~3단계가 이미 GREEN으로 커밋됨**(다른 세션이 진행하다 중단, 작업 유실 없음 — 워킹 트리 깨끗함):

```
b363092 feat: add interval max-coverage reference clock estimator   (1단계)
b5d04b1 feat: add hysteresis against skew-cluster jumps              (2단계)
f36599f feat: add rolling reference clock sampler                    (3단계)
```

- `src/shared/clock.ts`: `ReferenceClockSample`·`ReferenceClockEstimate`·`estimateReferenceClock`(구간 최대피복 + 히스테리시스) 추가. 기존 `selectClockEstimate`(구 버스트용)는 그대로 유지(아직 배선 중이라 병존).
- `src/content/reference-clock-sampler.ts` 신규: `ReferenceClockSampler`(`sampleOnce`/`ingest`/`start`/`stop`/`latest`).
- `npm run check`: **222/222 테스트 green**, dist·independence 통과 (직접 재확인함).

## 다음 작업 — 4단계(오케스트레이터 통합)부터, 여기서 시작

**먼저 읽을 것: `20-design.md` §3·§4의 "(구현 중 확정)" 섹션과 `30-implementation.md` 4단계 — 이번 세션에서 실제 코드(`orchestrator.ts`) 대조로 원안을 구체화·정정했다. 아래는 그 요지.**

### 원안에서 바뀐 것 3가지 (반드시 반영)

1. **샘플러 시작 시점 정정.** 원안 "WAITING_FOR_OPEN 진입 시 시작"이 아니라 **`syncInitialClock`의 단일 부트스트랩 표본 직후부터 시작**해 `prepareEntry`~`confirmPageReady`를 관통, **`waitForOpen()`의 armLead 대기가 풀리는 순간(REFRESHING_SLOTS 진입 직전) 정지**. 이유: `prepareEntry` 등의 상대 데드라인(`serverClock.now()+5000`)이 앵커 없이 돌면 안 되고(부트스트랩 없이 방치 시 `MonotonicEpochClock`이 raw monotonic 값을 epoch처럼 반환하는 버그), 이 구간을 관측 시간으로 공짜로 쓰면 confidence가 좋아진다.
2. **⚠️ 앵커 재계산 단위 버그 주의.** `ReferenceClockSample.t0/t1`은 **monotonic** epoch다. 재앵커는 `serverClock.anchor(this.deps.monotonicClock.now() + estimate.offsetCenterMs)`여야 한다 — 옛 코드 패턴(`this.deps.clock.now() + this.offsetMs`, wall clock 기반)을 그대로 베끼면 서로 다른 시간 공간을 더하는 조용한 버그가 된다. **이게 이번 세션에서 잡은 핵심 버그.**
3. **armLead 클램프 하한 제거.** 원안의 `MIN_ARM_LEAD`·`toggleRenderMarginMs`를 빼고 `armLeadMs = min(30_000, preOpenLeadMs + uncertaintyMs + p95RttMs)`로 단순화. 하한 clamp를 넣으면 ms 스케일 기존 테스트가 전부 깨진다. 이 형태여야 `uncertaintyMs:0, p95RttMs:0` 고정 fake 주입 시 `armLeadMs === preOpenLeadMs`로 수렴해 **무수정 통과 가드**가 성립한다.

### 4단계 체크리스트 (30-implementation.md에 코드 스켈레톤 전부 있음)

- [ ] `ReferenceClockPort` 인터페이스 신설(`reference-clock-sampler.ts`), `ReferenceClockSampler implements ReferenceClockPort`
- [ ] `Dependencies.syncClock` → `Dependencies.referenceClock: ReferenceClockPort` 교체
- [ ] `syncInitialClock()` 재작성 — 단일 부트스트랩 표본 + `applyReferenceClockEstimate()` + 샘플러 fire-and-forget 시작
- [ ] `waitForOpen()` 재작성 — `finalClockSyncAt` 분기 전체 삭제, armLead 1회 계산 + `referenceClock.stop()`
- [ ] `content/index.ts` 배선 교체(`syncServerClock` → `createReferenceClockSampler`)
- [ ] 테스트 하네스(`tests/orchestrator.test.mjs`) `syncClock` fake → `referenceClock` fake(기본값 `uncertaintyMs:0, p95RttMs:0, confidence:"HIGH"`)
- [ ] **재작성(무수정 예외):** `"long waits resynchronize the server clock shortly before opening"` — 옛 2단계 재보정 전용, 새 동작(armed 메트릭 1회 + 샘플러 rolling 갱신)에 맞게 교체
- [ ] 신규 테스트 3개(30-implementation 참고): 고정 estimate→무수정 통과, uncertainty 크면 더 이른 진입, `stop()` 정확히 1회

이후 5단계(3-프레임 텔레메트리), 6단계(E2E+실오픈 검증+40/50 문서). 그다음 Tier 2/3.

## 검증

```bash
npm run check   # WSL: wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check"
git status --short --branch   # 현재: codex/tier1-reference-clock, 워킹트리 clean
```

222/222 테스트 green, dist·independence 게이트 통과(4단계 착수 직전 기준 재확인함).
