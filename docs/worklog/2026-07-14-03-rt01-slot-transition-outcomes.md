# RT-01 슬롯 클릭 전환 결과

## 목표

슬롯 DOM click 전달과 후속 예약 화면 도착을 분리하고 경합·unknown·timeout 결과를 구조화한다.

## 수행

1. `docs/specs/slot-transition-outcomes/`에 분석·설계·구현 계획을 작성하고 실패 테스트를 먼저 추가했다.
2. `SLOT_CLICK_DISPATCHED`, `SLOT_TRANSITION_CONFIRMED` 상태와 `slotTransitionOutcome` 계약을 추가했다.
3. `waitForSlotTransition()`이 행동 없이 화면을 inspect하고 기존 5초 deadline을 후속 자동 진행과 공유하게 했다.
4. 과거 `SLOT_SELECTED`는 저장 호환 표시용으로 남기고 새 전이에서는 제거했다.
5. 전체 자동 게이트, Chrome 확장 재로드, live 안전 실패와 수동 비최종 후속 화면 출현을 검증했다.
6. 적대적 리뷰에서 발견한 현재 상태 머신 문서 불일치를 수정했다.

## 결과

- 클릭 전달과 화면 도착이 상태·로그에서 구분된다.
- dispatch 전 후보 소실, unknown, timed out, confirmed가 서로 다른 outcome을 남긴다.
- 후속 자동 진행이 꺼져 있어도 화면 도착은 확인하지만 추가 선택은 하지 않는다.
- 어떤 상태도 서버 좌석 hold를 주장하지 않는다.
- 테스트: 229/229 통과
- live positive 상태 연속 로그는 달력 사전 판별 실패로 미확보했으며 검증 문서에 제한을 기록했다.

## 다음 작업

별도 브랜치에서 RT-10 cycle-correlated shadow timing 분석부터 진행한다.
