# 슬롯 클릭 전환 결과 구현 계획

1. 상태 머신과 오케스트레이터 테스트를 새 의미로 작성해 실패를 확인한다.
2. `RunState`와 상태 전이·사이드패널 매핑을 추가한다.
3. `waitForSlotTransition()`과 구조화 outcome을 구현한다.
4. `advancePostSlot()`이 확인된 첫 inspection과 기존 deadline을 이어받게 한다.
5. 단위·전체 자동 게이트와 live 비최종 예약 흐름을 검증한다.
6. 적대적 리뷰 뒤 backlog·worklog·HANDOFF를 갱신한다.

## 변경 예상 파일

- `src/shared/types.ts`
- `src/shared/state-machine.ts`
- `src/content/orchestrator.ts`
- `src/sidepanel/index.ts`
- 관련 상태 머신·오케스트레이터·표시 테스트
