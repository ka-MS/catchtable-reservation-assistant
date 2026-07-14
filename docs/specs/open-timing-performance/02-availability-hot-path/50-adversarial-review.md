# Tier 2-2 - 적대적 리뷰

**리뷰일:** 2026-07-14
**대상:** body wake coordinator, toggle scan loop, SlotAdapter portal 대응, trace와 fallback

## 1. 결론

해결되지 않은 P0/P1 finding은 없다. body는 scan wake-up에만 사용되고, 후보 선택과 클릭 직전 검증은 계속 DOM `SlotAdapter`가 소유한다. 관측 경로가 실패하거나 body가 없으면 기존 bounded DOM 경로로 돌아간다.

## 2. 발견 및 수정

### F1. body 직후 다음 토글이 DOM render window를 잘라낼 수 있음

**심각도:** P1
**상태:** 수정 완료

body가 cycle 경계 직전에 도착하면 기존 grid deadline이 먼저 끝나 다음 인접 날짜 클릭이 body에 대응하는 DOM 렌더를 덮을 수 있었다. accepted body가 있으면 해당 cycle만 `bridge + 250ms`까지 유지하되 `stopAt`을 넘지 않도록 수정했다. 150ms 뒤 DOM이 나타나는 회귀 테스트에서 다음 토글 없이 첫 cycle이 성공함을 확인했다.

### F2. 예약 drawer 슬롯이 `main` 밖 portal에 존재함

**심각도:** P1
**상태:** 수정 완료

실제 Chrome에서 활성 슬롯은 `main` 밖에 있고, `main` 아래 복제본은 hidden 조상 아래 있었다. `main button[data-busy]`는 body wake를 수용하고도 후보를 항상 0개로 반환했다.

fixture를 먼저 추가해 실패를 재현한 뒤 selector를 `button[data-busy]`로 넓혔다. 조상 가시성, busy, disabled, detached, 중복 제거와 클릭 직전 재조회는 유지했다. 최종 live에서 portal 18:30 후보를 감지하고 dry-run 클릭 0회를 확인했다.

### F3. 20ms settling 제거는 실제 stale DOM 안전 근거가 없음

**심각도:** P1
**상태:** 수정 완료

즉시 selected인 단위 fixture만으로 React가 이전 날짜 슬롯 DOM을 남기지 않는다고 증명할 수 없다. 고정 20ms를 복원하고 회귀 테스트로 잠갔다. 40ms switch lead와 60ms confirmation cap도 p95 근거가 없어 유지했다.

### F4. wake 결과 trace exporter 예외가 제어 경로로 전파될 수 있음

**심각도:** P2
**상태:** 수정 완료

`wake_result` trace를 전용 예외 경계로 감싸고, exporter가 throw해도 baseline과 terminal state, 날짜 클릭, 슬롯 클릭 수가 동일한 테스트를 추가했다.

## 3. 안전 불변식 재확인

- WEAK/NONE, stale, old cycle, duplicate, malformed는 wake하지 않는다.
- 날짜·인원과 설정 시간 범위가 일치하지 않으면 wake하지 않는다.
- body가 선택한 분 값은 클릭 입력으로 전달되지 않는다.
- wake가 실패하거나 DOM 후보가 없으면 기존 25ms 탐색과 다음 토글이 계속된다.
- DOM 후보가 사라지면 `clickSlot()` 재조회에서 클릭하지 않는다.
- dry-run은 `advanceFromSlot()` 경계에서 종료하고 슬롯을 클릭하지 않는다.
- 결제, 약관, 최종 예약 자동화는 추가하지 않았다.

## 4. 잔여 위험

1. RT-10M 실제 오픈 `EMPTY -> POPULATED` 표본이 없어 성능 이득과 p50/p95를 알 수 없다.
2. Catchtable이 `data-busy` 계약이나 portal 구조를 바꾸면 SlotAdapter fixture와 live 재검증이 필요하다.
3. `PerformanceResourceTiming`만으로는 취소된 인접 요청과 target 요청을 구분할 수 없어 body correlation이 계속 필수다.
4. RT-05에서 MAIN XHR probe의 최종 운영 정책을 결정해야 Tier 2-2를 종료할 수 있다.
5. 20/40/60ms는 실측 p95가 확보될 때까지 최적화 대상이 아니라 안전 상한으로 남는다.

## 5. 최종 판정

구현은 fallback 보존형으로 승인한다. 상태는 **RT-10M 재측정 대기**이며, 성능 완료 또는 Tier 2-2 최종 종료로 판정하지 않는다.
