# 2026-07-17-01 Run Control Plane Phase 1 — Data Plane 순수화

**브랜치:** `initialize-project`
**계획:** `docs/specs/run-control-plane/30-implementation.md` (설계 `20-design.md`, 5차 red-team 반영판)
**커밋:** `5ec6630` → `3bc8705` → `260ebc6` → `6c72579` → `0627447` → `d4844ab`

## 변경 요약

준비영역(예약창·월·날짜·인원)의 사실/분류/정책/행동/기록 책임을 분리했다. 사용자 가시 메시지와 상태 전이는 현행 원문을 보존했고, `preparationErrorCode`만 의도된 계약 변경으로 세분화했다.

1. **순수 core 신설** (`src/shared/run-control/`): `facts.ts`(EntryFacts/CalendarFacts/PersonFacts), `causes.ts`(10개 원인 + FailureVia), `classifier.ts`(stage별 fatal 분류 + `classifyStall`), `policy.ts`(`decide()` + `RESET_MIN_LEAD_MS` 45s), `protocol.ts`(AttemptControlMessage 타입). decide/protocol은 Phase 1에서 배선하지 않는다 — Phase 2 supervisor가 유일한 소비자.
2. **BoundedStepRunner** (`src/content/preparation/step-runner.ts`): 관측 폴링 50ms → dispatch 예산 → 확인 deadline의 기계 루프 1개. RT-16C 상수(2회·1초, 월 750ms×3, 날짜 1s×2)를 그대로 이식. 분류 로직은 소유하지 않고 주입·호출만 한다. `progressKey` 리셋(다단 월 이동), obstacle 해제(홍보 인터스티셜), interrupt 토큰(closed union) 지원.
3. **Coordinator 3종** (`entry/calendar/person-coordinator.ts`): 단계 의미와 사용자 메시지 표 소유. calendar는 월 이동 → 날짜 선택 순서와 셀 소실 시 `target_cell_missing` interrupt 재순환(원인 코드는 제어에 쓰지 않음)을 소유한다.
4. **Adapter 사실화**: `CalendarAdapter.inspectPreparation()/clickMonth()` 추가, entry/person의 로컬 inspection 타입을 shared facts로 단일화. 이후 `prepareTarget`/`resetPreparation`/pending* 정책 상태 전부 삭제 — 재시도 상태가 runner의 run-scoped 지역 상태가 되어 RT-16B의 resetPreparation이 구조적으로 불필요해졌다.
5. **오케스트레이터 축소**: prepare* 3벌(복붙 루프 295줄)을 coordinator 호출 81줄로 교체. `tracePreparation` 30여 호출점을 `stepReporter()` 구현 1곳으로 수렴.

## 오류 코드 세분화 (의도된 계약 변경)

구 fallback `DATE_PREPARATION_BLOCKED`가 메시지 불변으로 세분화되며 orchestrator 테스트로 고정했다:

| 기존 메시지 | 신 코드 |
|---|---|
| 목표 날짜를 선택할 수 없습니다. | `DATE_UNAVAILABLE` |
| 목표 날짜가 현재 달력에 없습니다. | `DATE_NOT_IN_CALENDAR` |
| 목표 월로 이동할 수 없습니다. | `MONTH_NAVIGATION_UNAVAILABLE` |
| 달력 월 전환을 확인할 수 없습니다. | `MONTH_TRANSITION_STALLED` |

## 검증

- Task별 `npm run check` green 후 커밋: 344 → 354 → 361 → 368 → 369 → **360/360** (시작 336, prepareTarget 테스트 9건은 보존 체크리스트 6종을 사실 단언·classifier·runner·매핑 테스트로 이전 확인 후 삭제).
- **hot path diff 0**: `git diff` hunk가 import·상수·준비 메서드 블록에 한정됨을 확인 — `waitForOpen`/`runToggleCycle`/`advanceFromSlot`/`advancePostSlot` 무변경. 실행 단계 테스트는 한 줄도 수정하지 않고 통과.
- 준비 메시지 원문은 구현 전 현행 코드와 대조로 일치 확인.
- `git diff --check` 통과.

## 다음 단계

Phase 2 (Control Plane): `31-control-plane-implementation.md` 계획 작성부터. 선행 요구(5차 리뷰): logicalRun 상태 전이표, 쓰기 사이 크래시 지점 목록, 멱등 테스트 매트릭스. 이후 `background/run-supervisor.ts` + `logicalRun` storage + AttemptControlMessage 배선 + RESET_PAGE 실행 + reconcile + Side Panel RECOVERING + Chrome DevTools E2E.
