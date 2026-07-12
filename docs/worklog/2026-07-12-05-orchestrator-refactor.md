# 2026-07-12 오케스트레이터 구조 리팩터 (A)

## 배경

`src/content/orchestrator.ts`의 `start()`가 480여 줄 단일 메서드로, run-scoped 상태와 헬퍼 클로저가 한 스코프에 묶여 단계 수정 시 파일 전체를 훑어야 했다. `docs/specs/orchestrator-refactor/`(scope·design·plan) 기준으로 동작 무변경 구조 리팩터를 수행했다.

## 수행

- **`RunSession` 메서드 객체 도입**: run-scoped 상태(serverClock·machine·offsetMs·timing·toggleCycle·adjacentDate)를 필드로, emit/transition/finish/stopOrTimeout을 메서드로. `OpenRunOrchestrator`는 공개 계약(start/stop/중복 실행 방지)만 유지하고 실행을 위임.
- **단계 메서드 분해**: `execute()`가 `validate → syncInitialClock → prepareEntry → prepareDate → preparePerson → confirmPageReady → waitForOpen → searchAndReserve`를 `RunResult | null` 계약의 `??` 체인으로 엮는다(non-null=종료, null=진행). 기존 조기 종료 시맨틱 보존.
- **슬롯 루프 세분화**: `searchAndReserve`(바깥 루프) → `runToggleCycle`(토글 1회, `ToggleCycleOutcome` 반환) → `advanceFromSlot` → `advancePostSlot`.
- **순수 텔레메트리 빌더 추출**: `clockMetricData`·`toggleCycleAttributes`·`targetClickMetricData`·`slotDetectedEventData`·`slotSelectedEventData`를 모듈 순수 함수로. 산출 payload는 값 동일.

## 결과 (메서드 크기)

| | 리팩터 전 | 리팩터 후 |
|---|---|---|
| 최대 단일 메서드 | `start()` ~480줄 | `runToggleCycle` ~147줄 |
| `execute()` | — | 28줄 체인 |
| 파일 총량 | 626줄 | 757줄 (추출로 시그니처·래퍼 증가) |

파일 총량은 늘었지만 목표(단일 거대 메서드 해소·단계별 국소 수정 가능)를 달성했다.

## 검증 (behavior-neutral)

- `tests/orchestrator.test.mjs` 18개를 **한 줄도 수정하지 않고** 통과 — 동작·이벤트·타이밍 보존의 근거.
- 전체 단위·fixture 166개 green, 타입·dist·독립성·`git diff --check` 통과.
- 커밋을 단계별(RunSession 껍데기 → 텔레메트리 빌더 → 단계 분해)로 나눠 각 단계 green 유지. Task 3·4는 250줄 루프 이중 복제를 피하려 한 커밋으로 합침.

## 다음 작업

1. 베이스 의존: 이 브랜치(`codex/refactor-orchestrator-session`)는 `codex/fix-postslot-timeout-diagnostics` 위에 잘렸다. postslot이 수동 검증 후 main에 병합되면 이 브랜치를 병합한다.
2. 이후 B(실패 스냅샷)+C(스냅샷 일반화)를 A 결과 위에서 재브레인스토밍. 각 단계가 named 메서드라 "단계 경계 실패 시 스냅샷" 훅을 걸기 쉬워졌다.
3. D(어댑터 DOM 쿼리 중복 제거)는 독립.

## 비고

- 설계·계획: `docs/specs/orchestrator-refactor/20-design.md`, `30-implementation.md`
- 실사이트 동작은 안 바꿨으므로 별도 수동 실측 불필요(테스트 무수정 통과가 보증). 단, 확장 재로드 후 한 번 정상 실행 확인은 권장.
