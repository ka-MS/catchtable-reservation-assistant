# 2026-07-25-01 CatchPay 예약 완주 구현 체크포인트

**브랜치:** `codex/feat-catchpay-reservation-completion`
**기준 spec:** `docs/specs/catchpay-reservation-completion/`
**상태:** Task 3 Codex gate 보류, blocking backlog 유지

## 완료된 범위

1. HANDOFF·기존 경계를 확인하고 새 spec 패키지를 작성했다.
2. Orca orchestration의 Claude Opus 4.8 worker로 통제된 실측을
   완료했다.
   - 비로그인 `ms`: 로그인/회원가입 gate, 제출 0회
   - 로그인 `민석` + `woo_blanc_`: 0원, PIN 없이 성공
   - 로그인 `민석` + `pizzeriamarket`: 20,000원, same-origin
     same-document custom keypad PIN 뒤 성공
   - 두 실예약은 사용자가 직접 취소했다. 환불 완료는 별도 검증하지
     않았다.
3. `10-analysis.md`를 확정하고 `20-design.md` 사용자 승인 gate를
   통과했다.
4. Task 1 설정·one-shot authorization 경계를 구현하고 Codex 독립
   gate를 통과했다.
   - 전체 테스트 `430/430`
   - typecheck, dist validation, MAIN/ISOLATED independence,
     `git diff --check`, raw PIN 스캔 통과
5. Task 2 durable outer/PIN claim, 상태와 navigation 제어를 구현하고
   Codex 독립 gate를 통과했다.
   - 대상 테스트 `72/72`, 전체 테스트 `459/459`
   - typecheck, dist validation, independence, `git diff --check`,
     raw PIN 스캔 통과

## 현재 보류 지점

Task 3 Sonnet 5 worker는 다음을 작성했다.

- `src/content/adapter/reservation-form.ts`
- 비로그인·0원·유료·PIN·성공 fixture 5개
- `tests/reservation-form-adapter.test.mjs`의 테스트 25개

worker 보고 기준 대상 `25/25`, 전체 `484/484`, typecheck, dist
validation, independence와 `git diff --check`는 통과했다. 그러나
Codex gate에서 다음 결함이 확인돼 Task 3은 완료 처리하지 않았다.

`ReservationFormAdapter.inspect()`의 ready fingerprint는 예약
의도 일치를 boolean으로만 넣고, action 직전
`freshReadyFingerprint()`는 expectation 없이 `intentMatch: true`를
상수로 넣는다. 실제 매장·날짜·시간·인원이 inspection 뒤 변경돼도
다른 facts가 같으면 stale fingerprint를 수락할 수 있다. 이는
`20-design.md` §3.1과 Task 3의 fresh inspection 안전 계약을 위반한다.

재개 시 순서:

1. 매장·날짜·시간·인원 중 하나만 바뀐 DOM에서 action 0회를 재현하는
   실패 테스트를 먼저 추가한다.
2. action 직전 동일한 실제 DOM facts를 fingerprint에 포함하도록 최소
   수정한다. Adapter에 mutable 정책 상태를 조용히 저장하지 않는다.
3. 금액 탐지의 label/sibling 구조가 실제 상·하단 결제 요약과
   일치하는지 기존 evidence를 재검토한다. 새 사실이면
   `site-behavior.md`와 `10-analysis.md`를 먼저 갱신한다.
4. 대상 테스트, 전체 `npm run check`, independence, raw PIN 스캔과
   `git diff --check`를 Codex가 독립 실행한 뒤에만 Task 3을 승인한다.

## 아직 시작하지 않은 범위

- Task 4 `CompletionCoordinator`와 Orchestrator 연결
- Task 5 telemetry·diagnostic secret 차단
- Task 6 통합 회귀와 기준 문서 정합성
- `40-verification`과 Chrome 확장 E2E
- `50-adversarial-review`
- 최종 worklog·HANDOFF 완료 판정

PIN raw 값은 source, fixture, test, spec, worklog, orchestration
task/message, storage와 telemetry에 기록하지 않았다.
