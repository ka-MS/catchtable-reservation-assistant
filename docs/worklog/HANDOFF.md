# HANDOFF

**갱신:** 2026-07-16
**브랜치:** `codex/rt14-exact-empty-early-exit`
**최신 작업 로그:** `docs/worklog/2026-07-16-05-rt16-preparation-recovery.md`
**최신 Tier 3 구현:** `docs/specs/open-timing-performance/03-runtime-resilience/01-rt16-preparation-recovery/`
**최신 기준시계 구현:** `docs/specs/open-timing-performance/01-reference-clock-reliability/01-raw-sample-trace/`
**최신 Tier 3 분석:** `docs/specs/open-timing-performance/03-runtime-resilience/10-analysis.md`
**최신 성능 구현:** `docs/specs/open-timing-performance/02-availability-hot-path/03-exact-empty-early-exit/`
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
- RT-13(inactive_cycle 기회비용)은 backlog에 유지한다. 중요 예약 시즌에는 착수하지 않는다.
- 3신호 구조(XHR POPULATED + narrow MutationObserver + 25ms polling)는 단일 coordinator·단일 click claim 후보로 문서화했지만 구현을 승인하지 않았다.
- RT-14는 3신호 구조와 독립적으로 분석·구현했다. MutationObserver 제어 연결은 추가하지 않았다.
- BOM/CRLF로 수정돼 있던 evidence `run.csv` 26건을 커밋 상태로 복원했다.

RT-14 EXACT EMPTY cycle 조기 종료를 구현하고 자동·Chrome 검증을 완료했다.

- XHR 응답 모드는 `off | observe | empty_exit` 단일 설정이며 기본값은 `off`다.
- legacy `availabilityProbeEnabled=true`는 `observe`, false/누락은 `off`로 복원한다.
- current active cycle의 non-stale 최신 `EXACT EMPTY`만 조기 종료 신호로 수용한다.
- 최초 DOM scan과 목표 날짜 guard 직후 최종 DOM scan 모두에서 슬롯 후보가 EMPTY보다 우선한다.
- 목표 날짜 selected가 풀리면 EMPTY를 폐기하고 기존 25ms fallback을 유지한다.
- 조기 종료 후 무제한 재클릭하지 않고 기존 `nextTogglePlan()`과 stop/timeout을 재사용한다.
- 기존 26건 counterfactual에서 다음 target 이론 선행 p50 약 281ms를 확인했지만 실제 성능 이득과 요청 증가량은 아직 미확정이다.
- 목란 비중요 실제 오픈의 기능·안전 gate는 통과했다. 동등한 비교군으로 성능과 요청 증가량을 확인하기 전까지 기본 활성화하지 않는다.
- 2026-07-16 목란 실오픈에서 cycle 1의 current `EXACT EMPTY`를 수락하고 7ms 뒤 `EMPTY_EARLY_EXIT`로 종료했다.
- 같은 실행은 오픈 후 cycle 10에서 슬롯을 발견해 서버 기준 `+891ms`에 클릭하고 예약 폼까지 도달했다. 비신뢰·비활성 응답의 제어 오수용과 DOM 후보 손실은 관측되지 않았다.
- RT-14 기능·안전 실오픈 gate는 통과했다. 동등한 `off` 비교군이 없어 실제 성능 이득과 요청 증가량은 미확정이며 기본값은 `off`를 유지한다.

2026-07-16 목란 준비 단계 실패 4건을 Tier 3 runtime resilience 입력으로 분석했다.

- 같은 탭에서 새로고침 없이 달력만 닫고 반복 실행한 조건이다.
- 날짜 실패 3건은 목표 8/20이 available이었지만 선택값 8/19와 동일 fingerprint가 유지됐다. 첫 실행에만 8/20 클릭 action이 있고, 같은 문서에서 재사용된 `CalendarAdapter.pendingDate`가 후속 동일 목표 실행까지 남을 수 있음을 확인했다.
- 예약창 진입 실패 1건은 CTA를 늦게 한 번 클릭한 직후 달력 셀 없이 인계됐다.
- 직접 실패는 DOM 파싱 부재가 아니라 클릭 뒤 UI 전이 불발과 bounded recovery 부재로 분류했다.
- 종료 snapshot의 visible/focused만으로 구간 전체 focus를 설명할 수 없어 포커스 원인은 미확정으로 유지했다.
- Tier 3 분석·RT-16·site behavior·evidence 판정을 보강했으며 코드와 hot path는 변경하지 않았다. RT-11은 공식 p95·wake counterfactual 측정 ID로 유지한다.

RT-15 기준시계 원시 표본 trace 구현과 자동 검증을 완료했다.

- 기존 최대 64개 `ReferenceClockSampler` ring을 actual arm에서 stop/drain하고 RunSession 메모리에 동결한다.
- arm 전 종료는 terminal 경계에서 같은 동작을 수행하며, terminal `finally`에서만 `CLOCK_SAMPLE` event를 생성해 기존 flush에 합류시킨다.
- estimator, monotonic anchor, armLead, 날짜 토글과 슬롯 제어 hot path는 변경하지 않았다.
- raw event는 Side Panel 운영 목록에서 숨기고 CSV·진단 bundle에는 보존한다.
- raw event의 `state=null` 계약으로 기존 run finalState와 finishedAt을 보존한다.
- terminal 전 Content context 강제 종료와 trace queue overflow에서는 일부 raw 표본이 유실될 수 있으며 진단 best-effort 정책으로 수용했다.

