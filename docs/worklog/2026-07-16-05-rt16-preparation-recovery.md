# RT-16 오픈 전 준비 복원력 구현

**날짜:** 2026-07-16
**상태:** 부분 구현, 구조화 미완료 — 현행 retry·상태 격리 검증 완료

## 패키지

- RT-16A: Background run context와 Content 준비 단계 change-based trace
- RT-16B: CalendarAdapter preparation state 실행 간 reset
- RT-16C: CTA·날짜·인원 총 2회 bounded dispatch와 구조화 handoff

## 구현 결과

- `PREPARATION_OBSERVED`에 stage/phase/action/attempt/recovery decision을 기록한다.
- 클릭 시점 visibility, focus, viewport, active element, fingerprint와 START 시점 tab/window 문맥을 결합한다.
- 동일 목표 날짜의 `pendingDate`가 다음 RunSession에 누출되지 않는다.
- CTA가 discovery deadline 근처에 나타나도 클릭 뒤 confirmation budget 없이 즉시 종료하지 않는다.
- CTA·날짜·인원 전환 불변은 1초 뒤 한 번만 재시도하고 총 2회에서 handoff한다.
- 자동 새로고침, 탭 focus, SW reconcile과 Tier 2 hot path는 변경하지 않았다.

## 범위 재판정

- 검증된 동일 행동 retry와 CalendarAdapter 상태 초기화는 폐기하지 않고 후속 책임 구조화에서 준비 행동 구현체로 이동한다.
- Adapter 사실 반환, 실패 원인 분류, 복구 정책, 행동 실행, telemetry 책임은 아직 분리되지 않았다.
- 동일 탭 URL 재진입은 구조화 후 `RESET_PAGE` 복구 행동으로 연결한다.
- 따라서 이 작업 로그는 RT-16 전체 완료 근거가 아니라 부분 구현·검증 기록이다.

## 검증

- 실제 `CalendarAdapter`와 동일 `OpenRunOrchestrator`를 재사용한 두 연속 실행에서 첫 handoff 상태가 다음 실행에 누출되지 않고 `DRY_RUN_COMPLETED`까지 진행
- 전체 `npm run check`: typecheck, `336/336` tests, dist, MAIN/ISOLATED independence 통과
- `git diff --check` 통과
- Chrome에서 같은 tabId `494281626`에 날짜 click 정체를 주입해 `run-e2a5c932`가 attempt 2 `DATE_SELECTION_STALLED`로 인계되는 것을 확인
- 달력만 닫고 무새로고침 재시작한 `run-40f9f982`가 독립 날짜 dispatch로 8/20을 선택하고 `DRY_RUN_COMPLETED`에 도달
- 두 run 모두 IndexedDB eventCount 일치, seq 연속, dropped 0이며 준비 event의 tab/window/focus/visibility 필드 확인

## Chrome live 판정

확장 `0.2.0`을 최신 `dist`에서 reload한 동일 탭 E2E를 통과했다. 첫 실행의 bounded handoff, 두 번째 실행의 상태 격리와 정상 슬롯 탐색, Side Panel 표시, IndexedDB 정합성, Console 무오류를 확인했다. 날짜 정체는 의도적으로 주입한 표본이므로 1초 retry의 성능 근거로는 사용하지 않는다.
