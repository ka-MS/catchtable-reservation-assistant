# 2026-07-15 Live Runs

다수 매장의 실제 오픈 실행 자료다. 이 인덱스는 파일과 사용자 메모를 보존하며, 통합 원인·성능 판독은 [Actual-open cross-run analysis](../../../specs/open-timing-performance/02-availability-hot-path/70-live-run-analysis.md)를 기준으로 한다.

## 진단 bundle 포함

| 실행 | 예약 날짜 | 종료 | 원본 메모 | 진단 |
|---|---|---|---|---|
| [kiro run-853ff5b6](kiro-run-853ff5b6-2b0e-4e41-b20c-39576a2062c0/run.csv) | 2026-08-15 | `HANDED_OFF` | 경쟁 패배 case 1: 명시적 테이블 선정 실패 안내 | [case](kiro-run-853ff5b6-2b0e-4e41-b20c-39576a2062c0/case.md), [manifest](kiro-run-853ff5b6-2b0e-4e41-b20c-39576a2062c0/diagnostic/manifest.json) |
| [bistropolpo run-c78a9cea](bistropolpo-run-c78a9cea-7a8d-492d-a26f-25ae5e255bda/run.csv) | 2026-09-01 | `HANDED_OFF` | 예약 폼까지 이동했으나 timeout 종료 | [manifest](bistropolpo-run-c78a9cea-7a8d-492d-a26f-25ae5e255bda/diagnostic/manifest.json) |
| [yunjudang run-f3aba3bd](yunjudang-run-f3aba3bd-0b9e-4b2d-9825-fa75707c31df/run.csv) | 2026-08-01 | `HANDED_OFF` | 경쟁 패배 case 2: 일시적 재시도 toast 후 shop·슬롯 화면 유지 | [case](yunjudang-run-f3aba3bd-0b9e-4b2d-9825-fa75707c31df/case.md), [manifest](yunjudang-run-f3aba3bd-0b9e-4b2d-9825-fa75707c31df/diagnostic/manifest.json), [화면](yunjudang-run-f3aba3bd-0b9e-4b2d-9825-fa75707c31df/screenshot.png) |

## Trace CSV

| 실행 | 예약 날짜 | 종료 | 원본 메모 |
|---|---|---|---|
| [bistropolpo run-188c11c0](bistropolpo-run-188c11c0-5cb0-45ca-8fdf-1719782126ab/run.csv) | 2026-09-06 | `HANDED_OFF` | 장거리 월 이동 실패 |
| [curtaincall run-db705892](curtaincall-run-db705892-8d11-4305-85dc-3126f4c16334/run.csv) | 2026-08-11 | `HANDED_OFF` | 미분류 |
| [darobe run-f6941951](darobe-run-f6941951-cef9-40ad-a7aa-abd6eb2ed584/run.csv) | 2026-07-21 | `HANDED_OFF` | 미분류 |
| [edamame run-7bf4f43c](edamame-run-7bf4f43c-8ec3-4d6c-88af-90d7bd81865a/run.csv) | 2026-08-20 | `HANDED_OFF` | 미분류 |
| [goryori_ken run-3d94448a](goryori_ken-run-3d94448a-5735-499a-8331-f89b3da8ce26/run.csv) | 2026-08-15 | `HANDED_OFF` | 미분류 |
| [gwanganmarket run-4a6c3616](gwanganmarket-run-4a6c3616-af72-4f71-9a35-10d6b25d0b12/run.csv) | 2026-08-21 | `HANDED_OFF` | 미분류 |
| [gwanganmarket run-4b569267](gwanganmarket-run-4b569267-ab39-4ce2-b4a7-e3c0261c16e3/run.csv) | 2026-08-20 | `HANDED_OFF` | 미분류 |
| [kiro run-231096aa](kiro-run-231096aa-99ab-47d2-a79f-49d654bb3bf6/run.csv) | 2026-08-22 | `HANDED_OFF` | 3,000명 이상 경쟁에서 예약 진행 성공 |
| [kiro run-a60acb2a](kiro-run-a60acb2a-75e4-40ca-9017-73f94a9d8fec/run.csv) | 2026-08-15 | `STOPPED` | 경쟁 실패 |
| [kiro run-c5d5bb4c](kiro-run-c5d5bb4c-a5a6-4f6e-a8c4-2a0ee7c69b83/run.csv) | 2026-08-29 | `HANDED_OFF` | 슬롯 클릭 후 경쟁 패배 |
| [kushitsuki run-e04e4c52](kushitsuki-run-e04e4c52-4072-4e86-b768-0ebde0680525/run.csv) | 2026-08-18 | `HANDED_OFF` | 미분류 |
| [laviok run-31542f72](laviok-run-31542f72-cdb8-403d-b956-d6a5cf7b6b28/run.csv) | 2026-08-25 | `HANDED_OFF` | 미분류 |
| [perigee_seoul run-1c05a9f8](perigee_seoul-run-1c05a9f8-fd7d-453c-8597-7a4ed9f4996f/run.csv) | 2026-08-29 | `HANDED_OFF` | 미분류 |
| [sangnamsushi run-b9643021](sangnamsushi-run-b9643021-0348-48ef-8773-a450ab8d95ad/run.csv) | 2026-08-22 | `STOPPED` | 예약 경쟁 패배 후 사용자 중지 |
| [sauvage run-b2869f41](sauvage-run-b2869f41-5c58-4130-ad33-c1a14cbebeb7/run.csv) | 2026-08-03 | `HANDED_OFF` | 미분류 |
| [yojeong run-942a73d3](yojeong-run-942a73d3-c1a5-40c6-b497-71030e3b5f58/run.csv) | 2026-08-13 | `HANDED_OFF` | 미분류 |
| [yunjudang run-4cf761da](yunjudang-run-4cf761da-8102-4971-9adf-ee9084fb3778/run.csv) | 2026-08-01 | `STOPPED` | 자리 선점 실패 후 사용자 중지 |
| [yunjudang run-c5d3458e](yunjudang-run-c5d3458e-1897-43c4-a3eb-4f26238a355c/run.csv) | 2026-08-01 | `STOPPED` | 실패 후 사용자 중지 |
| [yunjudang run-c742db22](yunjudang-run-c742db22-e1a1-46bf-baf3-776f1957456b/run.csv) | 2026-08-01 | `HANDED_OFF` | 3,000명 이상 경쟁에서 예약 진행 성공 |

관련 분석 대상:

- [Tier 2 Availability hot path](../../../specs/open-timing-performance/02-availability-hot-path/10-analysis.md)
- [슬롯 전환 결과](../../../specs/slot-transition-outcomes/10-analysis.md)
- [실행 진단 bundle](../../../specs/run-diagnostics/run-diagnostics.md)
- [XHR probe 최종 결정](../../../specs/open-timing-performance/02-availability-hot-path/80-probe-final-decision.md)
