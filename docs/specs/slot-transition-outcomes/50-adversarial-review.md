# 슬롯 클릭 전환 결과 적대적 리뷰

## 검토 결과

### 클릭 성공 의미

`SlotAdapter.clickSlot()`의 `true`는 DOM click 호출이 전달됐다는 뜻으로만 사용된다. 새 실행은 즉시 선택 완료로 표현하지 않고 `SLOT_CLICK_DISPATCHED`에 진입한다.

### 화면 확인 의미

`PostSlotPort.inspect()`가 `waiting`이 아닌 알려진 kind를 반환해야 `SLOT_TRANSITION_CONFIRMED`에 진입한다. 이 상태도 예약 흐름 화면 도착만 뜻하며 서버 좌석 hold 또는 최종 확보를 뜻하지 않는다.

### timeout 증가 여부

확인과 후속 자동 진행은 클릭 직후 만든 동일한 5초 deadline을 공유한다. 확인 단계 추가로 최악 실행시간이 5초 더 늘어나지 않는다. 예약 폼 홍보 안내 grace는 기존 동작을 유지한다.

### 자동 진행 비활성 경계

`postSlotEnabled=false`에서도 화면을 inspect하지만 `advance()`는 호출하지 않는다. unknown은 즉시 안전 인계하고 waiting은 bounded timeout으로 끝난다.

### 저장 호환성

과거 IndexedDB·저장 실행이 가진 `SLOT_SELECTED`는 `RunState`와 UI 표시에서 유지한다. 새 상태 머신에는 해당 상태로 들어가는 전이가 없어 새 실행에서 생성되지 않는다.

## 수정한 finding

정식 `docs/design/state-machine.md`가 과거 `SLOT_SELECTED = click 완료` 계약을 계속 설명하고 있었다. 신규 상태와 전이, legacy 의미, hold 비증명 문구로 갱신했다. 과거 worklog와 완료 spec은 당시 기록이므로 수정하지 않았다.

## 잔여 위험

- click 뒤 Catchtable가 알려지지 않은 새 화면을 표시하면 `unknown`으로 인계한다.
- dispatch 뒤 화면이 5초보다 늦게 나타나면 `timed_out`으로 인계한다.
- 이번 live 확장 실행은 사전 달력 판별 실패로 신규 상태의 positive 연속 로그를 만들지 못했다. 실제 prepared 상태 또는 다음 실오픈에서 추가 표본을 확보할 수 있다.
- 후속 화면 도착만으로 좌석 hold 여부는 알 수 없다.

## 결론

차단 finding 없음. RT-01이 요구한 의미 분리와 안전 경계는 구현됐고 전체 게이트를 통과했다.
