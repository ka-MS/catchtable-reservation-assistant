# Tier 1 — 기준시계 신뢰성 검증

## 자동 검증

- 구간 최대피복 추정: 단일 깨끗한 풀 → HIGH, 좁은 스팬 → MEDIUM, 표본 0개 → FALLBACK
- 스큐 60%(다수 오염) → LOW confidence(자신 있게 오염 클러스터를 고르지 않음)
- 50:50 모호 → LOW, 유령 겹침(가장자리 스침) 타이브레이크로 배제
- 극단 RTT 이상치는 median×3 필터로 제거되어 별도 클러스터를 만들지 않음
- 소수 스큐 하나(강한 다수 대비)는 confidence를 LOW로 끌어내리지 못함(MEDIUM 유지)
- 히스테리시스: 직전 HIGH일 때 근소한 스큐 버스트는 이전 클러스터 유지, 강한 다수(≥2×)는 정상 갱신
- 캐시 표본(`Age>0`) 제외
- Rolling 샘플러: 표본마다 estimate 재계산·방출, 버퍼 상한 초과 시 오래된 표본 제거, `observationSpanMs` 반영
- 오케스트레이터 통합:
  - 고정(`uncertaintyMs:0, p95RttMs:0`) estimate 주입 시 기존 토글 그리드 타이밍 단언 **전부 무수정 통과**(폴백 가드)
  - `uncertaintyMs` 클 때 armLead 계산이 `preOpenLeadMs + uncertaintyMs + p95RttMs`로 정확히 늘어남
  - CLOCK_SYNCED가 `bootstrap`→`armed` 정확히 2회, 각 phase 필드(offset/uncertainty/confidence/support/RTT/span/source) 전달
  - 부트스트랩 실패 시 `source:"FALLBACK"`로 정직하게 표시하고 **armLead가 MAX_ARM_LEAD_MS(30s)로 클램프**됨(회귀 테스트, §리뷰 참고)
  - SLOT_DETECTED/SLOT_SELECTED가 `monoFromRunStartMs`(wall-clock 점프에 불변)·`clockConfidence`·`arrivalToClickMs`(arrivalToDetectMs와 구분) 전달
  - `referenceClock.start()`가 부트스트랩 직후 1회, `stop()`이 토글 루프 진입 직전 정확히 1회(안전망과 중복 없음)
  - 롤링 업데이트가 대기 중 anchor를 즉시 갱신(다음 emit의 `serverAt`에 반영)
- `ReferenceClockSampler`: HEAD 표본을 Date/RTT/캐시 여부로 정확히 조립, `stop()`이 in-flight fetch를 abort해도 `start()` 프라미스가 reject하지 않음(회귀)
- trace-view CLOCK_SYNCED 상세: offset/uncertainty/confidence/표본/RTT/경쟁 클러스터/armLead 렌더, FALLBACK 소스 표시

## 완료 게이트

```bash
npm run check
git status --short --branch
```

## 결과

- `npm run check` 통과 — 단위·fixture 테스트 212개, `dist`·모듈 독립성 검증 통과
- 브랜치 `codex/tier1-reference-clock`, main 대비 커밋 10개(estimator·히스테리시스·샘플러·오케스트레이터 통합·죽은 코드 제거·3-프레임 텔레메트리·버그 수정 2건)
- **미완료: 실오픈 E2E 검증.** `chrome-devtools` MCP가 이 세션에서 연결 해제되어 확장 재로드·라이브 실런을 수행하지 못했다. 다음 세션(또는 사용자 직접 실런)에서:
  1. 확장 dist 재로드 → 연습(dry-run) 실런으로 3-프레임 로그·estimate 필드가 IndexedDB에 정상 기록되는지 확인.
  2. 실제 오픈 시각에 돌려 오픈 전 불필요 토글이 사라졌는지, estimate가 스큐를 물지 않고 HIGH 또는 충분한 uncertainty로 정직하게 내리는지, openDelta가 (더 이상 오염되지 않은) 진짜 프레임과 정합하는지 확인.
  3. 확인되면 site-behavior §8에 관측된 스큐 폭·빈도를 갱신하고 이 문서를 "E2E 통과"로 업데이트.
