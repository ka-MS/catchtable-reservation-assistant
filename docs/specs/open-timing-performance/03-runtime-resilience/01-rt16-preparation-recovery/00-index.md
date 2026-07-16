# RT-16 — 오픈 전 준비 복원력

**상태:** 구현 진행
**부모:** `../10-analysis.md`

## 목표

예약 CTA·날짜·인원 준비를 `dispatch -> confirm -> classify -> bounded recovery -> handoff`로 구조화하고, 같은 탭에서 새로고침 없이 반복 실행해도 이전 실행 상태가 누출되지 않게 한다.

Tier 2 슬롯 탐색 hot path의 interval, wake, EMPTY 조기 종료와 click claim은 변경하지 않는다.

## 하위 패키지

1. [RT-16A 준비 단계 관측성](01-rt16a-observability/10-design.md)
2. [RT-16B 실행 간 상태 격리](02-rt16b-state-isolation/10-design.md)
3. [RT-16C bounded recovery](03-rt16c-bounded-recovery/10-design.md)

## 종료 gate

- 동일 탭·동일 목표 날짜 반복 실행에서 stale pending 상태가 누출되지 않는다.
- CTA·날짜·인원 dispatch와 후조건, retry, handoff를 trace로 재구성할 수 있다.
- CTA·날짜·인원 retry 횟수와 전체 준비 시간이 제한된다.
- 인증·대기열·알 수 없는 DOM은 자동 반복하거나 새로고침하지 않는다.
- Tier 2 hot-path 회귀 테스트와 전체 프로젝트 gate를 통과한다.
