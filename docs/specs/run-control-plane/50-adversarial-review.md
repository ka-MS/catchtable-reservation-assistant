# Run Control Plane — 구현 적대적 리뷰 (Phase 1·2 병합 후)

**기준일:** 2026-07-17
**대상:** 병합된 구현 전체 (`8c7c36f` 시점) — 설계 리뷰(20-design 1~5차)와 별개로, 구현물에 대해 실행 순서·경쟁·동작 보존을 재심사했다.

## 인정 — 수정 3건

| # | 결함 | 영향 | 수정 |
|---|---|---|---|
| A1 | `commitNextAttempt`가 `runEvents`를 무조건 `[]`로 초기화 — START 응답 후 content의 첫 RUN_EVENT가 commit 쓰기보다 먼저 도착하면(eventWrites queue와 supervisor queue는 비동기 독립) next attempt의 초기 이벤트가 Side Panel projection에서 유실 | 사이드패널 로그 초반 1–2건 누락(trace는 무손실) | next attempt 소속 이벤트는 보존하고 이전 attempt 이벤트만 초기화. 회귀 테스트: "commitNextAttempt은 병행 도착한 next attempt의 RUN_EVENT projection을 보존한다" |
| A2 | `stop()`이 직렬 queue 뒤에 서면서 **탭 이동·주입 진행 중 즉시 취소 불가** — 구 `stopRun`은 `runOnTab`과 병행 실행되어 `cancelledPendingRuns` 표시가 다음 `assertPending`에서 즉시 중단시켰으나, supervisor 직렬화가 이 병행성을 제거(최대 탐색 15초 + START 전송까지 지연). 취소돼도 terminal이 STOPPED가 아니라 FAILED로 기록되는 부수 결함 포함 | 이동 단계 중지 지연 회귀 + 상태 오기록 | `pendingStartRunId`를 두고 `stop()` 공개 메서드가 queue 진입 전에 동기로 취소 표시. 취소로 인한 중단은 STOPPED로 기록(구 동작 보존). 회귀 테스트: "stop은 직렬 queue를 기다리지 않고 진행 중인 시작을 즉시 취소한다" |
| A3 | `jobScheduler.onRunTerminal` 고아 코드 — job 종결이 TerminalEffects.finishJob으로 이동하면서 호출처가 사라짐 | 죽은 코드(오도 위험) | 메서드·전용 테스트 삭제 |

E2E에서 발견해 이미 수정한 1건은 별도 기록한다: `RECOVERY_DISPATCHED`를 nextAttemptId 스트림에 쓰면 병행 content seq와 충돌해 유실 → 닫힌 source attempt 스트림으로 이동(`3ea1113`).

## 기각 — 검토 후 유지 7건

| # | 의심 | 기각 근거 |
|---|---|---|
| R1 | RECOVERING 중 `stop()`이 복구를 취소하지 못함 | 직렬 queue에서 recovery follow-up은 항상 stop보다 먼저 실행되므로 stop이 RECOVERING 상태를 관측하는 창이 없다. recovery가 attempt 2를 시작한 뒤의 stop은 CONFIGURED 분기(취소 표시 + STOP 전달)로 정상 중지된다 — 최종적 중지 성립. 방어 코드를 추가하면 도달 불가 분기가 생기므로 추가하지 않는다 |
| R2 | phase 신호(EXECUTING)가 terminal 뒤 늦게 도착하는 경쟁 | `applyPhaseChange`가 결정된 attempt를 `stale_attempt`로 거부하고 content는 phase ACK를 소비하지 않는다 — 무해 |
| R3 | `forceReenter`가 동일 URL에서 load를 놓침 | reload 전용 대기 경로가 별도로 있고 단위 테스트가 고정. E2E에서 재로드 관측 |
| R4 | reconcile과 alarm/message handler 경쟁 | 모든 handler가 `supervisorReady` barrier를 await하고, supervisor 상태 변경은 단일 queue 직렬 |
| R5 | 시작 실패 시 logicalRun 잔존 → 유령 reconcile | 시작 실패 catch가 `logicalRun: null`로 정리(효과 없음 = 기존 무알림 동작 보존)하며 테스트로 고정 |
| R6 | scheduled job이 `prepared` 모드면 빈 탭에 주입 실패 | 구 `launchScheduledJob`+`runOnTab` 조합과 동일한 기존 동작(회귀 아님). scheduled 저장 UI는 자동 준비 전제 — 별도 이슈로만 기록 |
| R7 | 알림 ID 재사용으로 이전 실행 알림 대체 | logicalRunId 기반 ID라 실행 간 충돌 없음. 같은 실행의 재실행 대체는 멱등 설계 의도 |

## 판정

- 인정 3건은 회귀 테스트와 함께 수정 완료, `npm run check` 399→**400/400** green.
- 실행 hot path·자동화 경계·사용자 가시 메시지에 영향을 주는 결함은 발견되지 않았다.
- R6(scheduled+prepared 조합)은 기존 동작이므로 이 패키지에서 수정하지 않고 관찰 항목으로 남긴다.
