# 01 신형 달력 DOM 호환 구현 계획

1. 실측 구조를 축약한 `calendar-mobiscroll.html` fixture를 추가한다.
2. Entry와 Calendar 실패 테스트를 먼저 추가하고 실패를 확인한다.
3. `calendar-dom.ts` 공유 reader를 구현한다.
4. Entry와 Calendar를 공유 reader로 전환한다.
5. 구형·신형 관련 테스트와 전체 게이트를 실행한다.
6. 실제 야키토리묵 모달에서 DOM 판독 결과를 확인한다.
7. 적대적 리뷰 후 발견 사항을 수정하고 재검증한다.
