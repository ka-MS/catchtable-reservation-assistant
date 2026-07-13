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

- `npm run check` 통과 — 단위·fixture 테스트 213개, `dist`·모듈 독립성 검증 통과
- 브랜치 `codex/tier1-reference-clock`, main 대비 커밋 다수(estimator·히스테리시스·샘플러·오케스트레이터 통합·죽은 코드 제거·3-프레임 텔레메트리·버그 수정 4건)

## E2E (dry-run) — 통과 (2026-07-13, 이시즈에)

DevTools MCP로 확장 dist 재로드 → 안전 점검(dry-run) 실런 수행. IndexedDB(`catchtable-reserve-telemetry`) 판독:

- **bootstrap→armed 전이 정상**: armLead 790ms 계산, rolling 샘플러가 ~60초 대기 중 confidence를 LOW(표본 2)→MEDIUM(감지 시점)으로 개선.
- **3-프레임 텔레메트리 기록**: `monoFromRunStartMs`(57418, 실경과 ~57s와 일치), `clockConfidence`(MEDIUM), `arrivalToDetectMs`(120).
- **dry-run 완결**: DRY_RUN_COMPLETED, 18이벤트, 슬롯 클릭 없음.

### E2E에서 잡은 버그 2건 (수정 완료)

1. **카운트다운 "오픈 경과 +20647일" (표시 회귀).** step 4에서 `clockOffsetMs`를 `offsetCenterMs`(= server−monotonic, epoch 스케일 ~1.78e12)로 별칭했는데, 사이드패널 카운트다운은 `Date.now() + clockOffsetMs`를 계산하므로 폭주했다. `clockOffsetMs`를 wall-clock 델타(server−Date.now(), ~수백 ms)로 되돌리고 `clockOffsetCenterMs`를 진단용으로 분리(`363a32e`). 재검증에서 `clockOffsetMs`=868ms, 카운트다운 "오픈까지 8:55:27"로 정상 확인.
2. **FALLBACK 앵커 붕괴 (잠재).** FALLBACK 추정치는 `offsetCenterMs=0`이라 `monotonic+0`으로 앵커하면 serverClock이 작은 monotonic 값으로 고정돼 이후 모든 서버시각이 깨진다. FALLBACK일 때 `wall−monotonic`으로 앵커해 serverClock이 로컬 wall로 폴백하게 수정.

### 미완료: 실제 오픈런 스큐 검증

dry-run은 이미 열린 매장(이시즈에) 대상이라 서버 풀 스큐를 자극하지 못한다. **실제 미개장 매장의 오픈 시각** 실런에서 (a) 오픈 전 불필요 토글 소멸, (b) estimate가 스큐를 물지 않고 정직한 confidence/uncertainty로 내리는지, (c) openDelta가 진짜 프레임과 정합하는지 확인이 남아 있다. 사용자의 예약 잡(여러 개 예정) 중 하나로 자연 관측 가능. 확인되면 site-behavior §8에 스큐 폭·빈도 갱신.
