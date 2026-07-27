# CatchPay 예약 완주 구현계획

**상태:** Task 1~6 완료
**기준 분석:** [10-analysis.md](10-analysis.md)
**기준 설계:** [20-design.md](20-design.md)
**사용자 승인:** 2026-07-24 명시 승인
**구현 책임:** Codex
**체크포인트 재개:** `ab5e825` 이후 Codex 단독 구현·검수

## 1. 구현 원칙

- 실패 테스트를 먼저 작성한다.
- Task별 변경은 해당 Task의 계약과 직접 연결된 최소 범위로 제한한다.
- `10-analysis.md`와 `20-design.md`의 제품 정책을 worker가 변경하지 않는다.
- 새 실사이트 사실이나 설계 불일치를 발견하면 구현을 멈추고
  coordinator에게 escalation한다.
- 같은 파일을 여러 worker가 동시에 수정하지 않는다.
- PIN raw 값은 task spec, orchestration message, source, fixture, test,
  Console, trace와 문서에 넣지 않는다.
- 테스트용 PIN은 런타임에 조합한 sentinel을 사용하고 failure output에도
  raw 값이 나타나지 않게 한다.
- 체크포인트 이후 기존 diff와 테스트 상태를 먼저 감사하고, Codex가
  실패 테스트·수정·검증을 직접 수행한다.

## 2. 기준선

2026-07-24 구현 진입 직전:

- 브랜치: `codex/feat-catchpay-reservation-completion`
- 기존 source/test 변경: 없음
- `npm run check`: 407/407 tests 통과
- typecheck 통과
- dist validation 통과
- MAIN/ISOLATED independence 통과
- `git diff --check` 통과

기존 실측·spec 문서의 uncommitted 변경은 사용자 작업 범위이며 보존한다.

## 3. Task 1 — 설정과 one-shot authorization 경계

**목표:** 완주 opt-in과 폼 기본 답변은 영속 설정으로 추가하되 PIN은
초기 수동 attempt 메시지에만 존재하게 한다. 아직 예약 폼을 클릭하지
않는다.

**주요 파일:**

- `src/shared/types.ts`
- `src/shared/config.ts`
- `src/sidepanel/form-model.ts`
- `src/sidepanel/sidepanel.html`
- `src/sidepanel/sidepanel.css`
- `src/sidepanel/index.ts`
- `src/background/index.ts`
- `src/background/run-supervisor.ts`
- `src/content/index.ts`
- `src/content/orchestrator.ts`
- 관련 config/form/supervisor/build 테스트

**먼저 실패해야 하는 테스트:**

- 구버전 config 누락값은 완주 off, 상한 0원, 기본 답변 빈 문자열로
  normalize된다.
- 금액 상한은 정수 `0..500_000`만 허용한다.
- Side Panel에 완주 opt-in, 상한, 공통 필수 답변과
  `type=password`, `inputmode=numeric`, `autocomplete=off` PIN input이
  존재한다.
- `PANEL_START`는 authorization을 config와 분리한다.
- `RunSupervisor.startManual()`은 initial manual `START`에만
  authorization을 전달한다.
- storage에 쓰는 `reservationConfig`, `logicalRun`, `activeRun`,
  history와 run event에는 PIN sentinel이 없다.
- scheduled `START`와 recovery `START`에는 authorization이 없다.
- start validation 실패와 busy 실패에도 PIN이 error·trace payload에
  포함되지 않는다.
- Side Panel은 payload 생성 직후 PIN input을 비우며 draft, favorite와
  scheduled job 저장 경로는 PIN input을 읽지 않는다.

**구현 계약:**

- `ReservationConfig`에 다음 필드만 추가한다.
  - `reservationCompletionEnabled`
  - `maxPaymentAmountKrw`
  - `requiredFormDefaultAnswer`
- `OneShotRunAuthorization`은 `ReservationConfig`와 별도 타입이다.
- PIN 형식 실패는 정적 오류 코드·메시지만 반환한다.
- background는 authorization을 storage 객체에 넣지 않고 initial
  `START`를 만든 뒤 참조를 폐기한다.
- Content `RunSession`은 authorization을 disposable wrapper로 받고
  `finally`에서 참조를 폐기한다.
- Task 1에서는 authorization을 사이트 DOM에 입력하지 않는다.
- 완주 off 기본값에서 기존 예약 폼 `HANDED_OFF` 동작은 그대로다.

