# HANDOFF

**갱신:** 2026-07-16
**브랜치:** `codex/live-run-analysis-probe-decision`
**최신 작업 로그:** `docs/worklog/2026-07-15-06-redteam-review-counterfactual-instrumentation.md`
**최신 성능 설계 메모:** `docs/specs/open-timing-performance/02-availability-hot-path/100-three-signal-and-empty-early-exit.md`
**직전 작업 로그:** `docs/worklog/2026-07-15-05-live-run-analysis-probe-decision.md`
**최신 증거 정리 작업 로그:** `docs/worklog/2026-07-15-03-live-run-evidence-package.md`
**최신 실행 진단 작업 로그:** `docs/worklog/2026-07-15-02-run-diagnostic-bundle.md`
**최신 보조 작업 로그:** `docs/worklog/2026-07-14-10-payment-policy-ux-shortcut.md`
**핵심 hot-path 작업 로그:** `docs/worklog/2026-07-14-09-tier2-2-availability-hot-path.md`
**최신 RT-10M 실측:** `docs/worklog/2026-07-14-11-rt10m-yangjour-negative-control.md`
**최신 RT-10M 분석:** `docs/worklog/2026-07-15-01-rt10m-nuwa-measurement.md`
**최신 short-cut:** `docs/specs/run-telemetry/60-csv-export-shortcut.md`
**최신 호환성 수정:** `docs/specs/reservation-flow-compatibility/01-calendar-dom-compatibility/60-long-range-month-transition.md`

## 현재 상태

예약 흐름 호환성 패키지와 Tier 2-2 availability hot path의 fallback 보존형 구현·실제 오픈 기능 검증·RT-05 운영 격리를 완료했다.

재현이 어려운 실패 분석을 위해 실행 진단 bundle을 추가했다.

실측 원본은 `docs/evidence/live-runs`에 실행별로 정리했다.

- 2026-07-14 누와 RT-10M 4개 실행과 2026-07-15 다매장 22개 실행을 보관한다.
- 실행별 `run.csv`를 단일 원본으로 두고 진단 bundle은 같은 실행의 `diagnostic/` 아래에 둔다.
- 날짜별 README에서 모든 실행과 원본 메모를 찾을 수 있다.
- 26건 교차 분석에서 `EXACT/STRONG POPULATED` 20건, 설정 범위 일치 body와 슬롯 감지·클릭 19건, response-to-DOM 완전 표본 7건을 확인했다.
- 운영 오픈→클릭의 탐색적 p50은 계산할 수 있지만 공식 p95와 body wake p50/p95에는 부족하다.
- 키이로의 명시적 테이블 선정 실패를 retry case 1, 윤주당의 일시적 재시도 toast 후 shop·슬롯 화면 유지를 retry case 2로 분리했다.
- 사용자 확인 성공 표본인 키이로 `run-231096aa`와 윤주당 `run-c742db22`는 모두 cycle 3 `EXACT POPULATED` body를 관측했지만 `inactive_cycle`로 거절했고, cycle 4 DOM fallback으로 클릭했다.

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

Tier 2-2 availability hot-path는 fallback 보존형 구현과 RT-05 운영 격리를 완료했다.

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
- probe는 코드에 유지하되 고급 설정에서 명시적으로 켠 진단 실행에만 MAIN wrapper와 wake channel을 설치한다.
- 기본값과 구버전 설정의 누락값은 `false`이며, 일반 실행은 기존 bounded DOM 경로만 사용한다.

상태 표현:

> Tier 2-2 종료, probe 진단 전용 기본 비활성, body wake 성능 이득·공식 p95 미입증

공식 p95와 body wake 인과 이득은 후속 non-blocking 측정으로 남긴다. body actuator 승격은 승인하지 않는다.

사후 레드팀 리뷰(`docs/specs/open-timing-performance/02-availability-hot-path/90-redteam-review.md`)로 분석 근거를 재검증했다.

