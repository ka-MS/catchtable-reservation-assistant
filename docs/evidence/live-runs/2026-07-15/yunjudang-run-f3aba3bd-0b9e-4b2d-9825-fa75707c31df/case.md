# Retry Evidence Case 2

슬롯 클릭 후 경쟁에서 패배한 두 번째 유형이다. Case 1과 동일한 종료 메시지를 기록했지만 실제 화면 상태와 실패 안내 방식이 다르다. 재시도 동작은 아직 구현하지 않으며, 이 문서는 원본 케이스의 구분만 보존한다.

## 관찰

- 실행은 슬롯 클릭 뒤 `SLOT_CLICK_DISPATCHED -> HANDED_OFF`로 종료됐다.
- 사용자 screenshot에는 `먼저 접속한 순서대로 처리 중입니다. 다시 시도해주세요.`라는 일시적인 toast가 보인다.
- 5초 뒤 종료 snapshot 시점에는 toast와 active dialog가 사라져 있었다.
- shop 화면에 목표 슬롯 `오후 4:00`, `오후 7:30`이 다시 보이는 상태였다.
- 종료 snapshot은 `visibilityState=visible`, `hasFocus=false`를 기록했다.

## 재시도 설계에서의 의미

일시적인 재시도 toast를 직접 감지하거나, toast를 놓친 경우 클릭 후 shop·슬롯 화면으로 원상복귀한 상태를 확인해야 하는 유형이다. timeout, 현재 슬롯 상태, 실행 소유권을 함께 확인하는 별도 복구 계약이 필요하다.

## 원본

- [Trace CSV](run.csv)
- [Diagnostic manifest](diagnostic/manifest.json)
- [DOM snapshots](diagnostic/dom-snapshots.jsonl)
- [Failure fragment](diagnostic/fragments/4c576c76-5ee9-49bb-9801-8a75597197c5.html)
- [Screenshot](screenshot.png)
