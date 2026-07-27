# CatchPay 예약 완주 구현·검증

**날짜:** 2026-07-27
**브랜치:** `codex/feat-catchpay-reservation-completion`
**기준 체크포인트:** `ab5e825`
**기능 커밋:** `111df98`
**상태:** 완료

## 완료

- Task 3 stale intent fingerprint를 실제 매장명·예약 요약 DOM shape로
  수정하고 네 intent 값별 action 0회 회귀를 추가했다.
- live에서 확인한 중복 금액 anchor, header wrapper, label 없는 CatchPay
  radio, React textarea와 지연 약관 반영, 일반 요소 성공 문구를
  `site-behavior.md`와 분석에 먼저 기록한 뒤 구현했다.
- `CompletionCoordinator`를 추가해 필수 입력·필수 약관·fresh 검증,
  outer/PIN durable claim과 성공 후조건 확인을 직렬화했다.
- 예약 폼 실패 snapshot을 terminal event에 연결하고, PIN surface와
  결제 radio의 credential/card 식별정보를 fail-closed redaction했다.
- 자체 적대적 리뷰에서 post-claim 예외, 비지원 PIN 대기, stale intent,
  duplicate amount, snapshot card leakage를 공격하고 회귀와 함께
  수정했다.
- `npm run check`: 518/518, typecheck, dist validation,
  MAIN/ISOLATED independence 통과.
- `git diff --check` 통과.

## 보존한 안전 계약

- 완주 opt-in off는 기존 예약 폼 인계를 유지한다.
- 일반결제로 전환하거나 선택 약관을 동의하지 않는다.
- scheduled 유료 실행은 일회성 PIN이 없어 outer submit 전에 인계한다.
- PIN은 Side Panel password input → initial manual `START` → Content
  메모리로만 전달하며 저장·trace·snapshot에 넣지 않는다.
- durable claim replay는 새 클릭 권한이 아니며 outer/PIN submit은
  각각 최대 한 번이다.
- path·정확한 성공 문구·동일 방문예정 항목 전부를 확인하기 전에는
  `COMPLETED`가 아니다.

## Chrome 증거

- 우블랑 0원: outer 1회 뒤 실제 성공 path·문구·방문예정 등재를
  확인했다. 당시 heading-only matcher는 결과 불명 인계했고 재제출하지
  않았다. matcher 수정과 fixture 회귀를 추가했고 사용자가 예약을
  취소했다.
- `ms` 비로그인: `login_required`, outer claim/dispatch 0회,
  `COMPLETING_RESERVATION` failure snapshot, 예약 생성 없음.
- 더피제리아마켓 유료의 초기 사용자 보조 E2E에서 첫 실행은
  20,000원 폼의 outer claim/dispatch 각 1회 뒤 PIN
  오버레이까지 도달했다. 상단·본문의 같은 exact heading 2개를 기존
  단일-heading matcher가 거부해 PIN claim·digit·내부 submit 0회,
  재제출 없는 결과 불명 인계로 끝났다. 결제·예약은 생성되지 않았다.
- 새 사실을 `site-behavior.md`와 10-analysis에 먼저 기록하고
  credential identity를 heading 수가 아닌 유일 dialog로 바꿨다. 같은
  dialog의 중복 heading은 허용하고 dialog 밖 동명 heading과 복수
  dialog는 거부하는 회귀를 추가했다.
- 이 빌드의 10:04 재실행도 outer claim/dispatch 뒤 PIN phase 0회로
  안전 인계됐다. live 접근성 tree에는 두 heading과 하나의 keypad는
  있지만 이들을 감싸는 dialog 경계가 없었다. 분석·설계를 다시
  선반영하고 identity를 문서 전체의 완전하고 유일한 keypad control
  집합으로 정정했다.
- 수정 뒤 `npm run check`: 512/512, typecheck, dist validation,
  MAIN/ISOLATED independence 통과. `git diff --check`도 통과했다.
- 10:29 control-set 수정 dist는 PIN surface facts를 정상 기록했지만
  바깥 폼 전체 ready fingerprint 재검증이 modal visibility 변화를
  예약 변경으로 오판했다. digit·pin claim·내부 submit은 0회였고
  결제·예약은 생성되지 않았다. stable payment context만 비교하도록
  분석·설계를 먼저 정정했다.
- stable-context 수정 dist의 10:42 사용자 수동 실행은 PIN 없이
  `예약을 진행 중입니다`로 바로 전환했다. pin phase와 성공 근거 없이
  15초 뒤 무재제출 결과 불명 인계됐고, 사용자는 실제 결제·예약 없음도
  확인했다. 이 표본은 stable-context 통과 근거로 세지 않는다.
- 11:09 live 실행에서 React keypad에 digit을 동기 burst로 보내면 첫
  digit만 반영되는 결함을 확인했다. digit마다 fresh control 집합과
  stable payment context를 재검증하고 100ms bounded settle을 두는
  회귀를 추가했다.
- 11:37에는 PIN이 화면에 즉시 보이지만 Chrome 접근성 tree에는 처리
  overlay만 노출되는 사실을 확인했다. PIN matcher와 credential
  redaction에만 `aria-hidden`/`inert`를 무시하는 rendered 판정을
  적용하고 HTML/CSS hidden과 중복 keypad 거부는 유지했다.
- 12:05 최종 유료 E2E는 20,000원, 2026-08-11 11:00, 2명 조건으로
  성공했다. outer/PIN claim·dispatch는 각각 한 번이었고, same-origin·
  same-document keypad 뒤 성공 path·정확한 문구·방문예정 일치를
  모두 확인한 뒤 `COMPLETED`가 됐다.
- 사용자는 성공 예약을 직접 취소 완료했다. 취소는 자동화하지 않았다.

## 최종 진단

- 성공 run 진단 ZIP: event 63개, `seq=1..63` 연속, snapshot 0개.
- completion telemetry에는 `paymentPinProvided=true`, keypad 구조와
  성공 boolean만 있고 raw PIN·digit·배열은 없다.
- 세 Chrome 프로필의 extension storage와 IndexedDB에
  `catchPayPin` key가 없었다. 성공 run은 민석 프로필 IndexedDB에만
  있었고 허용된 제공 여부 boolean만 남았다.
- 최종 `npm run check`: 518/518, typecheck, dist validation,
  MAIN/ISOLATED independence 통과.
- `git diff --check` 통과.

## 잔여 위험

- 잘못된 PIN·사이트 timeout·미등록 CatchPay 전용 변형은 미실측이며
  자동 재입력 없이 결과 불명 인계한다.
- 완료 전이의 full reload 복구는 구현하지 않았다. 살아 있는 Content
  context에서 세 성공 근거를 확인하지 못하면 재제출하지 않는다.
- 유료 scheduled job은 PIN을 영속하지 않으므로 외부 submit 전에
  인계한다.
