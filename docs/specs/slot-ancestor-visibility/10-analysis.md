# 슬롯 조상 가시성 분석

**Backlog:** RT-03

## 현재 결함

`SlotAdapter.readSlots()`는 슬롯 버튼 자신의 `aria-hidden`, `hidden`, `disabled`만 검사한다. 따라서 버튼은 가시 상태지만 조상 캐러셀·패널이 `hidden`, `inert`, `aria-hidden="true"`, `display:none` 또는 `visibility:hidden`인 복제 슬롯이 후보에 포함될 수 있다.

같은 시간의 숨겨진 복제본이 가시 버튼보다 DOM에서 먼저 발견되면 분 단위 `Map` 중복 제거가 숨겨진 버튼을 보존하고 실제 가시 버튼을 버린다. `clickSlot()`도 `readSlots()`로 재조회하므로 동일한 오선택 가능성이 있다.

## 기존 기반

`src/content/adapter/dom.ts`의 `isElementHidden()`은 대상부터 모든 조상을 순회해 위 가시성 조건을 이미 검사한다. 다른 Adapter는 이 공용 계약을 사용하고 있으므로 새 selector나 가시성 규칙은 필요하지 않다.

## 범위

- `SlotAdapter` 후보 필터에 공용 조상 가시성 검사 적용
- 숨겨진 조상 아래 복제 슬롯 fixture와 회귀 테스트 추가
- 날짜 토글, XHR shadow, 슬롯 우선순위, 오케스트레이터 상태는 변경하지 않음

## 성공 기준

- 숨겨진 조상 아래의 고유 슬롯과 중복 슬롯이 모두 제외된다.
- 숨겨진 중복이 DOM에서 먼저 나와도 같은 시간의 가시 슬롯이 선택된다.
- 클릭 직전 재조회에서도 가시 버튼만 한 번 클릭한다.
- 전체 자동 게이트가 통과한다.
