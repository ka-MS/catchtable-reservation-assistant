# 2026-07-12 후속 진행 시간초과 인계에 마지막 관찰 근거 기록

## 문제

실전 런에서 슬롯 클릭 후 5초 동안 아무 action 이벤트 없이 "후속 예약 화면을 5초 안에 확인하지 못했습니다"로 인계됐다. 진단 스냅샷은 dialog를 찾았지만 분류하지 못한(unknown) 경우에만 남고, dialog 자체를 인식하지 못해 waiting만 반복된 경우 시간초과 인계 이벤트가 마지막 inspection 데이터를 버려서 화면에 뭐가 있었는지 아무 기록도 남지 않았다.

## 수정

- 후속 진행 루프가 마지막 inspection을 기억하고, 5초 시간초과 인계 이벤트에 `postSlotEventData(lastInspection)`을 싣는다.
- waiting 판정에도 진단 메타(strategy `no-active-dialog-v1`, urlKind 포함)가 이미 있으므로, 다음 재발 시 페이지가 shop을 벗어났는지·어떤 구조였는지 로그만으로 판별할 수 있다.

## 검증

- 실패 테스트 먼저: "waiting만 반복되면 시간초과 인계에 postSlotStage/urlKind가 실린다" — `postSlotStage`가 `undefined`로 실패(RED)함을 확인 후 구현했다.
- `npm run check` 전체 통과 (162 tests + dist + independence).

## 남은 것

이번 실전 건의 실제 화면은 기록이 없어 특정하지 못했다. 같은 매장 재실측 또는 다음 재발 로그로 분류 규칙을 추가한다.
