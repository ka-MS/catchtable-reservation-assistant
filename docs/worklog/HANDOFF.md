# HANDOFF

**갱신:** 2026-07-15
**브랜치:** `codex/run-diagnostic-bundle`
**최신 작업 로그:** `docs/worklog/2026-07-15-03-live-run-evidence-package.md`
**최신 실행 진단 작업 로그:** `docs/worklog/2026-07-15-02-run-diagnostic-bundle.md`
**최신 보조 작업 로그:** `docs/worklog/2026-07-14-10-payment-policy-ux-shortcut.md`
**핵심 hot-path 작업 로그:** `docs/worklog/2026-07-14-09-tier2-2-availability-hot-path.md`
**최신 RT-10M 실측:** `docs/worklog/2026-07-14-11-rt10m-yangjour-negative-control.md`
**최신 RT-10M 분석:** `docs/worklog/2026-07-15-01-rt10m-nuwa-measurement.md`
**최신 short-cut:** `docs/specs/run-telemetry/60-csv-export-shortcut.md`
**최신 호환성 수정:** `docs/specs/reservation-flow-compatibility/01-calendar-dom-compatibility/60-long-range-month-transition.md`

## 현재 상태

예약 흐름 호환성 패키지의 달력, 결제 방식, 좌석·메뉴, 실제 폼 인계 검증을 완료했다. 이어 RT-10M 측정을 기다리는 동안 hot path와 독립적인 결제 정책 UX를 단축 절차로 보완했다.

재현이 어려운 실패 분석을 위해 실행 진단 bundle을 추가했다.

실측 원본은 `docs/evidence/live-runs`에 실행별로 정리했다.

- 2026-07-14 누와 RT-10M 4개 실행과 2026-07-15 다매장 22개 실행을 보관한다.
- 실행별 `run.csv`를 단일 원본으로 두고 진단 bundle은 같은 실행의 `diagnostic/` 아래에 둔다.
- 날짜별 README에서 모든 실행과 원본 메모를 찾을 수 있다.
- 2026-07-15 신규 표본의 성능·실패 원인 분석은 아직 수행하지 않았다.

- 최근 3개 저빈도 breadcrumb는 Content 메모리에만 두고 정상 실행에서는 폐기한다.
- 예기치 않은 `HANDED_OFF`, `TIMED_OUT`, `FAILED`에서 구조화 DOM snapshot과 정제 fragment를 저장한다.
- IndexedDB는 v2이며 기존 `runs/events`를 보존하고 `snapshots` store만 추가한다.
- 상세 추적의 `진단` 버튼은 CSV, events JSONL, DOM snapshots, 환경, fragment를 ZIP으로 내보낸다.
- 슬롯 갱신·감지·클릭 전 hot path, XHR probe, mutation callback에는 DOM 진단 캡처를 넣지 않았다.

- `결제 방식까지 자동 진행`이 켜진 경우 `예약금 0원 방식만`과 `사이트에서 선택된 방식 허용` 중 하나를 고른다.
- 기본값과 구버전 복원값은 기존 동작을 보존하는 `사이트에서 선택된 방식 허용`이다.
- 어떤 정책에서도 선택되지 않은 유료 방식을 임의로 선택하지 않는다.
- `20,000원`을 `0원` 방식으로 오인하던 부분 문자열 판별을 금액 경계 판별로 수정했다.
- 슬롯 탐색, 날짜 토글, 서버 시계, XHR probe와 wake 경로는 이번 단축 패치에서 변경하지 않았다.
- 뽈뽀의 2개월 이상 장거리 날짜 준비에서 최초 월 이동 클릭이 유실되면 같은 월을 무기한 기다리던 문제를 수정했다. 750ms 간격 최대 3회 bounded retry이며 슬롯 탐색 hot path에는 영향이 없다.

Tier 2-2 availability hot-path는 fallback 보존형 구현과 비최종 안전 검증을 완료한 상태다.

- 검증된 현재 cycle `EXACT/STRONG` body만 DOM scan wake-up 후보로 사용한다.
- body는 슬롯을 선택하거나 클릭하지 않는다.
- 최종 후보와 클릭 직전 유효성은 기존 `SlotAdapter`가 DOM에서 다시 확인한다.
- body 부재, WEAK/NONE, stale, malformed, probe·observer·trace 실패는 기존 bounded DOM 경로로 폴백한다.
- body 이후 DOM이 늦게 렌더되면 현재 cycle만 최대 250ms 보존하고 `stopAt`은 넘지 않는다.
- 20ms settling, 40ms switch lead, 60ms confirmation cap은 실제 p95 근거가 없어 유지했다.
- 예약 drawer가 `main` 밖 portal에 렌더되는 live 구조를 fixture로 고정하고 SlotAdapter 범위를 보완했다.
- 양주르 실제 오픈에서 target body가 `EMPTY -> POPULATED`로 바뀌고 `EXACT`로 상관되는 것을 확인했다.
- 해당 실행은 설정 시간 18:30-21:00과 열린 슬롯 11:00·15:00·15:30·17:30이 불일치해 미클릭이 정상인 음성 표본이다.
- 종료된 실행의 상세 추적에서 `[CSV] [삭제]` 순서로 전체 Trace CSV를 내보낼 수 있다.
- CSV는 Excel-safe 문자열인 원본 epoch ms와 전체 KST 시각을 함께 보존하고 동적 trace attributes를 열로 펼친다.
- 화면은 최신 100개만 유지하지만 CSV는 IndexedDB의 해당 run 전체 이벤트를 읽는다.
- CSV short-cut은 예약 오케스트레이터, 날짜 토글, XHR probe, wake, SlotAdapter를 변경하지 않았다.
- 누와 실제 오픈에서 일치 슬롯까지 도달한 로컬 표본 2개를 확보했다. 두 실행 모두 dropped 0이었다.
- 전면 표본은 서버 기준 오픈 약 +893ms에 슬롯 클릭, +1560ms에 후속 화면 확인, +1857ms에 예약 폼 최초 관측, +2253ms에 인계까지 도달했다. 최종 예약 성공은 사용자가 확인했다.
- 전면 표본의 `EXACT POPULATED` body는 이전 cycle로 늦게 도착해 `inactive_cycle`로 거절됐고, 다음 cycle의 기존 DOM 경로가 슬롯을 찾았다.
- 최소화 표본은 body wake를 수용했지만 wake-to-DOM 약 482ms로 250ms window를 넘겨 fallback했으며, 슬롯 클릭 뒤 화면 전환을 확인하지 못했다.
- 다른 최소화 표본에는 수십 초의 cycle 간격이 나타났다. 작은 4분할 창의 신규 PC 표본은 예약 CTA를 찾지 못했지만 viewport·visibility 정보가 없어 원인은 아직 확정하지 않는다.

