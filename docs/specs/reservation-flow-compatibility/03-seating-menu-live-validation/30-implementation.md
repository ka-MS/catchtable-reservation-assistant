# 03 RT-07 복합 좌석·메뉴 실제 검증 구현

상태: 완료

## 변경

1. `any + 빈 메뉴 키워드`가 첫 활성 결합 카드를 선택하는 회귀 테스트를 추가했다.
2. 선택 후 필수 안내가 총 결제금액 요약으로 바뀐 fixture를 추가했다.
3. 결합 화면 진행 문구를 `다음`과 구형 `확인` 모두 허용했다.
4. 같은 진행 버튼에 대한 중복 클릭을 차단했다.
5. 실측 중 발견한 `결제 방식 선택` 제목과 sibling 프로모션 오버레이를 기존 결제 자동 진행 정책에 연결했다.

## 변경 파일

- `src/content/adapter/dialog.ts`
- `src/content/adapter/post-slot-inspection.ts`
- `src/content/adapter/post-slot.ts`
- `tests/post-slot-adapter.test.mjs`
- `tests/fixtures/post-slot-seating-menu-*.html`
- `tests/fixtures/post-slot-payment-method-notice.html`
