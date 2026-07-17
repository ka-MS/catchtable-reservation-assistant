# 2026-07-17-02 Run Control Plane Phase 2 — Control Plane

**브랜치:** `initialize-project`
**계획:** `docs/specs/run-control-plane/31-control-plane-implementation.md` (선행 산출물 §A 전이표·§B 크래시 지점·§C 멱등 매트릭스 포함)
**커밋:** `62e3a45` → `494cdc7` → `2e1579c` → `3a75ac7` → `14dbbd7` → `04b942f` → `3eef0c7` → `3ea1113`

## 변경 요약

background에 논리 실행(LogicalRun) 감독자를 세워 attempt 종결을 typed·ACK 프로토콜로 수신하고, 준비 정체에 한해 같은 탭 URL 재진입(RESET_PAGE)을 1회 실행한다. terminal 효과(배지·알림·job 종결)는 supervisor 결정 이후로만 이동했다.

1. **LogicalRun 순수 전이** (`shared/run-control/logical-run.ts`): §A 전이표 전체 — outcome 접수(재전송 조회 순서: attempt 기록 → payload 검증 → stale), phase 단조, 원자적 nextAttempt 전이, recovery 시효, background 종결. protocol은 Phase 2 계약(TERMINAL disposition·FINISHING·pendingOutcome·`outcome_conflict`/`phase_regression`·flush 결과 동반)으로 확장.
2. **durable flush**: `forceFlush(): Promise<boolean>` — 발행 trace의 저장 ACK 여부를 반환하고 `ATTEMPT_FINISHED.flush.ok`로 동반한다(유실 사실은 attempt 기록 `flushOk`, 복구 진행은 결과와 무관). `RECOVERY_DECIDED`/`RECOVERY_DISPATCHED` trace 코드와 `RUN_STARTED`의 `logicalRunId`/`attemptIndex`/`resetCause` attribute 신설.
3. **TerminalEffects**: recordEvent의 "저장 즉시 알림" 분기를 삭제하고 supervisor 결정 이후로 이동 — RESET 중 인계 오보가 구조적으로 불가능. 결정적 알림 ID(`run-terminal:<logicalRunId>`)로 멱등. scheduled job 종결은 영속된 message·finishedAt으로 수행(telemetry 재독 없음).
4. **PageRuntimePort**: navigateIfNeeded / **forceReenter(같은 URL이어도 reload로 문서 재로드)** / inject / startAttempt / getAttemptStatus.
5. **content**: RunResult에 terminal `message`·`preparation{cause,attempts}` 동반, `markExecuting()`(WAITING_FOR_OPEN 직전 1회 EXECUTING 신호), terminal 후 flush→`ATTEMPT_FINISHED`(3회·500ms, `{ok:false}` 수신 시 중단), `GET_ATTEMPT_STATUS`(FINISHING + pendingOutcome 겸수신), START 동일 attemptId 멱등 재응답.
6. **RunSupervisor**: 진입점 통일(startManual/startScheduled가 기존 startRun/runOnTab/launchScheduledJob 흡수), 단일 SerialTaskQueue 직렬화로 "결정 영속 → ACK → 행동" 강제, decide() 재평가 포함 recovery 실행, top-level bootstrap reconcile(§B 4분기), 기존 리스너 5종(PANEL_STOP·tabs.onRemoved·tabs.onUpdated·cancelledPendingRuns·assertPending) 흡수, 모든 handler `supervisorReady` barrier.
7. **Side Panel**: `logicalRun` 구독으로 RECOVERING 1줄 표시.

## 검증

- Task별 `npm run check` green 후 커밋: 372 → 374 → 379 → 383 → 385 → 399 → **399/399**.
- hot path: `waitForOpen`/`runToggleCycle`/`advanceFromSlot`/`advancePostSlot` diff 0 (Task 5에서 grep 검증).
- 멱등 매트릭스(§C) 8건 전부 단위 테스트로 고정: logical-run 12건, run-supervisor 14건(재전송 재ACK·resetCount 불변·recovery lapse·reconcile C1/C3/C6/C8·EXECUTING 가드·탭 종결), terminal-effects 5건, page-runtime-port 4건.

## Chrome DevTools E2E (2026-07-17 21:02–21:09 KST, 목란, dry-run)

- **RESET 1회 완주**: 목란 탭에 달력 셀 클릭 차단기(capture) 주입 → `지금 시작` → attempt 1 `run-e4c30052`가 날짜 dispatch 2회 후 `DATE_SELECTION_STALLED`(attempt 2)로 HANDED_OFF → supervisor 결정 `RESET_PAGE`(RECOVERY_DECIDED attrs: msToOpen 184,626ms·resetCount 1) → **같은 탭 문서 재로드 관측**(차단기 소멸) → attempt 2 `run-8bb138ea`가 예약 CTA→7/21 선택→인원 2 재준비 → `WAITING_FOR_OPEN` → 21:09 오픈 후 오후 5:00 슬롯 감지 → **DRY_RUN_COMPLETED**.
- **logicalRun 영속 증거**: status EXECUTING(phase 신호 배선)→TERMINAL, resetCount 1, attempt 1 decision `RESET_PAGE`·`flushOk true`, attempt 2 decision `TERMINAL`, `terminalEffectsCompletedAt` 기록(효과 1회).
- **IndexedDB**: 두 attempt 모두 eventCount=저장 이벤트 수(27/108), seq 연속, dropped 0. `RUN_STARTED` attributes로 attempt 상관(동일 logicalRunId, attemptIndex 0/1, attempt 2에 `resetCause`) 확인.
- **관측 결함 수정**: `RECOVERY_DISPATCHED`를 nextAttemptId 밑에 기록하면 병행 content seq와 충돌해 유실 — 닫힌 source attempt 스트림으로 이동(`3ea1113`).
- **사전 검증 데이터**: 동일 세션의 직전 실행에서 `DATE_UNAVAILABLE`(마감 날짜)은 RESET 없이 즉시 HANDOFF — 종결 원인 정책 확인.
- 종결 원인 HANDOFF는 라이브로, RESET 예산 소진(2번째 정체)·오픈 임박 시효·EXECUTING 후 RESET 금지·ACK 직후 SW 사망 reconcile은 단위 테스트(§C)로 검증했다. 후자의 라이브 재현은 타이밍 제어가 필요해 후속 non-blocking으로 남긴다.
- extension `olbclnjiehfelpfmgmdphfmenapmpaal` v0.2.0, `\\wsl.localhost\Ubuntu\home\developer\source\catchtable-reserve\dist` 로드, Side Panel 콘솔 오류 없음.

## 다음 단계

run-control-plane 완주 — RT-16 전체 종결. Phase 3(ExecutionPhase 내부 분해)은 공식 p95 하네스(RT-11/12) 확보 후 별도 착수.