**검증:**

```bash
npm run build
node --test tests/time-config.test.mjs tests/form-model.test.mjs \
  tests/run-supervisor.test.mjs tests/build-regression.test.mjs
npm run check
git diff --check
```

- [x] 실패 테스트 확인
- [x] 최소 구현
- [x] 대상 테스트 통과
- [x] 전체 check 통과
- [x] Codex diff 검수

Task 1 Codex gate 결과(2026-07-24):

- worker 최초 구현 뒤 설계에 없던 공통 답변 80자 제한, PIN dispose
  순서, malformed authorization 검증, Side Panel PIN 즉시 비움 테스트
  누락을 발견해 보완했다.
- test-only production API와 종료 session 참조를 제거했다.
- `OpenRunOrchestrator.start()`의 raw authorization 참조는
  `RunSession` 전달 직후 폐기하고, terminal cleanup은 비동기 flush보다
  먼저 handle을 폐기한다.
- Codex 독립 검증에서 대상 테스트와 전체 `430/430`, typecheck,
  dist validation, independence, `git diff --check`, raw PIN 스캔이
  통과했다.

## 4. Task 2 — durable completion claim과 상태·navigation 제어

**목표:** 외부 submit과 PIN 내부 submit의 클릭 권한을
Background serial queue에서 영속 ACK하고 stop/reconcile/navigation
경쟁에서 자동 재클릭을 막는다.

**주요 파일:**

- `src/shared/types.ts`
- `src/shared/state-machine.ts`
- `src/shared/run-control/logical-run.ts`
- `src/shared/run-control/protocol.ts`
- `src/background/run-supervisor.ts`
- `src/background/navigation.ts`
- `src/background/index.ts`
- `src/content/index.ts`
- 관련 logical-run/state/navigation/supervisor 테스트

**먼저 실패해야 하는 테스트:**

- `ADVANCING_RESERVATION → COMPLETING_RESERVATION`이 허용된다.
- `COMPLETING_RESERVATION`의 안전 terminal 전이가 설계와 일치한다.
- outer claim은 active EXECUTING attempt에서 한 번만 영속된다.
- 같은 phase·fingerprint 재전송은 멱등 ACK지만 새 dispatch 권한을
  만들지 않는다.
- fingerprint 충돌, stale attempt, pin-before-outer는 거절한다.
- stop-before-outer는 outer claim을 거절한다.
- stop-after-outer는 stop marker를 영속하고 pin claim을 거절한다.
- pin claim ACK 뒤 stop은 이미 허용된 dispatch를 취소 완료로
  오판하지 않는다.
- completion claim이 있는 EXECUTING attempt는 reconcile에서
  RESET_PAGE 또는 새 `START`로 복구되지 않는다.
- acknowledged claim이 있는 정확한 `/ct/mydining/my/planned`만
  이탈 `STOPPED` 후보에서 제외한다.
- claim 없는 success URL과 다른 origin/path는 기존 이탈 정책을
  우회하지 않는다.
- claim과 authorization 직렬화 객체에 PIN sentinel이 없다.

**구현 계약:**

- `LogicalRun`에는 PIN이 없는 `CompletionDispatchClaim`만 저장한다.
- fingerprint에는 target slug, 날짜, 실제 선택 시간, 인원, 현재 금액,
  폼 fingerprint hash만 들어간다.
- control message ACK는 “영속된 클릭 권한”이며 클릭 성공이 아니다.
- Content는 phase claim ACK를 받은 뒤 해당 button을 최대 한 번
  dispatch한다.
- claim 뒤 context 소실은 자동 retry가 아니라 결과 불명 인계다.
- `COMPLETED`는 이 Task에서 생성하지 않는다.

**검증:**

```bash
npm run build
node --test tests/state-machine.test.mjs tests/logical-run.test.mjs \
  tests/background-navigation.test.mjs tests/run-supervisor.test.mjs
npm run check
git diff --check
```

- [x] 실패 테스트 확인
- [x] 최소 구현
- [x] 대상 테스트 통과
- [x] 전체 check 통과
- [x] Codex diff 검수

Task 2 Codex gate 결과(2026-07-24):