RT-16 오픈 전 준비 복원력을 `DONE`으로 종료했다.

- RT-16A는 START 시점 tab/window 문맥과 준비 event 시점 visibility/focus/viewport/fingerprint를 `PREPARATION_OBSERVED`로 결합한다.
- RT-16B는 auto run마다 CalendarAdapter preparation state를 reset해 동일 날짜 `pendingDate` 누출을 제거한다.
- RT-16C는 CTA·날짜·인원을 총 2회로 제한하고 1초 뒤 한 번만 재시도한다.
- 계속 정체되면 단계별 error code, attempt count와 recovery decision을 terminal handoff에 남긴다.
- CTA discovery deadline과 클릭 후 confirmation deadline을 분리해 늦은 CTA 클릭 직후 즉시 인계되던 경계를 수정했다.
- Tier 2 slot loop, wake, EMPTY 조기 종료와 claim 정책은 변경하지 않았다.
- 실제 `CalendarAdapter`와 동일 `OpenRunOrchestrator`를 재사용한 두 연속 실행에서 첫 bounded handoff 뒤 두 번째 실행이 독립 날짜 dispatch를 거쳐 `DRY_RUN_COMPLETED`에 도달했다.
- Chrome 동일 탭에서 날짜 click 2회를 차단한 첫 실행은 attempt 2 `DATE_SELECTION_STALLED`로 인계됐고, 달력만 닫은 뒤 무새로고침 재시작은 독립 날짜 dispatch로 8/20을 선택해 `DRY_RUN_COMPLETED`에 도달했다.
- 두 live run은 같은 tabId/windowId를 공유하고 IndexedDB eventCount 일치, seq 연속, dropped 0이며 준비 event의 focus/visibility 문맥도 확인했다. RT-16은 `DONE`이다.

## 검증 근거

- 결제 정책 UX 대상 테스트: 73/73 통과
- CSV short-cut 대상 테스트: 19/19 통과
- 전체 `npm run check`: 303/303 tests(wakeAdvanceMs 계측 2건 포함), typecheck, dist validation, MAIN/ISOLATED independence 통과
- RT-14 전체 `npm run check`: 315/315 tests, typecheck, dist validation, MAIN/ISOLATED independence 통과
- RT-15 전체 `npm run check`: 323/323 tests, typecheck, dist validation, MAIN/ISOLATED independence 통과
- RT-16 전체 `npm run check`: 336/336 tests, typecheck, dist validation, MAIN/ISOLATED independence 통과
- RT-16 Chrome live: `run-e2a5c932` HANDED_OFF(33 events, DATE_SELECTION_STALLED attempt 2) → 같은 탭 무새로고침 `run-40f9f982` DRY_RUN_COMPLETED(42 events), 양쪽 dropped 0
- RT-14 Chrome live: 3상태 radio 표시, `empty_exit` 저장·재로드 복원, `off` 원복, Side Panel 런타임 오류 없음
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
- `docs/specs/open-timing-performance/02-availability-hot-path/03-exact-empty-early-exit/40-verification.md`
- `docs/specs/open-timing-performance/02-availability-hot-path/03-exact-empty-early-exit/50-adversarial-review.md`

## 다음 작업 0 - RT-14 성능 비교 표본

목란 실제 오픈으로 `EMPTY → EMPTY_EARLY_EXIT → 후속 cycle 슬롯 발견` 기능·안전 경로는 확인했다. 다음 비중요 실오픈에서는 동일 매장·유사 환경의 `off` 또는 반복 `empty_exit` 표본을 추가해 cycle·요청 증가량과 실제 지연 차이를 비교한다. 이 비교 전에는 `empty_exit`을 기본값으로 승격하지 않는다. 성능 비교는 다른 안정화 작업을 막지 않는다.

## 완료 작업 - RT-16 실행 환경 진단과 준비 복구

중요 예약 전에는 hot path 상수나 cycle 정책을 변경하지 않는다. run 시작과 CTA·날짜·인원 준비 경계에 `document.visibilityState`, `document.hasFocus()`, viewport, 선택값과 fingerprint를 change-based event로 남기고 Background의 tabId/windowId·active/focused를 runId로 결합했다. 좁은 화면의 대체 CTA는 실제 DOM을 확보하기 전까지 추측으로 지원하지 않는다.

준비 단계 복구는 `dispatch -> confirm -> classify -> bounded recovery -> handoff` 순서로 구현했다. CTA·날짜·인원은 총 2회 dispatch로 제한하고 인증·대기열·알 수 없는 DOM은 자동 반복하지 않는다. 자동 새로고침은 범위에서 제외했으며 슬롯 탐색 hot path와 분리했다.

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
