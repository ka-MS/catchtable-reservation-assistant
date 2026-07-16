# RT-16 검증 — 오픈 전 준비 복원력

## 자동 검증

2026-07-16 기준 다음 명령을 통과했다.

```bash
npm run check
git diff --check
```

결과:

- 전체 테스트 `336/336`
- TypeScript typecheck 통과
- dist 검증 통과
- MAIN/ISOLATED 독립성 검증 통과

## RT-16A

- Background의 tabId/windowId와 START 시점 active/focused를 run context로 전달한다.
- Content의 visibility/focus/viewport/active element/URL kind/fingerprint를 준비 event마다 기록한다.
- stage 시작, 후조건 변화, dispatch 전후, 최종 decision만 `PREPARATION_OBSERVED`로 기록한다.
- 페이지 본문·입력값·URL query를 수집하지 않는 테스트를 통과했다.

## RT-16B

- 날짜 준비 시작 시 CalendarAdapter의 pending month/date, 요청 시각과 attempt를 초기화한다.
- 동일 Adapter·동일 목표 날짜를 연속 사용해도 reset 뒤 두 번째 독립 클릭이 발생한다.
- 실제 `CalendarAdapter`와 동일 `OpenRunOrchestrator`를 두 실행에서 재사용하는 통합 테스트에서 첫 실행의 bounded handoff 뒤, 새로고침 없이 두 번째 실행이 독립 날짜 dispatch를 거쳐 `DRY_RUN_COMPLETED`에 도달한다.
- Tier 2에서 사용하는 `inspect()`와 `clickDate()` 계약은 유지한다.

## RT-16C

- CTA, 날짜, 인원은 최초 dispatch와 재시도 각 1회, 총 2회로 제한한다.
- 재시도 간격은 1초이며 CTA·인원은 최초 dispatch 후 최대 2초 확인 budget을 갖는다.
- 성공 후조건이 나타나면 기존 준비·대기·슬롯 흐름으로 진행한다.
- 계속 정체되면 `ENTRY_TRANSITION_STALLED`, `DATE_SELECTION_STALLED`, `PERSON_SELECTION_STALLED`와 attempt 수를 terminal handoff에 남긴다.
- `stopAt`, waiting-only, 인원 unavailable과 기존 blocked 판정을 우선한다.

## Chrome live 운영 확인

2026-07-16 Chrome 원격 디버깅을 허용한 뒤 최신 `dist`를 reload하고 목란에서 안전 점검 모드로 검증했다.

- 확장 ID: `olbclnjiehfelpfmgmdphfmenapmpaal`
- 버전: `0.2.0`
- load path: `\\wsl.localhost\Ubuntu\home\developer\source\catchtable-reserve\dist`
- 공통 tab/window: `494281626` / `494281386`
- 설정: 목란, `2026-08-20`, 3명, 17:00–21:00, `dryRun=true`, 자동 페이지 준비

첫 실행은 선택값 8/19를 유지하도록 목표 8/20 날짜 click을 capture 단계에서 두 번 차단했다. `run-e2a5c932-aafe-422b-8201-e82b87283238`은 날짜 dispatch attempt 1·2를 모두 기록하고 `DATE_SELECTION_STALLED`, attempt 2, `HANDED_OFF`로 종료했다. IndexedDB run eventCount와 실제 event 수는 `33=33`, seq는 연속이고 dropped는 0이다.

그 상태에서 페이지를 reload하지 않고 달력의 `닫기`만 눌렀다. click 차단을 제거하고 동일 tabId로 즉시 재시작한 `run-40f9f982-75bf-42b8-9dd3-077f8e2e19f8`은 독립적인 날짜 dispatch attempt 1로 8/20을 선택했다. 인원 3명 확인, `WAITING_FOR_OPEN`, 슬롯 탐색을 거쳐 오후 5:00 슬롯을 감지했고 실제 클릭 없이 `DRY_RUN_COMPLETED`로 종료했다. URL과 DOM 선택값은 각각 `date=260820&personCount=3`, 8/20, 3명이었다. IndexedDB는 `42=42`, seq 연속, dropped 0이다.

두 실행의 모든 준비 event에 같은 runTabId/runWindowId와 START active/focused, event 시점 `visibilityState=visible`, `hasFocus=true`가 기록됐다. Side Panel 실행 선택에는 실패 run과 복구 run이 각각 `HANDED_OFF`, `DRY_RUN_COMPLETED`로 표시됐다. 페이지 Console의 error/warn/issue는 없었고 예약 calendar/time-slot/near-full 요청은 200이었다. 초기 페이지의 비예약 `collections/count` 401 한 건은 실행 흐름에 영향을 주지 않았다.

테스트 후 예약 설정은 기존 8/19·실행 모드로 복원했고 저장된 예약 작업 22개는 변경하지 않았다.

## 판정

구현·자동 gate·적대적 검토·동일 탭 무새로고침 Chrome live E2E를 모두 통과했다. RT-16은 `DONE`이다.
