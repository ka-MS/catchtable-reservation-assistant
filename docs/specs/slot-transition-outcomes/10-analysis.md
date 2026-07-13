# 슬롯 클릭 전환 결과 분석

**Backlog:** RT-01

## 현재 문제

`SlotAdapter.clickSlot()`의 `true`는 버튼에 `click()`을 전달했다는 뜻뿐이다. 현재 오케스트레이터는 이 반환 직후 `SLOT_SELECTED`와 "시간 선택을 완료했습니다"를 기록해 다음 화면 도착이나 서버 좌석 확보가 확인된 것처럼 표현한다.

`postSlotEnabled=false`이면 `PostSlotAdapter.inspect()`를 한 번도 호출하지 않고 즉시 인계하므로 클릭이 실제 예약 흐름 전환으로 이어졌는지 알 수 없다.

## 확인 가능한 증거

- 클릭 직전 DOM 재조회 실패: 후보가 사라진 dispatch 전 경합
- `clickSlot() === true`: click dispatch 성공
- post-slot inspection의 알려진 kind: 후속 예약 화면 도착 확인
- `unknown`: 미지원 화면 도착
- `waiting`이 5초 지속: 전환 확인 제한시간 초과

후속 화면 도착은 서버 좌석 hold 완료 증거가 아니다.

## 목표

- 클릭 dispatch와 후속 화면 도착 확인을 상태와 로그에서 분리한다.
- 후속 자동화가 꺼져 있어도 화면 전환 결과는 관찰한다.
- dispatch 전 경합, confirmed, unknown, timed_out을 구조화된 결과로 남긴다.
- 결제·약관·최종 예약 경계를 변경하지 않는다.

## 비목표

- 서버 좌석 hold 성공 판정
- 증거 없는 경합 오류 dialog 분류
- 슬롯 API 직접 호출 또는 body 기반 클릭
