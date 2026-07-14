# 01 신형 달력 DOM 호환 분석

## 문제

`EntryAdapter.inspect()`와 `CalendarAdapter.readCells()`는 모두 `div[role="button"][aria-label]`만 날짜 셀로 인정한다. 2026-07-14 야키토리묵의 현재 달력에는 해당 요소가 0개라 화면이 열려 있어도 `reservationOpen=false`가 된다.

## 실측 증거

- 표시 월: `button` 텍스트 `2026년 7월`
- 테이블: `.mbsc-calendar-table` 3개
- 활성 테이블: `.mbsc-calendar-table-active` 1개, `aria-hidden` 없음
- 비활성 테이블: `aria-hidden="true"`
- 활성 grid: 6행 × 7셀
- 날짜 셀: `.mbsc-calendar-cell.mbsc-calendar-day`
- 상태: `.mbsc-selected`, `.mbsc-disabled`, `.mbsc-calendar-day-outer`
- 셀 텍스트: 선두 일자 뒤 `오늘`, `마감`, `오픈 전`이 붙을 수 있음

## 실패 원인

진입과 날짜 선택이 서로 같은 구형 selector를 복제해 사용한다. 따라서 한쪽만 수정하면 진입 또는 선택 중 하나가 계속 실패한다.

## 요구사항

1. 기존 aria 날짜 셀을 그대로 지원한다.
2. Mobiscroll 구조는 활성 테이블·표시 월·6×7 grid·셀 일자 교차 검증 후 판독한다.
3. Entry와 Calendar가 하나의 판독 함수를 공유한다.
4. 활성 테이블 외 가상 월은 제외한다.
5. 판독 증거가 불완전하면 날짜를 추측하지 않는다.
6. 재진입으로 selector 실패를 숨기지 않는다.

## 성공 증거

- 현재 Mobiscroll fixture에서 Entry가 예약창을 인식한다.
- 목표 날짜·선택·비활성·인접 날짜와 click이 동작한다.
- 기존 aria fixture 테스트가 그대로 통과한다.
- 실제 야키토리묵 예약 모달에서 목표 날짜 준비 단계가 통과한다.
