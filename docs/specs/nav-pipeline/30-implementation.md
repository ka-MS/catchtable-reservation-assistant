# 네비게이션 파이프라인 구현

**구현:** 2026-07-11

## 변경

- `pagePrepared`를 `entryMode: auto | prepared`로 교체하고 구 draft/config 읽기 호환을 추가했다.
- Background에 목표 탭 이동, load complete 대기, pending run 취소 경쟁 방지를 추가했다.
- `EntryAdapter`는 `aside#dock`의 정확한 `예약하기`만 클릭하고 웨이팅 전용 상태를 구분한다.
- `CalendarAdapter.prepareTarget()`은 실측된 월 이동 버튼으로 목표 월·날짜를 준비한다.
- `PersonAdapter`는 정확한 `personCount` 라디오만 선택한다.
- Orchestrator에 `ENTERING_RESERVATION → SELECTING_DATE → SELECTING_PERSON`을 연결하고 기존 `PREPARING_PAGE` 검증을 유지했다.

## 제한 시간

- 예약 CTA·달력 출현: 5초
- 목표 월·날짜 준비: 10초
- 인원 준비: 3초

모든 구간은 `AbortSignal`과 `stopAtMs`를 확인하며 실패 시 임의 대체 없이 인계한다.
