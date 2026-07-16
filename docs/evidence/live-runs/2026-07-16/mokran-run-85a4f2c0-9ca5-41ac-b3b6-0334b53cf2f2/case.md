# RT-14 EXACT EMPTY 실오픈 case

## 원본

- Trace: [run.csv](run.csv)
- 진단 manifest: [diagnostic/manifest.json](diagnostic/manifest.json)
- 매장: `mokran`
- 예약 날짜: `2026-08-19`
- 오픈: `2026-07-16 10:30:00 KST`
- 설정: `availabilityProbeMode=empty_exit`, `preOpenLeadMs=3000`, `toggleIntervalMs=100`
- 종료: `HANDED_OFF`, dropped 0

## 핵심 타임라인

| 서버 시각 | 이벤트 | 근거 |
|---|---|---|
| `10:29:56.733` | cycle 1 / request 4의 `EXACT EMPTY` 수락 | seq 18, `signalKind=empty_exit` |
| `10:29:56.740` | cycle 1 조기 종료 | seq 19-20, `bodyToExitMs=7`, `EMPTY_EARLY_EXIT` |
| `10:30:00.867` | cycle 9 / request 16의 `EXACT POPULATED` 관측 | seq 40, 이미 inactive cycle이라 제어에는 미사용 |
| `10:30:00.883` | cycle 10에서 슬롯 발견 | seq 42-43, 오픈 `+884ms` |
| `10:30:00.891` | 오후 5:00 슬롯 클릭 전달 | seq 46, 오픈 `+891ms` |
| `10:30:03.364` | 예약 폼 인계 | seq 53 |

## 판정

- current `EXACT EMPTY`가 설계대로 cycle 조기 종료에 적용됐다.
- `NONE` quality와 inactive-cycle 응답은 제어 신호로 수락되지 않았다.
- 조기 종료 후에도 슬롯을 발견하고 예약 폼에 도달해 이 실행에서는 DOM 후보 손실이 관측되지 않았다.
- 단일 표본이며 동등한 `off` 비교군이 없으므로 성능 향상량과 요청 증가량은 판정하지 않는다.
- RT-14 기능·안전 실오픈 gate는 통과하지만 기본값은 `off`로 유지한다.
