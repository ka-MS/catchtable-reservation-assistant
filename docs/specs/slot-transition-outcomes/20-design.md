# 슬롯 클릭 전환 결과 설계

## 상태 계약

새 실행 상태를 추가한다.

```text
SLOT_DETECTED
├─ clickSlot=false → REFRESHING_SLOTS (contention_before_dispatch)
└─ clickSlot=true  → SLOT_CLICK_DISPATCHED
                     ├─ known screen → SLOT_TRANSITION_CONFIRMED
                     ├─ unknown      → HANDED_OFF (unknown)
                     ├─ 5s waiting   → HANDED_OFF (timed_out)
                     └─ abort        → STOPPED
```

`SLOT_SELECTED`는 기존 IndexedDB·UI 로그 표시 호환을 위해 `RunState`에 남기지만 새 상태 머신 경로에서는 진입할 수 없게 한다.

`SLOT_TRANSITION_CONFIRMED`는 예약 흐름 화면을 확인했다는 뜻이며 좌석 확보를 뜻하지 않는다.

## 결과 데이터

`slotTransitionOutcome` 값:

- `contention_before_dispatch`
- `dispatched`
- `confirmed`
- `unknown`
- `timed_out`

dispatch 이벤트의 timing stage는 `slot_click_dispatched`로 기록한다. 기존 `slot_selected`라는 표현을 새 실행에서 만들지 않는다.

## 확인과 자동 진행 분리

클릭 뒤 5초 deadline을 만들고 `PostSlotPort.inspect()`만 반복하는 `waitForSlotTransition()`을 둔다. 알려진 kind를 처음 확인하면 자동 행동 없이 반환한다.

- `postSlotEnabled=false`: confirmed 기록 후 즉시 사용자 인계
- `postSlotEnabled=true`: confirmed inspection을 `advancePostSlot()`에 전달해 기존 선택적 자동 진행

확인과 자동 진행은 같은 5초 deadline을 공유해 기존 최악 실행시간을 늘리지 않는다. 예약 폼 홍보 안내 grace만 기존처럼 연장할 수 있다.

## 안전 경계

- unknown 화면은 클릭하지 않는다.
- dispatch 전 후보 소실은 기존처럼 날짜 토글을 재개한다.
- 클릭 후 known 화면 도착만 확인하고 서버 hold를 추론하지 않는다.