상태 표현:

> 실제 오픈 기능 검증 완료, body wake 성능 이득 미입증, 환경 진단과 RT-05 판정 대기

성능 향상 완료 또는 Tier 2-2 최종 종료를 선언하지 않는다.

## 검증 근거

- 결제 정책 UX 대상 테스트: 73/73 통과
- CSV short-cut 대상 테스트: 19/19 통과
- 전체 `npm run check`: 296/296 tests, typecheck, dist validation, MAIN/ISOLATED independence 통과
- 실행 진단 Chrome live: IndexedDB v2에서 기존 runs 20/events 740 보존, snapshots store 생성, 실제 ZIP 다운로드와 Windows 기본 압축 해제 통과
- CSV Chrome live 확인: 원격 디버깅 미연결로 대기
- `git diff --check` 통과
- extension: `olbclnjiehfelpfmgmdphfmenapmpaal`, version `0.2.0`
- load path: `\\wsl.localhost\Ubuntu\home\developer\source\catchtable-reserve\dist`
- live dry-run: `run-9e67fd6e-29a4-4def-87f8-244f0960e84f`
- 결과: `DRY_RUN_COMPLETED`, 24 events, seq `1..24`, dropped 0
- wake: cycle 1 / request 4 / EXACT / candidate found / fallback false
- wake-to-DOM 약 0.1ms, response-to-DOM 약 20.4ms
- 슬롯·결제·약관·최종 예약 클릭 0회

상세 문서:

- `docs/specs/run-diagnostics/run-diagnostics.md`
- `docs/specs/run-diagnostics/40-verification.md`
- `docs/specs/run-diagnostics/50-adversarial-review.md`
- `docs/specs/open-timing-performance/02-availability-hot-path/10-analysis.md`
- `docs/specs/open-timing-performance/02-availability-hot-path/20-design.md`
- `docs/specs/open-timing-performance/02-availability-hot-path/30-implementation.md`
- `docs/specs/open-timing-performance/02-availability-hot-path/40-verification.md`
- `docs/specs/open-timing-performance/02-availability-hot-path/50-adversarial-review.md`

## 다음 작업 1 - 실행 환경 진단

중요 예약 전에는 hot path 상수나 cycle 정책을 변경하지 않는다. 최소화·작은 4분할 실행의 실패 원인을 분리하기 위해 다음 표본부터 run 시작과 종료 스냅샷에 `document.visibilityState`, `document.hasFocus()`, viewport 크기와 진입 CTA 구조를 남기는 설계를 먼저 검토한다. 좁은 화면의 대체 CTA는 실제 DOM을 확보하기 전까지 추측으로 지원하지 않는다.

운영 시에는 예약 페이지를 정상 크기의 보이는 창으로 유지하고 최소화하지 않는다. 즉시 실행에서 사용자가 모달·날짜·인원을 준비할 수 있으면 `entryMode=prepared`로 자동 진입 단계를 생략할 수 있다.

## 다음 작업 2 - RT-10M 추가 전면 표본

실제 `EMPTY -> POPULATED` 오픈에서 다음 원시 시각을 같은 cycle·requestSequence로 보존한다.

1. response completed
2. payload classified
3. bridge received
4. wake accepted
5. DOM candidate observed
6. slot dispatch 및 click 결과

`EXACT` 또는 `STRONG` 유효 표본만 집계한다. 여러 실행에서 p50/p95를 계산하고 body wake가 기존 25ms polling 잔여를 실제로 줄이는지 판정한다. 그 전에는 20/40/60ms를 변경하거나 성능 이득을 주장하지 않는다.

2026-07-15 누와 실측은 일치 슬롯의 실제 오픈 기능 검증을 충족한다. 다만 유효한 전면 표본이 1개뿐이고 body wake가 클릭 경로를 단축한 표본은 0개라 p50/p95나 상수 조정 근거로는 부족하다. 추가 전면 표본이 생기기 전까지 현재 상수와 fallback을 유지한다.

## 다음 작업 3 - RT-05 종료 gate

추가 전면 표본 또는 현재 제한을 명시한 판독 뒤 MAIN XHR probe를 다음 중 하나로 결정한다.

- 진단 모드 전용
- 성능 이득이 없으면 제거
- 제한된 관측 경로로 기본 비활성 유지

비활성 시 wrapper 미설치, 활성 시 원본 의미 보존·종료 원복·제어 독립성 회귀를 통과해야 Tier 2-2를 최종 종료할 수 있다.

## 검증 명령

```bash
npm run check
git status --short --branch
```
