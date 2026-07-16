# RT-14 실오픈 검증

## 증거

- 날짜 인덱스: [2026-07-16 RT-14 EXACT EMPTY 실오픈](../../../../evidence/live-runs/2026-07-16/README.md#rt14-exact-empty-live)
- 대표 실행: [mokran run-85a4f2c0](../../../../evidence/live-runs/2026-07-16/mokran-run-85a4f2c0-9ca5-41ac-b3b6-0334b53cf2f2/case.md)
- 원본 Trace: [run.csv](../../../../evidence/live-runs/2026-07-16/mokran-run-85a4f2c0-9ca5-41ac-b3b6-0334b53cf2f2/run.csv)

환경과 설정:

- 2026-07-16 목란 10:30 실제 오픈
- `availabilityProbeMode=empty_exit`
- `preOpenLeadMs=3000`, `toggleIntervalMs=100`
- 실제 실행, dropped 0

## 결과

| 검증 항목 | 결과 |
|---|---|
| current active-cycle `EXACT EMPTY` 수락 | cycle 1 / request 4 |
| EMPTY → cycle 종료 | 7ms |
| cycle 결과 | `EMPTY_EARLY_EXIT` |
| 비신뢰·비활성 응답 제어 오수용 | 0건 |
| 오픈 후 슬롯 감지 | cycle 10, `+884ms` |
| 슬롯 클릭 전달 | `+891ms` |
| 후속 흐름 | 예약 폼 도달 후 `HANDED_OFF` |
| DOM 후보 손실 | 관측되지 않음 |
| 성능 비교 | 동등한 `off` 비교군 부재로 판정 보류 |
| 요청 증가량 | 동등한 비교군 부재로 판정 보류 |

cycle 1의 `EXACT EMPTY`는 서버 시각 `10:29:56.733`에 수락됐고 7ms 뒤 조기 종료됐다. 오픈 후에는 cycle 9의 `EXACT POPULATED`가 늦게 도착해 `inactive_cycle`로 거절됐으며, cycle 10의 기존 DOM 경로가 슬롯을 발견했다. 이는 RT-14가 기존 polling fallback과 함께 동작했음을 보여준다.

## 판정

**기능·안전 실오픈 gate 통과. 성능 승격 gate는 미통과.**

- `EMPTY → EMPTY_EARLY_EXIT → 후속 cycle 슬롯 발견` 실경로를 확인했다.
- stale/inactive/quality 불충분 신호의 제어 오수용은 없었다.
- 슬롯 클릭과 예약 폼 도달로 후보 손실이 없음을 확인했다.
- 한 표본만으로 실제 속도 이득과 요청 증가량을 분리할 수 없다.
- 운영 기본값은 `off`로 유지하고 `empty_exit`은 사용자 명시 선택 기능으로 남긴다.

## 남은 측정

동일 매장·유사 환경의 `off` 또는 반복 `empty_exit` 표본을 추가해 다음을 비교한다.

1. 오픈 전 cycle·request 수
2. target click → current `EXACT EMPTY`
3. EMPTY → 다음 target click
4. 오픈 → 슬롯 감지·클릭

이 비교는 성능 주장과 기본값 승격에만 필요하며 RT-14 기능 완료를 막지 않는다.
