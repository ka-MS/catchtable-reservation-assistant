# HANDOFF

**갱신:** 2026-07-13
**브랜치:** `codex/tier1-reference-clock` (main에서 분기, main 대비 10커밋, 워킹트리 clean)
**작업 로그:** `docs/worklog/2026-07-13-02-tier1-reference-clock.md`

## 현재 상태 — Tier 1(기준시계 신뢰성) 코드 완료, E2E만 남음

`docs/specs/open-timing-performance/01-reference-clock-reliability/30-implementation.md`의 6단계 중 **1~5단계 전부 완료 + 적대적 리뷰에서 버그 2건 추가 수정**. `npm run check` 212/212 테스트 green, dist·독립성 게이트 통과.

- Estimator: 구간 최대피복 + 히스테리시스(`shared/clock.ts`)
- Rolling 샘플러: 부트스트랩 직후~토글 루프 진입 직전까지 관측(`content/reference-clock-sampler.ts`)
- 오케스트레이터: `Dependencies.referenceClock`(런마다 새 포트) + uncertainty 기반 armLead(`content/orchestrator.ts`)
- 3-프레임 텔레메트리: CLOCK_SYNCED(bootstrap/armed) + SLOT_DETECTED/SLOT_SELECTED(monoFromRunStartMs/clockConfidence/arrivalToClickMs), trace-view 렌더러 갱신
- 구 버스트 메커니즘(`clock-sync.ts` 등) 제거
- **버그 수정 2건**(리뷰 중 발견, 상세는 `01-reference-clock-reliability/50-adversarial-review.md`):
  1. `stop()`이 in-flight fetch를 abort하면 unhandled rejection이던 것
  2. FALLBACK 추정치의 `uncertaintyMs`가 0이라 "모른다"가 armLead에 반영 안 되던 것

## 상태 — Tier 1 코드 완료 + dry-run E2E 통과, main 병합 대기

dry-run E2E 통과(40-verification): 확장 재로드 후 실런에서 bootstrap→armed·rolling 개선·3-프레임 텔레메트리 정상 기록, dry-run 완결. **E2E에서 표시 버그 2건 추가 발견·수정**:
- `clockOffsetMs` epoch 스케일 → 카운트다운 "+20647일"(step4 회귀). wall 델타로 수정, 재검증 정상(`363a32e`).
- FALLBACK 앵커 붕괴(잠재) 동반 수정.

## 다음 작업

1. **main 병합** — Tier 1 코드+dry-run E2E 완료. 213 테스트 green.
2. **실제 오픈런 스큐 검증(자연 관측)** — dry-run은 이미 열린 매장이라 풀 스큐를 자극 못 함. 사용자 예약 잡(cho__kwang 7/14 00:00 등 다수 예정) 중 하나가 실행되면 IndexedDB에서 (a)오픈 전 토글 소멸 (b)estimate 스큐 미오염 (c)openDelta 프레임 정합 확인. 통과 시 site-behavior §8 스큐 폭·빈도 갱신.
3. Tier 2(`02-availability-hot-path`), Tier 3(`03-runtime-resilience`) — 개요 스텁만 있음.

## 검증

```bash
npm run check   # WSL: wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check"
git status --short --branch
```

212개 테스트와 전체 자동 게이트 통과.
