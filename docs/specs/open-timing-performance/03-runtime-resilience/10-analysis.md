# Tier 3 — 런타임 견고성 분석 (개요)

**상태:** RT-16 부분 구현, 구조화 미완료. 동일 탭 무새로고침 수동 재시작 E2E 완료.
**우산 분석:** `../open-timing-performance-analysis.md` §4 Tier 3.
**관련 backlog:** RT-08, RT-09, RT-16. RT-11은 Tier 2 공식 p95·wake counterfactual 측정에만 사용한다.

RT-16 상세 구현은 [오픈 전 준비 복원력 패키지](01-rt16-preparation-recovery/00-index.md)를 따른다. 현행 bounded retry와 상태 격리는 보존한다. Adapter·실패 분류·복구 정책·행동 실행·telemetry 책임 분리와 페이지 URL 재진입은 후속 구조화에서 완료한다.

## 범위 (개요)

- **탭·창 관리:** 오픈 직전 예약 탭 활성화 + 창 포커스. 배경 탭 타이머 스로틀(Chrome 88+, 체인 타이머 ~1s+)로 마지막 몇 초 고빈도 감시가 묶이는 것을 방지. `visibilitychange`로 임계 구간 hidden 감지 시 focus 요청·degraded 표시.
- **Service Worker 재시작 reconcile:** SW가 30초 유휴로 종료됐다 재기동될 때 런 상태 복구. `chrome.alarms`(최소 30초, 지연 가능)는 정밀 실행이 아니라 조기 기동 스케줄러로만.
- **페이지 새로고침 재주입:** 런 중 새로고침 시 Content Script 재주입·재학습.
- **오픈 전 준비 복원력:** 예약 CTA, 날짜, 인원 선택의 `dispatch -> UI 전이 확인 -> bounded recovery`를 구조화한다. 준비 실패를 슬롯 탐색 cycle의 성능 정책과 분리한다.
- **실패 주입 테스트 스위트.**

## 실행 경계

```text
Background.startRun/runOnTab
  -> 필요할 때만 target URL navigation
  -> Content START
  -> RunSession.prepareEntry
  -> RunSession.prepareDate
  -> RunSession.preparePerson
  -> RunSession.confirmPageReady
  -> RunSession.waitForOpen
  -> RunSession.searchAndReserve
```

동일 식당 URL이면 Background는 navigation을 생략한다. 따라서 같은 탭에서 달력만 닫고 다시 시작한 실행은 기존 SPA 문서 상태를 이어 쓸 수 있다. `prepareEntry/Date/Person`은 오케스트레이터 안에서 실행되지만 `waitForOpen`과 슬롯 탐색 hot path보다 앞선 준비 단계다. 이 구간의 복구·진단을 보강해도 25ms 슬롯 cycle의 상수나 claim 정책을 변경할 이유는 없다.

`OpenRunOrchestrator.start()`는 실행마다 `RunSession`을 새로 만들지만 Content Script가 생성한 `CalendarAdapter` 인스턴스는 같은 문서에서 재사용한다. `CalendarAdapter.prepareTarget()`은 `preparingTarget`이 바뀔 때만 `pendingDate`를 초기화한다. 따라서 동일 목표 날짜로 실패 후 재시작하면 이전 실행의 `pendingDate`가 남아 새 클릭 없이 `waiting`만 반환할 수 있다. `run-ec09336f`에만 8/20 클릭 action이 있고 뒤이은 동일 목표 실행에는 날짜 클릭 action이 없는 패턴과 일치한다.

## 2026-07-16 목란 실패 입력

원본 DOM·전환 사실은 [site-behavior §1.3](../../../analysis/site-behavior.md)에, 실행 파일은 [2026-07-16 evidence](../../../evidence/live-runs/2026-07-16/README.md)에 둔다.

| 실패군 | 직접 관측 | 현재 코드 종료 조건 | 분류 |
|---|---|---|---|
| 예약창 진입 | CTA 클릭 뒤 달력 셀 0, dock CTA 유지 | `prepareEntry()`가 CTA를 한 번 클릭한 뒤 5초 deadline에서 인계 | `ENTRY_TRANSITION_STALLED` 후보 |
| 날짜 선택 | 목표 8/20은 available, 선택은 8/19로 유지 | `CalendarAdapter.pendingDate`가 실행 경계를 넘어 남아 동일 목표의 후속 클릭을 막고 `prepareDate()`가 10초 뒤 인계 | `DATE_SELECTION_STALLED` 후보 |
| DOM 계약 변경 | 이번 표본에서는 목표 날짜와 활성 달력을 정상 판독 | 달력 증거를 Adapter가 인식하지 못할 때만 해당 | 이번 표본 아님 |
| focus/visibility | 종료 캡처 순간은 visible/focused, 구간 전체는 미관측 | 시작·클릭 전후·변화 시점 기록 없음 | 가능한 환경 요인, 원인 미확정 |