- 최초 구현에서 claim replay가 새 클릭 권한처럼 보이던 ACK, post-claim
  stop의 일반 `STOP` 전송, 탭·URL·reconcile 문맥 소실을
  `STOPPED`/`FAILED`로 단정하는 의미 결함을 수정했다.
- `CompletionDispatchState`를 pre-claim stop과 acknowledged claim의
  strict union으로 고정하고, malformed storage 값은 acknowledged로
  인정하지 않는다.
- `dispatchGranted`는 최초 영속 claim에서만 `true`이고 동일
  phase·fingerprint replay는 `false`다.
- 비동기 `RUN_EVENT` projection 때문에 `activeRun.state`가 아직
  `CONFIGURED`인 순간에도 durable outer claim이 우선하도록
  projection-lag stop 회귀 테스트를 추가했다.
- Codex 독립 검증에서 대상 테스트 `72/72`, 전체 `459/459`,
  typecheck, dist validation, independence, `git diff --check`와 raw
  PIN 스캔이 통과했다.

## 5. Task 3 — `ReservationFormAdapter`와 실측 fixture

**목표:** C 비로그인, A 0원, B 유료, PIN overlay와 완료 화면을
실측 계약에 따라 facts로 분류하고 fresh fingerprint action을 제공한다.
Coordinator와 상태 전이는 아직 연결하지 않는다.

**주요 파일:**

- `src/content/adapter/reservation-form.ts`
- `tests/fixtures/catchpay-non-login.html`
- `tests/fixtures/catchpay-zero-form.html`
- `tests/fixtures/catchpay-paid-form.html`
- `tests/fixtures/catchpay-pin.html`
- `tests/fixtures/catchpay-success.html`
- `tests/reservation-form-adapter.test.mjs`

fixture 상단에는 관측일, 매장, `site-behavior.md` §12 출처를 기록한다.
문서에 없던 generated class나 편의용 `data-*`를 발명하지 않는다.

**먼저 실패해야 하는 테스트:**

- C는 `login_required`, 제출 action 0회다.
- A는 CatchPay checked·일반결제 미선택·자동결제 최종 버튼, current 0원,
  필수 10개, 빈 multiline 3개, optional 0개로 분류된다.
- B는 current 20,000원, 필수 3개, optional 0개, 필수 자유입력 0개다.
- 취소선 80,000원과 current 0원을 구분한다.
- current 금액 0개·복수·parse 실패·상한 초과는 ready가 아니다.
- 날짜·시간·인원·매장 불일치는 ready가 아니다.
- 폼 매장명은 유일하고 비어 있지 않은 `header > h1`에서만 읽는다.
  부재·중복·빈 값, `document.title` 또는 본문 heading만 있는 변형은
  매장 일치로 인정하지 않는다.
- hold 만료와 countdown 불명은 ready가 아니다.
- CatchPay 미선택·일반결제 선택은 ready가 아니다.
- 등록 카드 안내문 부재만으로 ready를 거절하지 않는다.
- 방문 목적과 `[선택]`·마케팅은 action 대상이 아니다.
- 개별 required를 우선 처리한다.
- group member가 정확히 required 3개이고 optional 0개일 때만
  `모두 동의합니다`를 사용할 수 있다.
- optional이 섞이거나 membership가 불명인 group은 클릭하지 않는다.
- 이미 채워진 필수 입력은 보존하고 빈 supported multiline만 공통
  답변으로 채운다.
- unsupported required input과 빈 기본 답변은 인계 근거다.
- fingerprint 변경 뒤 action은 클릭·입력하지 않는다.
- PIN은 same-origin, same-document, iframe 0, password input 0,
  visible digit 0~9 각각 하나로 분류된다.
- digit 누락·중복·iframe·password input 변형은 지원하지 않는다.
- PIN digit action은 위치가 아니라 매 호출 시 현재 accessible text로
  button을 다시 찾는다.
- success는 path, 정확한 완료 메시지와 매장·날짜·시간·인원 일치
  목록을 각각 facts로 반환한다.

**구현 계약:**

- Adapter는 DOM facts와 원자 action만 소유한다.
- 정책·timeout·상태·telemetry·secret 수명은 소유하지 않는다.
- 카드 label·마스킹 번호, raw 예약번호와 입력값을 반환하지 않는다.
- generated CSS class보다 role, label, native input name과 구조적 section
  text를 우선한다.
- ambiguity는 추측 선택이 아니라 `unknown`이다.