- RT-05 결정은 유지한다. 70-doc의 모든 표는 스크립트 재실행으로 전량 재현 일치했다.
- F2 counterfactual 계측을 구현했다. `wake_result`에 `baselineNextScanAtMonoMs`/`wakeScanAtMonoMs`/`wakeAdvanceMs`가 추가되어 다음 probe-on 진단 실오픈부터 RT-11 표본이 유효해진다.
- F3 시계 gating을 집계 스크립트에 추가했다. MEDIUM|HIGH + uncertainty ≤ 100ms gate에서 클릭 19건 중 13건이 통과하고 gated 오픈→클릭 p50은 `+1042ms`다(ungated `+1127ms`). 두 값 모두 참고값이며 공식 성능값이 아니다. gate는 오픈 대비 통계에만 적용하고, 성능 판정은 시계 독립적인 monotonic 구간 지표를 우선한다.
- 26건 actual-open은 전량 probe 상시 주입 빌드 표본이다. 운영 기본(probe off) 구성의 실오픈 확인 표본 1건이 필요하다(RT-12).
- RT-13(inactive_cycle 기회비용), RT-14(EXACT EMPTY cycle 조기 종료 검토)를 backlog에 등재했다. 중요 예약 시즌에는 착수하지 않는다.
- 3신호 구조(XHR POPULATED + narrow MutationObserver + 25ms polling)는 단일 coordinator·단일 click claim 후보로 문서화했지만 구현을 승인하지 않았다.
- RT-14는 3신호 구조와 독립적이다. 기존 XHR correlation에서 현재 cycle의 `EXACT EMPTY`를 별도 조기 종료 신호로 전달할 수 있으며 MutationObserver 제어 연결이 필요하지 않다.
- RT-14 counterfactual 분석은 hot path를 바꾸지 않아 먼저 수행할 수 있다. 실제 구현은 이론 절감 중앙값과 요청 증가량을 확인한 뒤 결정한다.
- BOM/CRLF로 수정돼 있던 evidence `run.csv` 26건을 커밋 상태로 복원했다.

## 검증 근거

- 결제 정책 UX 대상 테스트: 73/73 통과
- CSV short-cut 대상 테스트: 19/19 통과
- 전체 `npm run check`: 303/303 tests(wakeAdvanceMs 계측 2건 포함), typecheck, dist validation, MAIN/ISOLATED independence 통과
- probe 정책 Chrome live: 확장 재로드 후 `XHR 응답 진단` 기본 꺼짐, 토글 동작, Side Panel 재로드 후 꺼짐 복원, 경고·오류 없음 확인
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
- `docs/specs/open-timing-performance/02-availability-hot-path/70-live-run-analysis.md`
- `docs/specs/open-timing-performance/02-availability-hot-path/80-probe-final-decision.md`
- `docs/specs/open-timing-performance/02-availability-hot-path/100-three-signal-and-empty-early-exit.md`

## 다음 작업 1 - 실행 환경 진단

중요 예약 전에는 hot path 상수나 cycle 정책을 변경하지 않는다. 최소화·작은 4분할 실행의 실패 원인을 분리하기 위해 다음 표본부터 run 시작과 종료 스냅샷에 `document.visibilityState`, `document.hasFocus()`, viewport 크기와 진입 CTA 구조를 남기는 설계를 먼저 검토한다. 좁은 화면의 대체 CTA는 실제 DOM을 확보하기 전까지 추측으로 지원하지 않는다.

운영 시에는 예약 페이지를 정상 크기의 보이는 창으로 유지하고 최소화하지 않으며, 실행은 오픈 최소 60초 전에 시작한다(관측 20초 미만 실행들이 동결 clock uncertainty 상위였던 실측 기반 권고, 절대 조건 아님). 즉시 실행에서 사용자가 모달·날짜·인원을 준비할 수 있으면 `entryMode=prepared`로 자동 진입 단계를 생략할 수 있다.

## 다음 작업 2 - 공식 p95와 wake counterfactual

실제 `EMPTY -> POPULATED` 오픈에서 다음 원시 시각을 같은 cycle·requestSequence로 보존한다.

1. response completed
2. payload classified
3. bridge received
4. wake accepted
5. DOM candidate observed
6. slot dispatch 및 click 결과

`EXACT` 또는 `STRONG` 유효 표본만 집계한다. wake마다 기존 25ms loop의 다음 예정 scan 시각을 기록하는 `wakeAdvanceMs` 계측은 2026-07-15에 구현했으므로 다음 probe-on 진단 실오픈부터 표본이 유효하다. 오픈 대비 지연 집계에는 동결 ReferenceClock MEDIUM 이상 + uncertainty ≤ 100ms gate를 적용한다. 충분한 표본 전에는 20/40/60ms를 변경하거나 성능 이득을 주장하지 않는다.

## 다음 작업 3 - probe off 확인 표본 (RT-12)

기존 26건은 전량 probe 상시 주입 빌드에서 수집됐다. 다음 실제 오픈 1건을 기본값 그대로(probe off) 실행해 운영 기본 구성의 actual-open 확인 표본을 남긴다. 코드 변경 없음.

현재 26건은 기능·안전 판정과 탐색적 p50에는 사용할 수 있으나 동질 환경의 p95와 counterfactual에는 부족하다. 이 측정은 이후 성능 개선 근거이며 다음 제품 안정화 작업을 막지 않는다.

## 완료 작업 - RT-05 종료 gate

MAIN XHR probe를 진단·성능 실험 전용 기본 비활성으로 결정했다. 비활성 wrapper 미설치와 활성 MAIN bundle 주입, 주입 실패 fallback을 자동 테스트로 고정했다.

## 검증 명령

```bash
npm run check
git status --short --branch
```
