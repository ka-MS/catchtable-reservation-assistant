# 슬롯 조상 가시성 설계

## 선택안

`SlotAdapter.readSlots()`의 기존 커스텀 필터는 유지하고 버튼 자체 검사 세 개를 `isElementHidden(button)`으로 대체한다.

```text
main button[data-busy] 조회
→ data-busy="false" 확인
→ isElementHidden(button)로 버튼과 모든 조상 확인
→ disabled 확인
→ 시간 파싱과 분 단위 중복 제거
```

`visibleAll()`로 전체 루프를 바꾸지 않는다. 슬롯은 일반 가시성 외에 `data-busy`와 `disabled`라는 도메인 조건을 가지며, 현재 루프에 공용 predicate 하나를 추가하는 편이 변경 범위가 작고 필터 순서가 명확하다.

## 테스트 설계

기존 `slots.html`에 `aria-hidden="true"` 조상 아래 다음 복제본을 가시 슬롯보다 먼저 배치한다.

- 고유 시간: 후보 목록에서 완전히 제외돼야 함
- 기존 시간의 복제본: 뒤의 가시 슬롯을 가리지 않아야 함

읽기 결과와 `clickSlot()` 결과를 함께 검증한다. `isElementHidden()`의 개별 hidden/inert/CSS 규칙은 기존 DOM helper 테스트가 소유한다.

## 안전 경계

- 네트워크 body로 슬롯을 선택하지 않는다.
- 기존 DOM 재조회 후 클릭 계약을 유지한다.
- 새로운 fallback selector를 추가하지 않는다.
