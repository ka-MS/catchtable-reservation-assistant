# 2026-07-14 RT-10M 양주르 음성 표본

## 목적

실제 예약 오픈에서 target 슬롯 body의 `EMPTY -> POPULATED` 전환과 조건 불일치 시 미클릭 동작을 확인한다.

## 실행 조건

- 매장: `yangjour`
- 목표 날짜: `2026-09-05`
- 인원: 2명
- 시간 범위: 18:30-21:00
- 우선 시간: 없음
- 실행 ID: `run-866b9478-ff60-4429-977b-0ea012eefdaa`
- 녹화: `C:\Users\ITMSG-HMS\Videos\화면 녹화\녹음 2026-07-14 150136.mp4`

## 관측

- target body가 `EMPTY`에서 `POPULATED`로 전환됐다.
- `POPULATED` 이벤트는 cycle 6, requestSequence 12, correlationQuality `EXACT`였다.
- 목표 날짜 화면에 11:00, 15:00, 15:30, 17:30 슬롯이 표시됐다.
- 모든 슬롯이 설정 범위 18:30-21:00 밖이어서 일치 후보가 없었다.
- 슬롯 클릭 없이 날짜 탐색을 계속했다.
- 함께 기록된 cycle 없는 `NONE/IRRELEVANT` shadow는 target wake 증거로 사용되지 않았다.
- 15:00:24의 달력 상태 변경과 `SETUP_INVALID` 종료는 측정 중 사용자 클릭으로 발생했다.

## 판정

슬롯 미클릭은 오류가 아니라 설정 조건에 따른 정상 동작이다. 이 실행은 다음 두 계약의 실제 오픈 음성 표본이다.

1. target body의 `EMPTY -> POPULATED`를 `EXACT`로 상관한다.
2. `POPULATED`여도 설정과 일치하는 슬롯이 없으면 클릭하지 않는다.

사용자 개입으로 발생한 마지막 종료는 자동화 판정에서 제외한다. 또한 일치 후보가 없었으므로 wake accepted, DOM candidate, dispatch, click의 지연 표본으로 사용할 수 없다. RT-10M과 RT-05 gate는 닫지 않으며, 다음 실제 오픈은 열린 슬롯을 포함하는 시간 조건으로 다시 측정한다.
