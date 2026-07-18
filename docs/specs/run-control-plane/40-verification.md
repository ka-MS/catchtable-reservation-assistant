# Run Control Plane — 검증 기록 (Phase 1·2)

**기준일:** 2026-07-17
**대상:** `20-design.md` §5 계약 전체, `30-implementation.md`(Phase 1)·`31-control-plane-implementation.md`(Phase 2)
**작업 로그:** `2026-07-17-01-run-control-plane-phase1.md` · `2026-07-17-02-run-control-plane-phase2.md`

## 1. 자동 검증 게이트

| 게이트 | Phase 1 | Phase 2 | 비고 |
|---|---|---|---|
| `npm run check` (typecheck + 전체 테스트 + dist + independence) | Task별 6회 green, 종료 시 360/360 | Task별 7회 green, 종료 시 399/399 | 각 Task 완료 커밋 전 필수 통과 |
| hot path diff 0 (`waitForOpen`/`runToggleCycle`/`advanceFromSlot`/`advancePostSlot`) | Task 5에서 grep 검증 | Task 5에서 grep 검증 | 실행 단계 테스트 무수정 통과 |
| `git diff --check` | 통과 | 통과 | |

## 2. 계약 → 테스트 매핑

| 설계 계약 | 검증 위치 | 건수 |
|---|---|---|
| §5.1 adapter 사실 반환 (facts 단일 소유) | `calendar-adapter.test.mjs` 사실 단언 + typecheck(구조 단일화) | 14 |
| §5.2 runner 기계 루프 (RT-16C 상수·progressKey·interrupt·obstacle) | `preparation-step-runner.test.mjs` | 10 |
| §5.2 coordinator 단계 의미 (메시지 원문·셀 소실 재순환) | `preparation-coordinators.test.mjs` | 7 |
| §5.3 classifier/policy 테이블 | `run-control-classifier.test.mjs` + `run-control-policy.test.mjs` | 8 |
| §5.4 attempt 제어 (재전송 조회 순서·phase 단조·TERMINAL disposition·시효·전이 원자성) | `logical-run.test.mjs` | 12 |
| §5.4 supervisor 실행 (영속→ACK→행동·재ACK 멱등·recovery lapse·reconcile 4분기·EXECUTING 가드·즉시 취소·projection 보존) | `run-supervisor.test.mjs` | 16 |
| §5.5 TerminalEffects 멱등·영속값 사용 | `terminal-effects.test.mjs` | 5 |
| PageRuntimePort (reenter reload 강제·inject 멱등) | `page-runtime-port.test.mjs` | 4 |
| §6 telemetry (durable flush 반환·RUN_STARTED attempt attrs) | `trace-batch-processor.test.mjs` + `trace-logger.test.mjs` | 2 |
| 오류 코드 구→신 매핑 (§8-9, 의도된 계약 변경) | `orchestrator.test.mjs` 매핑 테이블 테스트 | 4 시나리오 |
| RunResult message/preparation·EXECUTING 신호 시점 | `orchestrator.test.mjs` | 2 |

`31-control-plane-implementation.md` §C 멱등 테스트 매트릭스 8건은 전부 위 테스트로 고정돼 있다.

## 3. Chrome DevTools 라이브 E2E (2026-07-17, 목란, dry-run)

extension `olbclnjiehfelpfmgmdphfmenapmpaal` v0.2.0, `dist` 로드. 상세 절차·수치는 phase2 작업 로그 참조.

| 시나리오 | 결과 |
|---|---|
| 종결 원인 즉시 인계 | `DATE_UNAVAILABLE`(마감 날짜) → RESET 없이 즉시 HANDOFF ✅ |
| RESET 1회 완주 | `run-e4c30052` DATE_SELECTION_STALLED(attempt 2) → `RESET_PAGE` 결정 영속(flushOk true) → 같은 탭 문서 재로드 관측 → `run-8bb138ea` 재준비(7/21·2명) → 오픈 후 슬롯 감지 → DRY_RUN_COMPLETED ✅ |
| 상태·효과 영속 | logicalRun EXECUTING→TERMINAL, resetCount 1, decision RESET_PAGE/TERMINAL, `terminalEffectsCompletedAt` 기록, RESET 중 알림 없음 ✅ |
| telemetry 상관 | 두 attempt IndexedDB dropped 0·seq 연속, `RUN_STARTED`에 동일 logicalRunId·attemptIndex 0/1·resetCause, `RECOVERY_DECIDED` attrs(msToOpen 184,626ms) ✅ |
| E2E 발견 결함 | `RECOVERY_DISPATCHED` seq 충돌 유실 → 수정(`3ea1113`) 후 회귀 테스트 유지 |

## 4. 단위로만 검증한 항목 (라이브 재현은 후속 non-blocking)

- RESET 예산 소진(2번째 정체 → HANDOFF), 오픈 임박(45초 미만) RESET 거부, EXECUTING 진입 후 RESET 금지.
- ACK 직후 SW 강제 종료 → reconcile 멱등 재개(§B C4–C7) — 타이밍 제어가 필요해 라이브 재현은 보류.
- durable flush 실패 경로(ACK 미수신 → flushOk false 기록).

## 5. 잔여 한계

- 실행영역(슬롯 이후) 원인 분류와 ExecutionPhase 분해는 Phase 3 범위(공식 p95 하네스 RT-11/12 선행).
- 구현 후 적대적 리뷰 결과와 그 수정은 `50-adversarial-review.md`.
