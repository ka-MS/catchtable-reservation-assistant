# RT-15 구현 계획 — 기준시계 원시 표본 trace

## 변경

1. `ReferenceClockPort`와 `ReferenceClockSampler`에 `drainSamples()` 추가
2. `RunSession`에 동결 raw sample batch와 freeze reason 추가
3. actual arm 또는 terminal에서 sampler를 정확히 한 번 stop/drain
4. terminal `finally`에서 `CLOCK_SAMPLE` event를 enqueue한 뒤 기존 trace flush
5. Side Panel 상세 목록에서 raw event 제외, 조회 limit 200
6. backlog를 `PROMOTED`, 완료 후 `DONE`으로 갱신

## 테스트

- sampler drain 순서·상한·두 번째 호출 empty·latest 유지
- normal arm: raw sample 정확히 한 번 기록, freeze reason `armed`
- armed 전 terminal: raw sample 기록, freeze reason `terminal`
- bootstrap 실패: raw event 0건
- normal arm과 finally 중복 방지
- raw event가 Side Panel 목록에 나타나지 않음
- CSV에 raw attributes가 보존됨
- 기존 전체 check와 모듈 독립성 통과

## 비변경

- HEAD 주기와 bufferSize
- estimator와 confidence 판정
- armLead와 20/40/60ms 상수
- XHR probe, 날짜 토글, 슬롯 선택·클릭
- IndexedDB schema
