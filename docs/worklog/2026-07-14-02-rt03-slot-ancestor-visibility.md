# RT-03 슬롯 조상 가시성

## 목표

숨겨진 캐러셀 조상 아래의 슬롯 복제본이 후보와 클릭 대상에 포함되는 결함을 수정한다.

## 수행

1. `docs/specs/slot-ancestor-visibility/`에 분석·설계·구현 계획을 작성하고 backlog를 `PROMOTED`로 승격했다.
2. 숨겨진 조상 아래 고유·중복 슬롯 fixture를 추가해 읽기와 클릭 테스트가 실패하는 것을 확인했다.
3. `SlotAdapter.readSlots()`에 기존 공용 `isElementHidden()`을 연결했다.
4. 전체 자동 게이트, live 비파괴 DOM 확인, hot-path 반복 비용 측정을 수행했다.
5. 적대적 리뷰에서 차단 finding이 없음을 확인했다.

## 결과

- 코드 변경: 공용 helper import와 필터 조건 교체
- 테스트: 228/228 통과
- live 케아: 20개 중 가시 7개, 숨겨진 복제 13개 분리
- 새 필터 비용: 약 0.283ms/scan
- 날짜 토글, XHR shadow, 오케스트레이터 상태 변경 없음

## 다음 작업

RT-01 슬롯 클릭 dispatch와 후속 화면 전환 확인을 분리한다. 이후 RT-10 cycle correlation으로 진행한다.
