# 2026-07-16 Live Runs

목란(`mokran`)에서 수집한 RT-14 실오픈 검증과 달력 호환성 진단 원본이다. 서로 다른 목적의 표본을 섞어 해석하지 않도록 아래 앵커로 구분한다.

## 바로가기

- [RT-14 EXACT EMPTY 실오픈](#rt14-exact-empty-live)
- [설정 적용 비교 표본](#probe-mode-comparison)
- [달력 호환성 진단](#calendar-compatibility)
- [예약창 진입 진단](#reservation-entry)

<a id="rt14-exact-empty-live"></a>
## RT-14 EXACT EMPTY 실오픈

| 실행 | 예약 날짜 | 종료 | 판정 | 진단 |
|---|---|---|---|---|
| [mokran run-85a4f2c0](mokran-run-85a4f2c0-9ca5-41ac-b3b6-0334b53cf2f2/run.csv) | 2026-08-19 | `HANDED_OFF` | `empty_exit` 적용, 슬롯 클릭 후 예약 폼 도달 | [case](mokran-run-85a4f2c0-9ca5-41ac-b3b6-0334b53cf2f2/case.md), [manifest](mokran-run-85a4f2c0-9ca5-41ac-b3b6-0334b53cf2f2/diagnostic/manifest.json) |

이 실행에서 cycle 1의 current `EXACT EMPTY`가 수락됐고 7ms 뒤 `EMPTY_EARLY_EXIT`로 종료됐다. 오픈 후 cycle 10에서 슬롯을 찾아 서버 기준 `+891ms`에 클릭했고 예약 폼까지 도달했다. 상세 판정은 [RT-14 실오픈 검증](../../../specs/open-timing-performance/02-availability-hot-path/03-exact-empty-early-exit/60-live-verification.md)을 기준으로 한다.

<a id="probe-mode-comparison"></a>
## 설정 적용 비교 표본

| 실행 | 예약 날짜 | 종료 | 원본 메모 | 진단 |
|---|---|---|---|---|
| [mokran run-e6282c7e](mokran-run-e6282c7e-5141-4300-9e02-bfea32e0c58a/run.csv) | 2026-08-22 | `HANDED_OFF` | `예약실행이 아닌 지금시작 xhr e 켰으나 실제로그에는 적용안됨` | [manifest](mokran-run-e6282c7e-5141-4300-9e02-bfea32e0c58a/diagnostic/manifest.json) |

manifest의 설정값은 `empty_exit`이지만 RT-14 전용 `empty_early_exit` trace가 없다. 실행 방식과 시작 조건이 달라 성능 비교군으로 사용하지 않는다.

<a id="calendar-compatibility"></a>
## 달력 호환성 진단

| 실행 | 예약 날짜 | 종료 | 원본 메모 | 진단 |
|---|---|---|---|---|
| [mokran run-9708d102](mokran-run-9708d102-5e12-48a2-912d-8657ee547179/run.csv) | 2026-08-20 | `HANDED_OFF` | `목표 날짜 상태 확인불가(실제로는있음)` | [manifest](mokran-run-9708d102-5e12-48a2-912d-8657ee547179/diagnostic/manifest.json) |
| [mokran run-8b87f277](mokran-run-8b87f277-e782-4353-a925-7e1b05bc133f/run.csv) | 2026-08-20 | `HANDED_OFF` | `목표 날짜 상태 확인불가(실제로는있음)` | [manifest](mokran-run-8b87f277-e782-4353-a925-7e1b05bc133f/diagnostic/manifest.json), [screenshot](mokran-run-8b87f277-e782-4353-a925-7e1b05bc133f/screenshot.png) |
| [mokran run-ec09336f](mokran-run-ec09336f-3a3a-4d7a-b9b7-514163ee67bd/run.csv) | 2026-08-20 | `HANDED_OFF` | `목표 날짜 상태 확인불가(실제로는있음)` | [manifest](mokran-run-ec09336f-3a3a-4d7a-b9b7-514163ee67bd/diagnostic/manifest.json) |

이 세 실행은 달력 DOM과 선택 상태 확인 문제의 호환성 증거다. RT-14 성능 표본에는 포함하지 않는다.

<a id="reservation-entry"></a>
## 예약창 진입 진단

| 실행 | 예약 날짜 | 종료 | 원본 메모 | 진단 |
|---|---|---|---|---|
| [mokran run-18dd8f4a](mokran-run-18dd8f4a-612b-49c5-aa3c-eb4fb33d9309/run.csv) | 2026-08-22 | `HANDED_OFF` | `예약하기 클릭 후 달력 화면을 확인할 수 없습니다 케이스` | [manifest](mokran-run-18dd8f4a-612b-49c5-aa3c-eb4fb33d9309/diagnostic/manifest.json) |

이 실행은 예약 CTA 클릭 후 달력 진입 확인 실패를 기록한 호환성 증거다. RT-14 성능 표본에는 포함하지 않는다.

## 보관 구조

원본 실행 폴더는 목적별 하위 폴더로 이동하지 않는다. 기존 규칙대로 `<restaurant>-run-<uuid>/`에 보관하고 이 README의 앵커에서 분류한다.
