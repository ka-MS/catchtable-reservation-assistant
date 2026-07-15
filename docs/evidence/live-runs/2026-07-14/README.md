# 2026-07-14 Live Runs

누와 00:00 실제 오픈 RT-10M 표본이다. 상세 해석은 [RT-10M 누와 분석](../../../specs/open-timing-performance/02-availability-hot-path/60-rt10m-nuwa-analysis.md)을 기준으로 한다.

| 실행 | 예약 날짜 | 종료 | 환경·원본 메모 |
|---|---|---|---|
| [run-ec3acf59](nuwa-run-ec3acf59-2e31-48c5-a558-b7dd184d7a01/run.csv) | 2026-08-02 | `HANDED_OFF` | 로컬 전면, 예약 폼 인계 후 사용자 예약 성공 |
| [run-5881d898](nuwa-run-5881d898-a394-4244-a694-07e2d5ea0205/run.csv) | 2026-08-02 | `HANDED_OFF` | 로컬 최소화, 슬롯 클릭 후 화면 전환 timeout |
| [run-8984299b](nuwa-run-8984299b-a323-4278-a799-4da514d9c20a/run.csv) | 2026-07-30 | `STOPPED` | 로컬 최소화, 사용자 중지 |
| [run-b413a0d5](nuwa-run-b413a0d5-d2ed-4642-bee3-d4aea20d04ac/run.csv) | 2026-08-09 | `HANDED_OFF` | 신규 PC 4분할, 예약 CTA 미검출 |

모든 표본은 extension `0.2.0`, dropped 0이다. 신규 PC의 나머지 3개 실패는 원본 로그가 없어 이 패키지에 포함하지 않는다.