**검증:**

```bash
npm run build
node --test tests/reservation-form-adapter.test.mjs
npm run check
git diff --check
```

- [x] 실패 테스트 확인
- [x] fixture 출처 검수
- [x] 최소 구현
- [x] 대상 테스트 통과
- [x] 전체 check 통과
- [x] Codex diff 검수

Task 3 체크포인트(2026-07-25):

- Sonnet 5 worker가 Adapter·실측 fixture 5개·테스트 25개를 작성했다.
  worker 보고 기준 대상 `25/25`, 전체 `484/484`, typecheck, dist
  validation, independence와 `git diff --check`가 통과했다.
- Codex 검수에서 `freshReadyFingerprint()`가 실제 매장·날짜·시간·인원
  값을 다시 fingerprint하지 않고 `intentMatch: true` 상수만 사용하는
  결함을 확인했다. inspection 뒤 이 값들만 바뀌면 stale action이
  통과할 수 있어 설계 §3.1의 fresh inspection 계약을 위반한다.
- 따라서 위 worker 결과는 Task 완료로 승인하지 않는다. 재개 시 실제
  예약 의도값 변경을 재현하는 실패 테스트를 먼저 추가하고, action
  직전 fingerprint가 동일 DOM facts를 다시 계산하도록 최소 수정한다.
- 금액 탐지는 현재 label이 정확히 하나일 때만 다음 sibling을 읽는다.
  실제 폼에 상단 `총 결제 금액`과 하단 `결제금액` 요약이 동시에
  존재하는지 evidence를 다시 확인한다. 새 사실이면 분석 문서를 먼저
  갱신하고, 그렇지 않으면 추측으로 탐지 범위를 넓히지 않는다.

Task 3 Codex gate 결과(2026-07-25):

- 매장·날짜·시간·인원 실제 DOM shape를 fresh fingerprint에 포함하고
  각각의 변경 뒤 action 0회를 회귀 테스트로 고정했다.
- 우블랑 live 폼에서 상단·하단 금액 anchor가 함께 렌더되는 사실을
  분석 문서에 먼저 기록한 뒤, 각 anchor의 현재 금액이 유일하고 서로
  같을 때만 수용하도록 수정했다.
- 명시적 CatchPay label이 없는 live 변형은 유일한 일반결제 radio의
  반대편만 CatchPay로 판정한다. 등록 카드 안내 문구는 hard gate가
  아니며, 일반결제 radio가 모호하면 인계한다.

## 6. Task 4 — `CompletionCoordinator`와 Orchestrator 연결

**목표:** 폼 검증→필수 입력→필수 약관→fresh 재검증→outer claim/click
→선택적 PIN→pin claim/click→성공 관측을 직렬화하고
`COMPLETED` 생산 경로를 만든다.

**주요 파일:**

- `src/content/completion-coordinator.ts`
- `src/content/orchestrator.ts`
- `src/content/index.ts`
- `src/shared/types.ts`
- `tests/completion-coordinator.test.mjs`
- `tests/orchestrator.test.mjs`

**먼저 실패해야 하는 테스트:**

- opt-in off는 기존 폼 `HANDED_OFF`와 기존 메시지를 유지한다.
- opt-in on은 form 확인 뒤 `COMPLETING_RESERVATION`으로 진입한다.
- 슬롯 click claim의 실제 `SlotCandidate.minutes`가 intent로 전달된다.
- shop page에서 유일한 표시 매장명을 읽지 못하면 완주하지 않는다.
- 필수 입력·약관 action 뒤 전체 facts를 fresh 재검증한다.
- inspection과 outer action 사이 fingerprint 변경은 outer click 0회다.
- 수동 0원은 PIN 없이 outer click 최대 1회 후 성공을 관측한다.
- 수동 유료 + authorization은 outer와 pin click 각각 최대 1회다.
- 수동 유료 + authorization 없음은 outer click 전에 인계한다.
- scheduled 0원은 조건 충족 시 완주할 수 있다.
- scheduled 유료는 outer click 전에 인계한다.
- PIN 구조 변경, 금액 변경, 내부 button 비활성, stop-before-pin은
  pin click 0회다.
- pre-claim stop은 `STOPPED`, pre-claim deadline은 `TIMED_OUT`다.
- post-claim timeout·navigation·오류는 재클릭 없이 결과 불명
  `HANDED_OFF`다.
