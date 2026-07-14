# 01 신형 달력 DOM 호환 설계

## 컴포넌트

`src/content/adapter/calendar-dom.ts`에 날짜 셀 판독을 집중한다.

```ts
interface CalendarDateCell {
  date: string;
  epochDay: number;
  element: HTMLElement;
  available: boolean;
  selected: boolean;
}

readCalendarCells(document): CalendarDateCell[]
readDisplayedCalendarMonth(document): string | null
```

`readCalendarCells`는 다음 전략을 순서대로 사용한다.

1. 기존 aria 날짜 셀 전략
2. Mobiscroll 활성 grid 전략

첫 전략이 유효한 셀을 반환하면 기존 계약을 유지한다. 그렇지 않을 때만 Mobiscroll 전략을 시도한다.

## Mobiscroll 검증

1. 표시 월 button이 정확히 하나의 `YYYY년 M월`을 제공한다.
2. `aria-hidden="true"`가 아닌 `.mbsc-calendar-table-active`가 정확히 하나다.
3. 직접 자식 row가 6개이고 각 row의 날짜 셀이 7개다.
4. 월 1일의 요일로 첫 grid 날짜를 계산한다.
5. 각 셀의 선두 1~2자리와 계산 날짜의 일이 모두 일치한다.
6. 하나라도 불일치하면 전체 Mobiscroll 전략을 폐기한다.

`available`은 `.mbsc-disabled` 부재, `selected`는 `.mbsc-selected` 존재로 판독한다. `.mbsc-calendar-day-outer`는 날짜 계산 검증에만 사용하고 인접 날짜 후보에서 임의 제외하지 않는다.

## 소비자 변경

- `EntryAdapter.inspect()`는 `readCalendarCells(document).length > 0`으로 예약창을 판정한다.
- `CalendarAdapter`는 자체 parser와 selector를 제거하고 공유 reader를 사용한다.
- 월 이동 button 계약은 기존 aria-label을 유지한다.

## 안전성

- 생성형 해시 class는 사용하지 않는다.
- Mobiscroll semantic class만으로 확정하지 않고 월·grid·텍스트를 교차 검증한다.
- click 직전마다 공유 reader로 요소를 다시 조회한다.
