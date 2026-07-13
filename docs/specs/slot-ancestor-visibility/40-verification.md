# 슬롯 조상 가시성 검증

## TDD 재현

숨겨진 `aria-hidden="true"` 캐러셀 조상 안에 가시 슬롯보다 먼저 다음 버튼을 배치했다.

- 고유 `18:30` 슬롯
- 가시 버튼과 중복되는 `19:00` 슬롯

수정 전 결과:

- 읽기 결과에 `18:30`이 잘못 포함됨
- `19:00` 클릭 시 숨겨진 복제본이 선택돼 가시 버튼 클릭 횟수가 0회였음

수정 후 SlotAdapter 테스트 3개가 모두 통과했다. 읽기와 클릭 직전 재조회 양쪽에 같은 `isElementHidden()` 계약이 적용된다.

## 자동 게이트

```text
npm run check
TypeScript: PASS
Tests: 228/228 PASS
dist validation: PASS
module independence: PASS
git diff --check: PASS
```

## Live 비파괴 확인

2026-07-14 케아 `date=260730` 페이지에서 예약 슬롯을 클릭하지 않고 DOM만 읽었다.

- `main button[data-busy]`: 20개
- 공용 조상 가시성 규칙을 통과한 available 슬롯: 7개
- `aria-hidden`으로 제외된 캐러셀 복제 슬롯: 13개
- 가시 슬롯: 12:00, 13:30, 18:00, 18:30, 19:00, 19:30, 20:00

현재 live 표본의 복제본은 버튼 자체에 `aria-hidden`이 있었다. 조상에만 숨김 속성이 있는 표본은 재현 fixture가 검증한다.

## 판정

RT-03 최소 완료 조건을 충족한다. 슬롯 탐색 결과와 클릭 직전 재조회가 모두 숨겨진 조상 복제본을 제외하며 기존 가시 슬롯 목록은 유지된다.
