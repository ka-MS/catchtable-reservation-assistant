# RT-16B 설계 — 실행 간 준비 상태 격리

## 문제

Content Script의 `CalendarAdapter`는 같은 문서에서 재사용된다. 동일 목표 날짜로 실패 후 재시작하면 `pendingDate`가 남아 새 실행이 클릭 없이 waiting만 반복할 수 있다.

## 계약

- auto entry의 날짜 준비 시작 시 Adapter의 preparation 상태를 명시적으로 reset한다.
- reset은 pending month/date, 요청 시각과 attempt를 모두 비운다.
- 날짜 DOM 판독과 Tier 2 `inspect()`·`clickDate()`는 변경하지 않는다.
- 같은 Adapter를 공유한 연속 실행 테스트에서 두 번째 실행이 독립 dispatch를 수행해야 한다.
