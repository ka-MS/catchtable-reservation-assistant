# Actual-open analysis and RT-05 decision

**날짜:** 2026-07-15
**브랜치:** `codex/live-run-analysis-probe-decision`

## 목적

2026-07-14·15 actual-open 26건을 재현 가능하게 집계하고, 공식 p95와 XHR wake 이득이 아직 부족한 상태에서도 RT-05 운영 정책을 확정해 Tier 2-2를 종료한다.

## 분석

- `scripts/analyze-live-runs.mjs`로 모든 `run.csv`를 동일 규칙으로 집계했다.
- 26/26 dropped 0, eventCount와 seq 연속, 설정 범위 밖 클릭 0을 확인했다.
- 신뢰 가능한 POPULATED body 20건, 설정 범위 일치 body와 슬롯 감지·클릭 19건이다.
- 2026-07-15 참고용 오픈→클릭 p50은 `+1127ms`, 감지→dispatch p50은 `14ms`다.
- wake 수락은 7건이고 모두 후보를 찾았지만, 기존 25ms loop 대비 절감량을 계산할 counterfactual 시각이 없다.
- 사용자 확인 성공 누와·키이로·윤주당은 모두 `inactive_cycle` body를 버리고 DOM fallback으로 클릭했다.

## 결정과 구현

- probe를 제거하지 않고 진단·실험 전용으로 유지했다.
- `availabilityProbeEnabled` 기본값과 구버전 누락값을 `false`로 정했다.
- 비활성 실행은 MAIN bundle 주입을 호출하지 않는다.
- 활성 실행만 probe와 wake channel을 설치하며 실패 시 DOM fallback을 유지한다.
- Side Panel 고급 설정에 기본 꺼짐인 `XHR 응답 진단`을 추가했다.

## 판정

RT-05 완료 조건을 충족해 Tier 2-2를 종료한다. XHR wake 성능 이득과 공식 p95는 미입증이며, counterfactual metric과 동질 표본 확보를 후속 non-blocking 측정으로 남긴다.

## 검증

- `npm run check`: 301/301 tests
- typecheck, dist validation, MAIN/ISOLATED independence 통과
- 비활성 probe 주입 0회, 활성 MAIN bundle 주입, 주입 실패 fallback 테스트 통과
- 26건 evidence 집계 불변식과 변경 문서 local link 검사 통과

상세:

- `docs/specs/open-timing-performance/02-availability-hot-path/70-live-run-analysis.md`
- `docs/specs/open-timing-performance/02-availability-hot-path/80-probe-final-decision.md`
