# Retry Evidence Case 2

슬롯 클릭 후 경쟁에서 패배한 두 번째 유형이다. Case 1과 동일한 종료 메시지를 기록했지만 실제 화면 상태가 다르다. 재시도 동작은 아직 구현하지 않으며, 이 문서는 원본 케이스의 구분만 보존한다.

## 관찰

- 실행은 슬롯 클릭 뒤 `SLOT_CLICK_DISPATCHED -> HANDED_OFF`로 종료됐다.
- 종료 시 명시적인 배정 실패 안내나 active dialog가 없었다.
- shop 화면에 목표 슬롯 `오후 4:00`, `오후 7:30`이 다시 보이는 상태였다.
- 종료 snapshot은 `visibilityState=visible`, `hasFocus=false`를 기록했다.

## 재시도 설계에서의 의미

문구 기반 실패 판별이 불가능한 무응답·원상복귀 유형이다. 클릭 후 화면 전환 timeout, 현재 슬롯 상태, 실행 소유권을 함께 확인하는 별도 복구 계약이 필요하다.

## 원본

- [Trace CSV](run.csv)
- [Diagnostic manifest](diagnostic/manifest.json)
- [DOM snapshots](diagnostic/dom-snapshots.jsonl)
- [Failure fragment](diagnostic/fragments/4c576c76-5ee9-49bb-9801-8a75597197c5.html)
- [Screenshot](screenshot.png)