- URL만, 메시지만, 목록만 일치해서는 `COMPLETED`가 아니다.
- path + 메시지 + 일치 목록을 모두 확인한 뒤에만 `COMPLETED`다.
- `RunSession.finally` 뒤 authorization 참조가 폐기된다.

**구현 계약:**

- `CompletionCoordinator`가 순서와 secret 수명을 소유한다.
- Adapter에는 PIN 문자 하나만 순간적으로 전달한다.
- PIN 값·길이·순서가 반환값, error와 event data에 들어가지 않는다.
- claim 뒤 결과 관측은 최대 15초 read-only다.
- live에서 full reload가 새로 확인되기 전에는 background 재주입
  구조를 추가하지 않는다.
- full reload로 context 소실 시 URL만으로 `COMPLETED`를 만들지 않는다.

**검증:**

```bash
npm run build
node --test tests/completion-coordinator.test.mjs tests/orchestrator.test.mjs \
  tests/state-machine.test.mjs
npm run check
git diff --check
```

- [x] 실패 테스트 확인
- [x] 최소 구현
- [x] 대상 테스트 통과
- [x] 전체 check 통과
- [x] Codex diff 검수

Task 4 결과:

- `CompletionCoordinator`가 필수 입력·필수 약관·fresh 검증·outer/PIN
  durable claim·성공 관측을 직렬화한다.
- outer claim 뒤 예외·timeout·중지·navigation은 재클릭 없이 결과 불명
  인계하며, path·정확한 완료 문구·방문예정 일치가 모두 있어야
  `COMPLETED`다.
- scheduled 유료 실행은 일회성 PIN이 없어 outer claim 전에 인계한다.

## 7. Task 5 — telemetry·diagnostic secret 차단

**목표:** 완료 단계의 비민감 구조 facts만 관측하고 PIN·폼 답변·카드
식별정보가 trace, error, snapshot과 diagnostic ZIP에 들어갈 수 없게
한다.

**주요 파일:**

- `src/shared/telemetry/codes.ts`
- `src/content/telemetry/trace-logger.ts`
- Background trace descriptor 생성 경로
- `src/content/diagnostics/dom-snapshot.ts`
- `src/content/diagnostics/recorder.ts`
- 관련 trace/diagnostic/bundle 테스트

**먼저 실패해야 하는 테스트:**

- trace config는 `requiredFormDefaultAnswer` 값을 redact한다.
- background start failure와 terminal trace도 같은 답변 값을 redact한다.
- `paymentPinProvided` boolean은 허용된다.
- PIN 값·길이·digit·입력 순서·keypad 배열은 trace attribute에 없다.
- completion telemetry는 금액, 필수/선택 수, claim phase, dispatch
  boolean, PIN UI 유형, 성공 evidence boolean만 기록한다.
- 완주 `handed_off`·`timed_out`은 정제된 reservation-form failure
  snapshot과 terminal event의 `diagnosticSnapshotId`를 남긴다.
- PIN surface snapshot은 credential surface marker 외 controls, text
  snippet, fragment를 저장하지 않는다.
- terminal event용 compact stage snapshot도 PIN surface의 heading,
  button 순서와 disabled 상태를 저장하지 않는다.
- PIN 입력 도중 failure snapshot과 diagnostic ZIP에 sentinel,
  keypad 순서와 입력 개수 추론 정보가 없다.
- static error code/message만 남고 caught secret-bearing error는
  trace하지 않는다.

**구현 계약:**

- PIN은 telemetry API 인자에 전달하지 않는다.
- 자유입력 답변은 의도된 config storage에는 존재할 수 있으나 모든
  trace·diagnostic descriptor에서 값이 제거된다.
- PIN surface redaction 실패는 진단 생성을 건너뛰는 방향으로
  fail-closed한다.
- 진단 실패가 예약 제어를 바꾸지 않는 기존 격리는 유지한다.

**검증:**

```bash
npm run build
node --test tests/trace-logger.test.mjs tests/diagnostic-dom-snapshot.test.mjs \
  tests/diagnostic-recorder.test.mjs tests/diagnostic-bundle.test.mjs
npm run check
git diff --check
```

- [x] 실패 테스트 확인
- [x] 최소 구현
- [x] 대상 테스트 통과
- [x] 전체 check 통과
- [x] Codex diff 검수

