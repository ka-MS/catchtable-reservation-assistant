# Tier 3 오픈 전 준비 복원력 분석 보강

**날짜:** 2026-07-16
**범위:** 문서 분석과 evidence 판정 보강. 코드·런타임 설정 변경 없음.

## 배경

목란 같은 탭에서 새로고침 없이 예약 달력만 닫고 수동 실행을 반복했을 때 `목표 월 또는 날짜 선택 상태를 제한 시간 안에 확인할 수 없습니다.` 세 건과 `예약하기 클릭 후 달력 화면을 확인할 수 없습니다.` 한 건이 수집됐다.

초기 분류는 달력 호환성 진단이었지만 evidence와 현재 코드를 대조하면 목표 날짜 DOM은 정상 판독됐다. 직접 실패는 예약 CTA 또는 날짜 클릭 뒤 기대한 UI 전이가 확인되지 않았고 준비 단계에 bounded recovery가 없었다는 것이다.

## 반영

- `docs/analysis/site-behavior.md`: 목란 네 실행의 DOM·전환 관찰 사실과 미확정 원인을 단일 원본으로 기록
- `docs/specs/open-timing-performance/03-runtime-resilience/10-analysis.md`: 오픈 전 준비 단계 경계, 실패 분류, 복구 방향, 진단 계약과 성공 기준 추가
- `docs/specs/open-timing-performance/open-timing-performance-analysis.md`: Tier 3 우산 범위에 CTA·날짜·인원 준비 복원력 추가
- `docs/plans/next-development.md`: RT-16에 날짜 선택 전환 정지와 2026-07-16 입력 추가
- `docs/evidence/live-runs/2026-07-16/README.md`: 달력 호환성에서 날짜 준비 전환 실패로 판정 정정

## 코드 대조 결론

- 동일 식당 URL의 수동 재시작은 Background navigation을 생략하므로 같은 SPA 문서 상태를 이어 쓸 수 있다.
- `prepareEntry()`는 CTA 클릭 뒤 달력 출현을 기다리지만 CTA 재클릭 또는 재진입 recovery가 없다.
- `CalendarAdapter.prepareTarget()`은 목표 날짜를 한 번 클릭하고 `pendingDate`가 설정되면 선택 상태가 바뀔 때까지 waiting만 반환한다. 실행마다 `RunSession`은 새로 생기지만 Adapter는 같은 문서에서 재사용되므로 동일 목표일의 pending 상태가 후속 실행에도 남는다.
- `preparePerson()`도 한 번의 선택 dispatch 뒤 후조건을 기다리는 동일 정책 형태다.
- 이 구간은 슬롯 탐색 hot path 이전이므로 Tier 2-2/RT-14의 25ms cycle·claim 정책과 분리한다.

## 보류

- 포커스 상실을 직접 원인으로 확정하지 않는다. 현재 snapshot은 종료 순간만 설명한다.
- 날짜·CTA·인원별 retry 횟수와 deadline은 설계하지 않았다.
- 자동 새로고침은 최종 복구 후보로만 기록하고 승인하지 않았다.
- 코드와 테스트는 변경하지 않았다.

## 검증

- 네 run의 CSV action/state와 failure snapshot을 다시 대조했다.
- `git diff --check`와 문서 링크·상태 표현을 확인한다.

## 후속 문서 정합화

- Tier 2-2를 전체 성능 완료로 읽지 않도록 `REDUCE 기능·안전 범위 종료`와 `성능 이득·공식 p95 미입증`을 분리했다.
- stale 상태였던 `02-control-activation/10-analysis.md`에 현재 `AvailabilityDomWake` 구현, 미승인 GO/MutationObserver 경로와 남은 성능 판정을 반영했다.
- 런타임 복구에 중복 사용하던 RT-11을 RT-16으로 변경했다. RT-11은 공식 p95·wake counterfactual 측정, RT-15는 원시 시계 표본 trace 기록으로 유지한다.
