# RT-16 검증 — 오픈 전 준비 복원력

## 자동 검증

2026-07-16 기준 다음 명령을 통과했다.

```bash
npm run check
git diff --check
```

결과:

- 전체 테스트 `335/335`
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
- Tier 2에서 사용하는 `inspect()`와 `clickDate()` 계약은 유지한다.

## RT-16C

- CTA, 날짜, 인원은 최초 dispatch와 재시도 각 1회, 총 2회로 제한한다.
- 재시도 간격은 1초이며 CTA·인원은 최초 dispatch 후 최대 2초 확인 budget을 갖는다.
- 성공 후조건이 나타나면 기존 준비·대기·슬롯 흐름으로 진행한다.
- 계속 정체되면 `ENTRY_TRANSITION_STALLED`, `DATE_SELECTION_STALLED`, `PERSON_SELECTION_STALLED`와 attempt 수를 terminal handoff에 남긴다.
- `stopAt`, waiting-only, 인원 unavailable과 기존 blocked 판정을 우선한다.

## Chrome live 상태

확장 reload와 동일 탭 반복 실행을 시도했으나 현재 Chrome DevTools 원격 디버깅 endpoint가 응답하지 않았다. 대체 Chrome 제어 경로는 보안 정책상 `chrome://extensions` 접근이 차단돼 최신 `dist` reload를 검증할 수 없었다.

따라서 live gate는 미통과가 아니라 **미실행**이다. 다음 검증에서는 원격 디버깅을 활성화한 뒤 확장을 reload하고 같은 매장 탭에서 달력을 닫은 채 동일 설정을 두 번 실행해 다음을 확인한다.

1. 두 실행 모두 날짜 dispatch가 독립적으로 발생한다.
2. `PREPARATION_OBSERVED`에 runTabId/runWindowId와 클릭 시점 page visibility/focus가 존재한다.
3. 정체를 주입하면 attempt 2에서 종료하고 자동 새로고침하지 않는다.
4. 정상 실행은 `WAITING_FOR_OPEN` 또는 이후 상태로 진행한다.

## 판정

구현·자동 gate는 통과했다. Chrome live 재현 전까지 RT-16 backlog 상태는 `PROMOTED`를 유지한다.
