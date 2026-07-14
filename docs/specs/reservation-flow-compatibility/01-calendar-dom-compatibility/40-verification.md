# 01 신형 달력 DOM 호환 검증

상태: 구현·자동 검증·실 DOM 판독 완료

## TDD 결과

구현 전 새 fixture를 대상으로 다음 3개 테스트가 실패하는 것을 확인했다.

- EntryAdapter가 Mobiscroll 달력을 열린 예약창으로 인식
- CalendarAdapter가 Mobiscroll 활성 월을 판독
- CalendarAdapter가 목표 날짜를 재조회해 한 번 클릭

공유 판독기를 구현하고 방어 테스트를 추가한 뒤 달력 관련 테스트 14/14가 통과했다.

## 전체 게이트

2026-07-14 기준 결과:

- `npm run check`: 269/269 통과
- strict typecheck 통과
- `check:dist` 통과
- `check:independence` 통과
- `git diff --check` 통과

## 실제 DOM 판독

야키토리묵 `https://app.catchtable.co.kr/ct/shop/yakitorimook?date=260723`의 열린 예약 모달을 Chrome DevTools로 확인했다.

- 구형 `div[role="button"][aria-label]`: 0개
- `.mbsc-calendar-table`: 3개
- 비가시 가상 테이블: 2개 (`aria-hidden=true`)
- 활성 테이블: 1개 (`.mbsc-calendar-table-active`)
- 활성 그리드: 6행 x 7열, 총 42셀
- 표시 월: `2026년 7월`
- 목표 날짜 `2026-07-23`: 판독 가능·선택됨
- 인접 날짜 `2026-07-22`: 판독 가능

동일 DOM에 새 판독기를 직접 실행한 결과는 `valid=true`, `count=42`였다. 확장 번들을 다시 빌드하고 설치된 확장 ID `olbclnjiehfelpfmgmdphfmenapmpaal`의 `dist`를 새로고침했다.

실제 슬롯 클릭부터 폼 도착까지의 확장 E2E는 이 단계에서 중복 수행하지 않고 03과 04에서 증거를 남긴다.
