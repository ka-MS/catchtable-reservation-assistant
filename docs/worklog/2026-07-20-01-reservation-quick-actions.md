# 2026-07-20-01 예약 설정 빠른 동작 — 현재 탭에서 가져오기 / 식당으로 이동하기

**브랜치:** `codex/feat-reservation-quick-actions`
**계획:** `docs/specs/reservation-quick-actions/10-design.md`
**커밋:** `56107cd` → `4ffb031` → `e799503` → `51df95c` → `1950bd1` → `62987f8` → `8a29c27` → `caa8883` → `7abede2` → `5a484d0` → `28a9328` → `308e57a` → `3b96548`

## 변경 요약

Side Panel "01 언제 예약할까요?" 섹션에 버튼 2개를 추가했다.

1. **현재 탭에서 가져오기**: 활성 탭이 캐치테이블 매장 페이지(`isShopUrl`)면 content script에 `READ_SHOP_SNAPSHOT`을 보내 URL·선택된 날짜(`CalendarAdapter.readSelectedDate`)·선택된 인원(`PersonAdapter.readSelectedCount`)을 조회하고, **있는 만큼만** 폼에 반영한다. `RunSupervisor`/`LogicalRun`을 전혀 만들지 않는 상태 없는 1회성 조회다.
2. **식당으로 이동하기**: 폼 값으로 `quickPrepConfig`를 만들어 기존 `PANEL_START`를 그대로 호출한다 — orchestrator·coordinator·adapter·RunSupervisor 코드는 전혀 변경하지 않았다. sidepanel이 기존 `runEvents` 구독에서 `PREPARING_PAGE`(또는 실패 상태)를 감지하면 즉시 `PANEL_STOP`을 보낸다.

## 안전장치

`quickPrepConfig`는 폼의 실제 `dryRun`/`entryMode` 설정과 무관하게 **항상 `dryRun:true`, `entryMode:"auto"`로 강제**한다. `orchestrator.ts:1185`에서 `dryRun` 체크가 `clickSlot()` 호출보다 먼저 걸리는 걸 확인했으므로, 이 버튼으로 실수 클릭이 나는 게 구조적으로 불가능하다. 오픈/종료 시각은 클릭 시점 기준 현재~+5분으로 재계산한다(정상 경로는 수 초 내 종료되며, 5분은 자동 정지 실패 시의 안전망 상한일 뿐).

## 검증

- Task별 `npm run check` green 후 커밋: 401 → 405 → (타입 전용) → (핸들러, 테스트 없음) → 405 → 406 → **406/406**.
- Chrome DevTools 라이브 확인(목란, 2026-07-20):
  - 달력·인원 미오픈 상태에서 "가져오기" → URL만 반영, 사전에 넣어둔 날짜·인원 센티널 값 보존 확인.
  - 달력에서 7/24 선택, 인원 4명 선택 후 "가져오기" → URL·날짜(2026-07-24)·인원(4) 전부 반영 확인.
  - 이 과정에서 URL에 `?date=...&personCount=...` 쿼리스트링이 그대로 딸려오는 결함을 발견 — `location.href`에서 `search`/`hash`를 제거하도록 즉시 수정(`5a484d0`, 기존 `trace-logger.ts`의 `cleanConfig`와 동일한 관례).
  - "식당으로 이동하기" 클릭 → `PREPARING_PAGE` 도달 즉시 자동 정지, 상태 표시줄에 `"예약 모달과 목표 날짜를 확인합니다."`(tone=success) 표시, `activeRun.state === "STOPPED"`, `logicalRun.status === "TERMINAL"`, 저장된 `reservationConfig.dryRun === true`·`entryMode === "auto"` 확인(강제 오버라이드가 실제 저장까지 반영됨).
  - 매장 아닌 탭(사이드패널 자신이 활성 탭이 된 경우)에서 "가져오기" → `"현재 탭이 캐치테이블 매장 페이지가 아닙니다."` 에러 정상 표시.
  - 콘솔 오류·경고 없음.
- 실패 상태(HANDED_OFF/TIMED_OUT/FAILED) 분기는 코드 검토 + 기존 상태 머신 테스트로만 확인했다 — success 분기와 동일한 `else` 브랜치라 별도 라이브 재현은 생략했다.

## 사용자 수동 테스트 후 보완 (2026-07-21)

라이브 사용 중 발견된 4건을 사용자가 직접 테스트하며 수정했다(E2E는 사용자가 수동으로 진행, 이 세션에서는 `npm run check`만 게이트로 사용).

1. **"식당으로 이동하기"가 실행 로그 뷰로 전환됨** — `renderRuntime`의 `if (running && !wasRunning) setView("run")` 가드에 `!watchingPrepTest` 조건 추가. 실제 "지금 시작"/스케줄 job은 기존대로 전환된다(`28a9328`).
2. **위 수정이 처음엔 안 먹힘 — 타이밍 경쟁 발견**: `watchingPrepTest = true`를 `PANEL_START` **응답 수신 후**에 설정하고 있었는데, `RunSupervisor`가 `activeRun`을 storage에 쓰는 시점이 그보다 빨라 `renderRuntime`이 플래그가 아직 `false`인 상태로 먼저 실행되고 있었다. 요청 전송 **직전**으로 설정 시점을 옮겨 해결(`308e57a`).
3. **버튼 hover·클릭 모션 없음** — 참고 mockup 스타일(hover 배경 변화, `translateY(1px)` 클릭 눌림, `focus-visible` 링)을 `.primary`/`.secondary`에 전역 적용. 앱 전체에서 재사용되는 클래스라 "+ 새 예약"/"예약 저장"/"지금 시작"에도 동일하게 적용됐다(`28a9328`).
4. **버튼이 너무 크고 아래 여백 없음, 상태 메시지가 안 사라짐** — `.compact`가 `height`를 재정의하지 않아 기본 48px가 그대로 적용되던 결함을 `36px`로 수정, `.field-quick-actions`에 `margin-bottom:14px` 추가, `setQuickStatus`에 4초 자동 숨김 타이머 추가(`3b96548`).

## 다음 단계

없음 — 계획된 범위 완주. 향후 도메인이 늘어나면(예: 새 준비 단계) `docs/specs/reservation-quick-actions/10-design.md`의 재사용 패턴(어댑터 사실 조회 + 기존 START/STOP 재사용)을 참고한다.
