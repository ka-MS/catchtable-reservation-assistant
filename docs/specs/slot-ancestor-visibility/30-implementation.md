# 슬롯 조상 가시성 구현 계획

1. 숨겨진 조상 복제 슬롯 fixture를 추가하고 기존 SlotAdapter 테스트가 실패하는지 확인한다.
2. `slots.ts`에서 `isElementHidden()`을 사용해 최소 수정한다.
3. SlotAdapter 테스트와 전체 `npm run check`를 실행한다.
4. diff와 클릭 계약을 적대적으로 검토하고 문서·backlog·HANDOFF를 갱신한다.

## 예상 변경 파일

- `src/content/adapter/slots.ts`
- `tests/fixtures/slots.html`
- `tests/slot-adapter.test.mjs`
- RT-03 spec, backlog, worklog, HANDOFF
