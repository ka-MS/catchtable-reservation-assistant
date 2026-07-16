# RT-16 적대적 검토 — 오픈 전 준비 복원력

## 결론

준비 단계에만 한정하고 총 dispatch 2회, 기존 stopAt과 명시적 handoff를 유지한 구현을 수용한다. Tier 2 슬롯 탐색 상수·wake·EMPTY·claim 코드는 변경하지 않았다.

## 공격 시나리오와 방어

| 시나리오 | 결과 |
|---|---|
| 이전 실행의 동일 날짜 pending 누출 | 새 auto run의 날짜 준비 시작에서 전체 preparation state reset |
| CTA가 단계 deadline 직전에 처음 나타남 | discovery와 dispatch 후 confirm deadline을 분리해 즉시 handoff하지 않음 |
| CTA·날짜·인원 클릭 후 UI 불변 | 1초 뒤 한 번만 재해석·재클릭, 총 2회 후 handoff |
| 두 번째 클릭 뒤에도 불변 | 구조화 stall code와 attempt 2 기록 |
| promo가 첫 CTA 클릭을 삼킴 | promo dismiss 후 남은 1회 CTA dispatch 사용 |
| waiting-only 또는 인원 unavailable | retry 없이 기존 안전 handoff |
| stopAt 인접 복구 | loop 최상단 stopAt이 우선하고 budget이 stopAt을 넘지 않음 |
| 진단 캡처·trace 실패 | 예외 격리, 준비 결과와 예약 제어 유지 |
| 준비 trace가 hot path를 느리게 함 | `WAITING_FOR_OPEN` 이전 change-based event로 제한, slot loop에는 호출 없음 |

## 리뷰 중 수정·고정한 결함

기존 entry deadline은 stage 시작부터 5초로 고정돼 CTA가 늦게 나타난 경우 클릭 직후 같은 loop에서 즉시 handoff할 수 있었다. CTA 발견 budget과 클릭 후 confirmation budget을 분리했다.

CalendarAdapter의 `pendingDate`는 목표 날짜가 같으면 실행 경계에서 초기화되지 않았다. 명시적 `resetPreparation()`을 추가하고 auto run마다 호출해 같은 SPA 문서의 상태 누출을 제거했다.

구조화 오류 code가 trace decision에만 있고 terminal event에는 빠지는 문제를 피하기 위해 handoff data에도 error code, attempt count와 recovery decision을 포함했다.

## 잔여 위험

1. 1초 retry 기준은 실측 p95가 아니라 보수적 bounded 정책이다. 느린 UI에서 최초 동작이 뒤늦게 완료되는 순간 두 번째 클릭이 겹칠 수 있다. 다만 대상 노드를 매번 재해석하고 CTA가 사라지거나 날짜·인원 후조건이 충족되면 재클릭하지 않는다.
2. tab active/window focused는 START 시점 스냅샷이다. 실행 중 변화는 각 event의 Content `visibilityState`와 `hasFocus()`로 판독하며 Background 현재값으로 해석하면 안 된다.
3. 구조 fingerprint 캡처는 준비 단계의 저빈도 DOM scan이다. 슬롯 hot path에는 없지만 매우 큰 준비 DOM에서는 소량의 사전 비용이 생길 수 있다.
4. 인증·대기열의 일반 분류기는 아직 없다. 현재 확인된 waiting-only와 명시적 blocked 이외의 unknown은 자동 복구하지 않고 기존 진단 handoff로 남는다.
5. 자동 URL 재진입은 책임 구조화 후 복구 정책의 `RESET_PAGE` 행동으로 연결해야 한다. 탭 강제 focus와 Service Worker reconcile은 별도 Tier 3 패키지다.
6. 실제 동일 탭 Chrome E2E에서 날짜 click 2회를 차단해 `DATE_SELECTION_STALLED`를 재현했다. 달력만 닫고 차단을 제거한 무새로고침 재시작은 같은 tabId에서 독립 날짜 dispatch로 복구됐다. 실제 사이트 변화로 자연 발생한 정체 표본은 아니므로 retry 1초의 운영 p95 근거로 사용하지 않는다.

## 판정

현행 코드, 동일 탭 반복 실행 통합 회귀, 전체 자동 gate와 확장 reload 후 Chrome live E2E는 부분 구현의 근거로 수용한다. 책임 구조화와 자동 URL 재진입이 남아 있으므로 RT-16을 완료로 종료하지 않는다.
