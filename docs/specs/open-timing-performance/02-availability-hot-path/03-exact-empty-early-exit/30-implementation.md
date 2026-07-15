# RT-14 구현 계획

**상태:** 완료. 자동·Chrome 검증은 [40-verification.md](40-verification.md), 적대적 검토는 [50-adversarial-review.md](50-adversarial-review.md)에 기록한다.

## Task 1 - 설정과 UI 계약

테스트 먼저:

- legacy false/누락 → off
- legacy true → observe
- current mode 우선
- 잘못된 mode validation
- FormValues 왕복
- saved config와 scheduled job 마이그레이션

구현:

- `AvailabilityProbeMode`와 resolver
- 3상태 segmented radio
- Background probe 설치 조건 변경

## Task 2 - EMPTY 신호

테스트 먼저:

- current `EXACT EMPTY + allow` → `empty_exit`
- observe mode EMPTY → `no_matching_slot`
- `STRONG EMPTY` 거부
- inactive/stale/duplicate/malformed 거부
- in-flight 25ms wait 해제
- POPULATED scan wake 회귀

구현:

- discriminated `AvailabilityWakeSignal`
- classification과 allow flag가 포함된 offer 계약

## Task 3 - cycle 조기 종료

테스트 먼저:

- EMPTY 도착 후 다음 cycle target click이 앞당겨짐
- 같은 iteration에 DOM 후보가 생기면 슬롯 우선
- 목표 날짜 selected 해제 시 fallback 계속
- observe/off는 기존 cadence 유지
- cycle 결과와 trace 필드
- stop/timeout 회귀

구현:

- scan-first signal consumption
- `EMPTY_EARLY_EXIT` retry
- 구조화 결과 trace

## Task 4 - 검증

- 대상 테스트
- 전체 `npm run check`
- `npm run analyze:rt14` 재현
- `git diff --check`
- Chrome 확장 재로드
- Side Panel mode 저장·복원·legacy draft 확인
- 이미 열린 매장에서 observe/empty_exit 실행 회귀

실제 성능 판정은 정상 크기 전면 창의 비중요 실제 오픈에서 수행한다. 자동 테스트와 이미 열린 슬롯은 안전성만 검증하며 성능 성공으로 기록하지 않는다.

## 구현 결과

- `AvailabilityProbeMode = off | observe | empty_exit`와 legacy boolean 마이그레이션을 추가했다.
- Background는 `off`가 아닐 때만 MAIN probe를 설치한다.
- current active cycle의 `EXACT EMPTY`만 `empty_exit` 신호로 수용한다.
- 오케스트레이터는 최초 DOM scan, 목표 날짜 선택 guard, 최종 DOM scan 순서로 후보 우선권을 보존한다.
- observe/off, POPULATED wake, 25ms fallback, `nextTogglePlan()`, stop/timeout 계약은 유지한다.