## 복구 정책의 분석 방향

복구는 클릭 성공 응답이 아니라 관측 가능한 UI 후조건을 기준으로 결정한다.

1. **dispatch:** 대상 노드가 연결·활성 상태인지 확인하고 클릭한다.
2. **confirm:** 예약 CTA는 달력 셀 출현, 날짜는 목표 날짜 selected, 인원은 목표 radio checked를 확인한다.
3. **classify:** DOM 계약 변경, 인증·대기열, 알려진 전환 정지, 단순 대기 상태를 구분한다.
4. **bounded retry:** 같은 동작 또는 알려진 닫기 동작 뒤 예약 CTA 재진입을 제한된 횟수만 허용한다.
5. **escalate:** 동일 탭 SPA 상태 초기화를 위한 새로고침은 세션·런 재구성 영향을 분석한 뒤 최종 복구 단계 후보로 둔다. 자동 적용은 아직 승인하지 않는다.
6. **handoff:** 재진입 실패, 인증, 대기열, 알 수 없는 DOM은 반복하지 않고 진단과 함께 사용자에게 인계한다.

월 이동의 기존 750ms·최대 3회 재시도는 `MONTH_TRANSITION_STALLED`에 해당한다. 이번 날짜 선택 불변과 CTA 미전환은 별도 후조건과 retry budget이 필요하므로 월 이동 정책을 그대로 복사하지 않는다. 날짜·인원·CTA별 허용 횟수와 전체 준비 deadline은 설계 단계에서 확정한다.

## 진단 계약 보강

현재 failure snapshot에는 `visibilityState`, `hasFocus`, viewport, 활성 요소, 달력 표시 월·선택 날짜·fingerprint가 있다. 그러나 종료 시점 중심이므로 클릭과 전환의 인과를 재구성하기 어렵다.

Tier 3 설계에서는 poll마다 DOM 전체를 저장하지 않고 다음 change-based event를 검토한다.

- 준비 단계 시작: runId, stage, 목표값, 현재 URL kind, 현재 후조건
- CTA·날짜·인원 클릭 직전과 dispatch 직후: visibility, focus, active element, 대상 식별자, 선택값, fingerprint
- 후조건 변화: 달력 셀 출현, selected date/person 변화, fingerprint 변화
- 정체 판정: 첫 불변 관측 시점, 불변 지속 시간, retry attempt, recovery decision
- Background 결합 정보: tabId, windowId, tab active, window focused
- 종료: failure code, 사용자 메시지, 최종 후조건, 시도 횟수

Content snapshot과 Background 탭 식별자는 서로 다른 실행 문맥에서 나오므로 runId로 결합한다. tab/window ID는 진단 상관용이며 DOM snapshot에 임의로 추정해 넣지 않는다.

## 성공 기준 초안

- 같은 탭에서 달력을 닫고 동일 목표 날짜로 다시 시작해도 stale 선택값을 성공으로 오인하거나 무기한 기다리지 않는다.
- 실행 종료 시 Adapter의 준비 pending 상태가 다음 `RunSession`으로 누출되지 않는다.
- CTA·날짜·인원별 클릭 횟수와 전체 복구 횟수에 명시적 상한이 있다.
- DOM 계약 변경과 전환 정지를 구분해 전자를 재진입으로 숨기지 않는다.
- 인증·대기열·알 수 없는 화면에서 자동 새로고침 또는 무한 반복하지 않는다.
- 준비 단계 진단만으로 dispatch 전후 후조건, focus/visibility 변화, tab/window 상관관계를 재구성할 수 있다.
- 준비 복구를 활성화해도 슬롯 탐색 hot path의 interval, claim guard, stopAt 불변식은 바뀌지 않는다.

## 실패 시나리오 (테스트 대상 초안)

```text
표본 60%가 +1000ms 스큐 클러스터에 몰림
두 클러스터 50:50 (모호 → LOW confidence)
RTT 급증 (100ms → 800ms)
응답 순서 역전 (늦은 empty가 populated 뒤 도착)
HTTP Date가 1초 단위로 반복 (경계 미교차)
런 도중 로컬 Date.now 2초 변경 (단조 시계로 흡수 확인)
탭이 hidden으로 전환
페이지 새로고침
Service Worker 종료 후 재기동
예약 CTA 클릭 뒤 달력 셀 미출현
목표 날짜 클릭 뒤 이전 날짜 selected 유지
인원 클릭 뒤 이전 radio checked 유지
populated 응답 3개 연속 도착 (claim guard 1회 보장 — Tier 2 연계)
예약 클릭 직후 DOM 재렌더링
```

## 최상위 불변식 (전 티어 공통 재확인)

```text
시계가 ±1초 틀려도 슬롯 응답 전에는 예약 실행하지 않는다.
슬롯 응답이 오면 시계가 틀려도 즉시 실행한다.
```