Task 5 결과:

- 예약 폼 실패도 terminal `diagnosticSnapshotId`와 구조화 snapshot을
  남긴다. 예약 폼 HTML fragment는 저장하지 않는다.
- PIN surface는 heading·controls·query·fragment·active element를
  수집하지 않는다. 예약 폼 결제 radio의 카드 별칭·마스킹 번호도
  snapshot에서 제거한다.
- trace에는 `paymentPinProvided` 같은 비민감 boolean만 허용하고
  공통 자유입력 답변은 Content·Background 양쪽에서 redact한다.

## 8. Task 6 — 통합 회귀와 문서 경계 정합성

**목표:** 수동·scheduled·recovery·storage·terminal 소비처 전체에서 새
계약을 고정하고 과거 “폼 자동화 문자열 부재” gate를 새 안전 gate로
교체한다.

**주요 파일:**

- `tests/build-regression.test.mjs`
- `tests/run-supervisor.test.mjs`
- `tests/scheduled-jobs.test.mjs`
- `tests/saved-configs.test.mjs`
- `tests/indexeddb-trace-repository.test.mjs`
- 필요한 integration fixture 테스트
- `docs/specs/product-requirements.md`
- `docs/specs/automation-boundary.md`
- `docs/design/state-machine.md`
- `docs/testing/test-strategy.md`
- `README.md`

**먼저 실패해야 하는 테스트:**

- opt-in off와 구버전 config는 폼 handoff를 유지한다.
- opt-in on에서만 exact final label과 success postcondition 코드가
  bundle에 포함된다.
- PIN field는 password지만 PIN 문자열·테스트 sentinel은 dist에 없다.
- PIN이 config, saved config, job, logical run, active run, run event,
  IndexedDB run/event/snapshot과 diagnostic bundle에 없다.
- recovery·다른 실행·scheduled job에 이전 authorization이 없다.
- 동일 logical run에서 outer/pin dispatch가 중복되지 않는다.
- `COMPLETED` terminal 효과·Side Panel 표시·scheduled result가
  실제 success evidence 뒤 한 번만 발생한다.

**구현 계약:**

- 기존 hot path, availability probe, 날짜 toggle와 slot click claim을
  관련 없이 변경하지 않는다.
- 과거 문서의 “예약 폼에서 항상 인계” 문구를 opt-in 경계와 새 성공
  계약으로 갱신한다.
- 아직 확인되지 않은 full reload·PIN 오류 variant는 deferred로 남긴다.

**검증:**

```bash
npm run check
git diff --check
```

- [x] 실패 테스트 확인
- [x] 최소 구현·문서 갱신
- [x] 전체 check 통과
- [x] unrelated diff 없음
- [x] Codex 구현 완료 판정

Task 6 결과:

- build gate를 완주 opt-in·PIN 비하드코딩·authorization 조기 폐기
  계약으로 교체했다.
- terminal trace/IndexedDB가 `COMPLETED`를 보존하고 자유입력 답변을
  저장하지 않는 회귀 테스트를 추가했다.
- 기존 hot path, 날짜 toggle, availability probe와 slot click claim은
  변경하지 않았다.

## 9. 체크포인트 이후 실행 방식

`ab5e825` 이후 Task 3 결함 수정과 Task 4~6은 Codex가 단독으로
수행했다. Claude worker와 Orca orchestration을 사용하지 않았으며,
현재 worktree의 diff·실패 테스트·전체 검증을 직접 확인했다.

## 10. 구현 완료 gate

다음이 모두 참이어야 `40-verification`으로 전환한다.

- [x] Task 1~6의 실패 테스트와 최소 구현 완료
- [x] 전체 `npm run check` 통과
- [x] PIN sentinel 전 저장·진단 경로 부재
- [x] outer/pin 중복 dispatch 회귀 통과
- [x] success 후조건 이전 `COMPLETED` 불가
- [x] opt-in off 기존 handoff 보존
- [x] scheduled 유료 outer submit 0회
- [x] source/test/문서 diff를 Codex가 직접 검수
- [x] `git diff --check` 통과
- [x] 새 실사이트 사실을 분석·설계에 선반영

구현 완료는 Chrome E2E 완료가 아니다. 그 결과는
`40-verification.md`에서 별도로 검증한다.
