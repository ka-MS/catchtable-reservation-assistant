# 2026-07-16 Live Runs

목란(`mokran`)에서 수집한 RT-14 실오픈 검증과 달력 호환성 진단 원본이다. 서로 다른 목적의 표본을 섞어 해석하지 않도록 아래 앵커로 구분한다.

## 바로가기

- [RT-14 EXACT EMPTY 실오픈](#rt14-exact-empty-live)
- [설정 적용 비교 표본](#probe-mode-comparison)
- [날짜 준비 전환 진단](#calendar-compatibility)
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
## 날짜 준비 전환 진단

| 실행 | 예약 날짜 | 종료 | 원본 메모 | 진단 |
|---|---|---|---|---|
| [mokran run-9708d102](mokran-run-9708d102-5e12-48a2-912d-8657ee547179/run.csv) | 2026-08-20 | `HANDED_OFF` | `목표 날짜 상태 확인불가(실제로는있음)` | [manifest](mokran-run-9708d102-5e12-48a2-912d-8657ee547179/diagnostic/manifest.json) |
| [mokran run-8b87f277](mokran-run-8b87f277-e782-4353-a925-7e1b05bc133f/run.csv) | 2026-08-20 | `HANDED_OFF` | `목표 날짜 상태 확인불가(실제로는있음)` | [manifest](mokran-run-8b87f277-e782-4353-a925-7e1b05bc133f/diagnostic/manifest.json), [screenshot](mokran-run-8b87f277-e782-4353-a925-7e1b05bc133f/screenshot.png) |
| [mokran run-ec09336f](mokran-run-ec09336f-3a3a-4d7a-b9b7-514163ee67bd/run.csv) | 2026-08-20 | `HANDED_OFF` | `목표 날짜 상태 확인불가(실제로는있음)` | [manifest](mokran-run-ec09336f-3a3a-4d7a-b9b7-514163ee67bd/diagnostic/manifest.json) |

세 실행은 같은 목란 탭에서 새로고침 없이 달력만 닫고 수동 재시작한 연속 실행이다. 목표 `2026-08-20`은 활성 Mobiscroll 42셀 안에서 선택 가능한 날짜로 판독됐지만 종료 시 선택값은 모두 `2026-08-19`였고 fingerprint도 `ds-34f12e4c`로 같았다. `run-ec09336f`에만 목표 날짜 클릭 action이 있고 후속 동일 목표 실행에는 날짜 클릭 action이 없다. 목표 날짜 DOM 부재나 파싱 실패가 아니라 첫 클릭의 선택 전환 불발, 실행 간 pending 상태 누출과 복구 부재의 증거로 분류한다.

종료 스냅샷은 모두 캡처 순간 `visible`·`hasFocus=true`였지만 클릭 전후와 전체 준비 구간은 기록하지 않는다. 사용자는 실행 중 예약 페이지가 주 포커스 화면은 아니었다고 확인했다. 따라서 focus는 가능한 환경 요인으로 남기되 직접 원인으로 확정하지 않는다. 이 세 실행은 RT-14 성능 표본에는 포함하지 않는다.

<a id="reservation-entry"></a>
## 예약창 진입 진단

| 실행 | 예약 날짜 | 종료 | 원본 메모 | 진단 |
|---|---|---|---|---|
| [mokran run-18dd8f4a](mokran-run-18dd8f4a-612b-49c5-aa3c-eb4fb33d9309/run.csv) | 2026-08-22 | `HANDED_OFF` | `예약하기 클릭 후 달력 화면을 확인할 수 없습니다 케이스` | [manifest](mokran-run-18dd8f4a-612b-49c5-aa3c-eb4fb33d9309/diagnostic/manifest.json) |

이 실행은 같은 탭 반복 조건에서 예약 CTA가 실행 시작 약 5.6초 뒤 한 번 클릭되고 약 69ms 뒤 달력 셀 없이 인계된 사례다. 종료 화면에는 활성 `예약하기` dock이 남았다. CTA dispatch 뒤 달력 출현 후조건을 확인할 시간과 bounded recovery가 없었던 예약창 진입 전환 정지 증거이며 RT-14 성능 표본에는 포함하지 않는다.

두 실패군은 모두 오케스트레이터의 `waitForOpen`·슬롯 탐색보다 앞선 자동 준비 단계에 속한다. 공통 Tier 3 판정과 복구 후보는 [runtime resilience 분석](../../../specs/open-timing-performance/03-runtime-resilience/10-analysis.md), DOM·전환 관찰 원본은 [site behavior §1.3](../../../analysis/site-behavior.md)에 정리한다.

## 보관 구조

원본 실행 폴더는 목적별 하위 폴더로 이동하지 않는다. 기존 규칙대로 `<restaurant>-run-<uuid>/`에 보관하고 이 README의 앵커에서 분류한다.
