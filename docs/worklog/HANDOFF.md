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

## 다음 작업 — 6단계 E2E, 여기서 시작

**`chrome-devtools` MCP가 이번 세션에서 연결 해제되어 E2E를 수행하지 못했다.** 재연결되면(또는 사용자가 직접):

1. `use-chrome-devtools` 스킬로 확장 dist 재로드.
2. 안전 점검(dry-run) 실런 1회 → IndexedDB에서 3-프레임 필드(`monoFromRunStartMs`·`clockConfidence`·`clockUncertaintyMs`·`clockArmLeadMs` 등) 정상 기록 확인.
3. **실제 오픈 시각**에 실런 → 오픈 전 불필요 토글이 사라졌는지, 스큐가 있어도 estimate가 오염되지 않고 HIGH 또는 정직한 LOW+큰 uncertainty로 내리는지, openDelta가 이제 신뢰 가능한 프레임인지 확인.
4. 통과하면 `01-reference-clock-reliability/40-verification.md`를 "E2E 통과"로 갱신, site-behavior §8에 관측된 스큐 폭·빈도 기록.
5. main 병합.

이후: Tier 2(`02-availability-hot-path` — MAIN-world body 감지, claim guard), Tier 3(`03-runtime-resilience` — 탭 focus, SW reconcile, 실패 주입 테스트). 둘 다 현재 개요 스텁만 있음, Tier 1 실오픈 검증 후 착수.

## 검증

```bash
npm run check   # WSL: wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check"
git status --short --branch
```

212개 테스트와 전체 자동 게이트 통과.
