# Retry Evidence Case 1

슬롯 클릭 후 경쟁에서 패배한 첫 번째 유형이다. 재시도 동작은 아직 구현하지 않으며, 이 문서는 원본 케이스의 구분만 보존한다.

## 관찰

- 슬롯 클릭은 서버 오픈 기준 약 `+959ms`에 전달됐다.
- 실행은 5초 뒤 `SLOT_CLICK_DISPATCHED -> HANDED_OFF`로 종료됐다.
- 종료 fragment에는 `예약 과정에서 테이블 선정을 하지 못했습니다.` 안내와 `확인` 버튼이 남아 있다.
- 기존 post-slot 판별은 이 표면을 active dialog로 인식하지 못하고 `no-active-dialog-v1`로 분류했다.

## 재시도 설계에서의 의미

명시적인 좌석 배정 실패 표면을 복구 가능한 결과로 판별할 수 있는 케이스다. 확인 후 예약 진입부터 다시 시작할지, 현재 모달에서 재시도할지는 별도 설계에서 결정한다.

## 원본

- [Trace CSV](run.csv)
- [Diagnostic manifest](diagnostic/manifest.json)
- [DOM snapshots](diagnostic/dom-snapshots.jsonl)
- [Failure fragment](diagnostic/fragments/94223f20-347f-4641-bb5b-13dbd25e5362.html)
