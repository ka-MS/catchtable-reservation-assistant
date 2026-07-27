# CatchPay 예약 완주 설계

**상태:** 사용자 승인 완료
**기준 분석:** [10-analysis.md](10-analysis.md)
**구현 승인:** 2026-07-24 사용자 명시 승인

## 1. 목표와 성공 기준

현재 `/ct/reservation/form` 즉시 인계를 opt-in 조건에서만 확장한다.
로그인·선택된 CatchPay·예약 내용·금액·필수 입력·필수 약관을 최종 제출
직전에 다시 확인하고, 실측된 완료 후조건을 관측한 경우에만
`COMPLETED`로 종료한다.

성공 기준:

1. 기본값과 구버전 설정은 계속 예약 폼에서 `HANDED_OFF`다.
2. 완주 opt-in 실행은 설정과 현재 폼이 정확히 일치할 때만 제출한다.
3. 외부 최종 제출과 PIN 내부 제출은 각각 최대 한 번이다.
4. PIN은 실행 메시지와 Content 메모리 밖에 저장되지 않는다.
5. 클릭 dispatch 자체는 성공이 아니다.
6. 비로그인, CatchPay 미선택, 일반결제, 명시적으로 판정된 등록 필요
   상태, 선택 약관, 금액 초과, 불명확한 DOM과 결과 불명은 자동
   진행하지 않는다.

## 2. 핵심 결정

| 항목 | 결정 |
|---|---|
| DOM 책임 | 새 `ReservationFormAdapter` |
| 순서·정책 책임 | 최소 `CompletionCoordinator` |
| 공유 상태 | `COMPLETING_RESERVATION` 하나 추가 |
| 기본 동작 | `reservationCompletionEnabled=false` |
| 결제 상한 기본값 | `maxPaymentAmountKrw=0` |
| 빈 필수 자유입력 | 설정된 공통 기본 답변만 사용, 없으면 인계 |
| PIN | Side Panel의 일회성 수동 실행 authorization |
| 유료 scheduled job | 무인 완주 미지원, 외부 제출 전 인계 |
| 0원 scheduled job | 모든 검증과 필수 입력을 충족하면 완주 허용 |
| PIN UI | same-origin·same-document custom keypad, 새 권한 없음 |
| 성공 | path + 완료 메시지 + 일치하는 방문예정 항목 |
| 결과 불명 | 재클릭 없이 `HANDED_OFF` |

외부 결제 Adapter, iframe bridge, 새 host permission과 PIN 저장소는 만들지
않는다.

## 3. 책임 경계

### 3.1 `ReservationFormAdapter`

DOM만 읽고 한 번의 원자적 action을 수행한다. 실행 정책, timeout,
telemetry, stop 판단과 상태 전이는 소유하지 않는다.

주요 반환 형태:

```ts
type ReservationFormInspection =
  | { kind: "login_required"; fingerprint: string }
  | { kind: "ready"; facts: ReservationFormFacts; fingerprint: string }
  | { kind: "pin"; facts: CatchPayPinFacts; fingerprint: string }
  | { kind: "success"; facts: CompletionFacts; fingerprint: string }
  | { kind: "hold_expired"; fingerprint: string }
  | { kind: "unknown"; code: ReservationFormUnknownCode; fingerprint: string };
```

Adapter가 소유할 action:

- 비어 있는 지원 대상 필수 multiline 입력 채우기
- 필수 약관 개별 동의
- 안전성이 증명된 필수 전용 group 동의
- 외부 `자동결제로 예약하기` 1회 클릭
- 현재 PIN keypad에서 숫자 button 1회씩 클릭
- 내부 `결제하기` 1회 클릭

모든 action은 전달받은 fingerprint와 fresh inspection이 같을 때만
수행한다. 저장해 둔 Element를 재사용하지 않는다.

### 3.2 `CompletionCoordinator`

한 `RunSession` 안에서 다음 순서를 직렬로 소유한다.

```text
폼 식별
→ 로그인·예약 내용·결제수단·금액 검증
→ 빈 필수 입력 채우기
→ 필수 약관만 동의
→ 전체 fresh 재검증
→ 외부 submit claim ACK
→ 외부 submit 1회
→ 0원: 성공 관측
   유료: PIN 구조 검증 → PIN 입력 → 내부 submit claim ACK
         → 내부 submit 1회 → 성공 관측
→ COMPLETED 또는 안전 종료
```

Coordinator만 one-shot authorization을 볼 수 있다. Adapter에는 한
문자씩 전달하고, Adapter의 반환값·오류·telemetry에는 문자나 길이를
포함하지 않는다.

### 3.3 기존 `OpenRunOrchestrator`

- 선택한 `SlotCandidate`의 실제 시간과 예약 intent를 completion에
  전달한다.
- 예약 폼 도달 시 opt-in이 꺼져 있으면 기존 인계를 그대로 수행한다.
- opt-in이면 `COMPLETING_RESERVATION`으로 전이하고 Coordinator를
  호출한다.
- 메뉴 기본 선택은 기존 규칙을 유지한다. 키워드가 없으면 첫 번째
  선택 가능한 메뉴, 수량형이면 예약 인원수만큼 선택한다.

## 4. 예약 intent와 최종 검증

슬롯 클릭 전에 다음 실행 메모리 값을 고정한다.

```ts
interface ReservationIntent {
  shopSlug: string;
  shopDisplayName: string;
  reservationDate: string;
  selectedMinutes: number;
  personCount: number;
}
```

- `shopSlug`는 검증된 `targetUrl`에서 얻는다.
- `shopDisplayName`은 같은 매장 페이지의 유일한 주 heading에서
  캡처한다. 유일하게 읽지 못하면 완주하지 않는다.
- `selectedMinutes`는 실제 클릭 claim을 얻은 `SlotCandidate`에서
  가져온다. 단순 시간 범위 시작값을 쓰지 않는다.

외부 제출 직전 한 번의 fresh inspection에서 모두 참이어야 한다.

1. path가 `/ct/reservation/form`이다.
2. 로그인·회원가입 gate가 없다.
3. 폼의 표시 매장명이 `shopDisplayName`과 정규화 일치한다.
4. 날짜·시간·인원이 `ReservationIntent`와 정확히 일치한다.
5. active hold countdown이 남아 있고 만료 문구가 없다.
6. 현재 총 결제금액을 하나의 정수 KRW 값으로 읽을 수 있다.
7. 금액이 0 이상이고 `maxPaymentAmountKrw` 이하이다.
8. `input[name="payment-type"]`에서 CatchPay만 checked다.
9. 일반결제가 selected가 아니다.
10. 모든 지원 대상 필수 입력이 채워졌다.
11. 모든 필수 약관이 checked다.
12. 선택·마케팅 control의 checked 상태가 실행 전 baseline과 같다.
13. 유일한 최종 button의 accessible name이
    `자동결제로 예약하기`다.

매장명, 요약, 금액 또는 button이 둘 이상으로 모호하면 인계한다.

### 4.1 금액 판정

- `총 결제 금액` 또는 하단 `결제금액` 요약에 구조적으로 연결된
  현재 금액만 읽는다.
- `<s>`·`<del>` 또는 computed `text-decoration-line: line-through`인
  취소선, 이전 가격, `aria-hidden` 값은 현재 금액에서 제외한다.
- 숫자와 `원`이 인접 text node로 분리될 수 있으므로 개별 text node를
  파싱하지 않는다. 구조적으로 연결된 범위에서 전체 textContent가
  정확한 KRW 형식인 가장 작은 요소만 후보로 삼는다.
- 두 요약은 같은 폼에 함께 존재할 수 있다. 각 요약에서 현재 KRW 값이
  정확히 하나여야 하며, 모든 요약의 현재값이 같을 때만 그 단일 값으로
  수렴한다. anchor별 값이 0개·2개 이상이거나 서로 다르면 인계한다.
- `isDepositFree` query나 이전 메뉴 보증액만으로 0원을 추론하지
  않는다.
- 외부 submit claim 직전과 PIN 내부 submit claim 직전에 다시
  판정한다. 값이 바뀌면 제출하지 않는다.

### 4.2 로그인·CatchPay 판정

- 로그인 gate의 구조적 표식이 하나라도 있으면 `login_required`다.
- CatchPay radio는 실측된 `input[name="payment-type"]`과 인접 label로
  식별한다.
- 명시적 `캐치페이` label이 없는 실측 변형은 visible payment radio가
  정확히 2개이고, label ancestor로 `일반결제`인 radio가 정확히 하나일
  때만 나머지 하나를 CatchPay 후보로 판정한다.
- 유일하게 식별된 CatchPay radio가 checked이고 일반결제가 selected가
  아닐 때만 진행한다.
- 등록 카드 안내문은 presentation copy이므로 존재 여부를 hard gate나
  `registered` telemetry로 사용하지 않는다.
- 카드 브랜드, 마스킹 번호와 card label text는 읽거나 기록하지 않는다.
- 일반결제의 enabled 여부와 무관하게 선택·전환 action은 없다.
- 미등록 CatchPay 화면은 아직 실측되지 않았다. 명시적인 등록 필요
  surface가 관측되면 새 사이트 사실을 분석 문서에 먼저 기록하고 별도
  인계 gate를 추가한다. 실측 전에는 문구나 URL query를 추측하지 않는다.

### 4.3 예약 폼 매장명 판정

2026-07-24 우블랑 0원 폼과 더피제리아마켓 유료 폼을 추가
교차 실측한 결과, 폼의 매장 표시명은 본문 `main` 밖 top bar의
네이티브 `header` 안 단일 `h1`에만 있었다.

- `header h1` 후보가 정확히 하나이고 trim한 textContent가 비어 있지
  않아야 한다.
- 이 값을 예약 전 매장 페이지에서 고정한 `shopDisplayName`과 기존
  텍스트 정규화 규칙으로 정확히 비교한다.
- `h1` 부재·중복·빈 값·불일치는 `unknown`/인계다.
- `document.title`, 본문의 다른 heading, URL query와 과거 DOM 값을
  fallback으로 사용하지 않는다.
- generated class, `id`, `aria-label`과 `aria-labelledby`에 의존하지
  않는다. 두 실측 표본에서 이 속성들은 anchor로 존재하지 않았다.
- generated wrapper가 삽입될 수 있으므로 `h1`이 `header`의 direct
  child인지는 요구하지 않는다.

예약 전 매장 상세의 `shopDisplayName` 고정은 2026-07-25 재실측에 따라
문서 전체의 유일하고 비어 있지 않은 `h1` textContent를 사용한다.
`main h1`에는 한정하지 않는다. 후보 부재·중복·빈 값이면 이후 폼
매장명 비교를 시작하지 않고 인계한다.

## 5. 필수 입력과 약관

### 5.1 빈 필수 입력

새 영속 설정 `requiredFormDefaultAnswer`를 둔다.

- 이미 값이 있는 필수 input은 변경하지 않는다.
- `[필수]`, native `required` 또는 `aria-required=true`로 구조적으로
  연결된 빈 multiline textbox만 지원한다.
- label/required/aria 연결이 없는 실측 변형은 textarea에서 위로 올라가
  textarea를 정확히 하나 포함하고 direct heading(`h1`~`h6`)도 정확히
  하나인 가장 가까운 질문 container만 허용한다. 그 heading의
  `[필수]`/`[선택]` marker를 해당 textarea에 적용한다. 후보가 없거나
  heading·textarea가 복수면 추측하지 않는다.
- 지원 대상마다 같은 설정값을 넣는다.
- React 제어 textarea는 native prototype value setter와 bubbling
  `InputEvent("input")`·`change` event를 사용하고, action 직후 실제
  value 일치를 확인한다.
- 설정값이 비었거나, 새로운 필수 single-line/select/file input이
  있거나, label 연결이 모호하면 인계한다.
- 방문 목적은 실측상 `[필수]`가 아니므로 선택하지 않는다.

이 값은 draft, history, favorites와 scheduled job에 저장되는 일반
설정이다. 알레르기 등 개인정보가 될 수 있으므로 Side Panel에 저장
사실을 명시하고 trace·diagnostic에는 값 자체를 남기지 않는다.

선택지:

- 공통 답변 1개는 가장 작은 구현이며 우블랑 실측 구조를 처리한다.
- label별 답변 map은 더 정확하지만 동적 UI·migration 범위가 커 이번
  단계에서는 만들지 않는다.

### 5.2 약관 식별

- control과 같은 label/section에 정확한 `[필수]` 표기가 있을 때만
  required로 분류한다.
- `[선택]`, 마케팅, SMS, 이메일, 광고성 정보는 optional로 분류하고
  클릭하지 않는다.
- 표기가 없고 native required 근거도 없는 방문 목적 등은 건드리지
  않는다.
- baseline에서 이미 선택된 optional을 자동 해제하지는 않지만,
  extension action 전후 상태가 바뀌지 않았음을 검증한다.

개별 required control을 우선 클릭한다. `모두 동의합니다` 같은 group
control은 다음을 모두 증명할 때만 사용한다.

실측된 마침표 변형 `모두 동의합니다.`도 같은 명시적 group label로
허용한다. 개별 required click은 action 뒤 checked를 확인하고, 변하지
않은 경우에만 아래 group 안전성 검사를 적용한다.

1. 같은 agreement section의 member 집합을 완전히 열거할 수 있다.
2. 모든 member가 required다.
3. optional·marketing member가 0개다.
4. group action 뒤 required 전부 checked이고 optional baseline이
   불변이다.

하나라도 증명하지 못하면 group을 클릭하지 않고 인계한다.

semantic `fieldset`/`section`이 없는 변형에서는 group부터 ancestor를
올라가 visible checkbox가 2개 이상인 첫 container를 member 범위로
사용한다. 그 가장 가까운 범위에서도 위 조건을 모두 통과해야 하며 더
넓은 ancestor를 임의 대체하지 않는다.

React group state는 클릭 뒤 지연 반영될 수 있다. 실측 76.6ms를
포함하도록 최대 250ms의 bounded 확인 구간에서 group과 required member
전부 checked 및 optional baseline 불변을 다시 관측한다. 반영되지
않거나 다른 폼 fingerprint 변화가 생기면 group을 재클릭하지 않고
인계한다.

## 6. 설정과 일회성 secret 계약

### 6.1 영속 설정

`ReservationConfig`에 최소 세 필드만 추가한다.

```ts
reservationCompletionEnabled: boolean;
maxPaymentAmountKrw: number;
requiredFormDefaultAnswer: string;
```

normalize/migration:

- 누락된 `reservationCompletionEnabled` → `false`
- 누락된 `maxPaymentAmountKrw` → `0`
- 누락된 `requiredFormDefaultAnswer` → `""`
- 상한은 정수 `0..500_000`
- 답변은 trim하고 문자열 형식만 검증한다. 실측에서 입력별
  `maxlength`를 확인하지 못했으므로 공통 설정에 임의 길이 상한을
  만들지 않는다. 향후 실제 DOM의 제한이 확인되면 `10-analysis`를
  먼저 갱신한 뒤 해당 입력 action 직전에 검증한다.

완주가 꺼져 있으면 다른 두 값은 실행 제어에 사용하지 않는다.
기존 `paymentMethodAutoAdvance`와 `paymentMethodPolicy`는 예약 폼 이전
dialog 정책으로 유지한다. 완주 기능은 결제 방식을 새로 선택하지 않는다.

### 6.2 일회성 authorization

```ts
interface OneShotRunAuthorization {
  catchPayPin: string;
}

type PanelStart = {
  type: "PANEL_START";
  config: ReservationConfig;
  authorization?: OneShotRunAuthorization;
};
```

계약:

- PIN은 `ReservationConfig`에 넣지 않는다.
- `RunSupervisor.startManual(config, authorization?)`만 받는다.
- `startLogical()`은 initial manual attempt의 `START`에만 authorization을
  전달한다.
- `LogicalRun`, `ActiveRun`, `reservationConfig`, history, favorite,
  draft, scheduled job과 recovery `START`에는 넣지 않는다.
- PIN은 숫자 네 자리 형식만 허용하되 오류에는 값·길이를 포함하지
  않는다.
- Content는 disposable wrapper로 보관하고 `RunSession.finally`에서
  참조를 `null`로 만든다.
- 0원 폼에서는 사용하지 않고 즉시 폐기한다.
- 다음 attempt, 다음 수동 실행과 다른 scheduled job으로 복사하지 않는다.

Side Panel:

- `type="password"`, `inputmode="numeric"`, `autocomplete="off"`
- 영속 폼 model과 분리된 DOM input
- `PANEL_START` payload를 만든 직후 화면 값을 비운다.
- 시작 실패, stop, terminal, Side Panel unload에서도 다시 표시하지 않는다.
- draft 저장, favorite 저장, 작업 저장과 초기화 로직이 PIN input 값을
  읽지 않는 테스트를 둔다.

## 7. 수동 실행과 scheduled job

| 실행 | 현재 금액 | PIN | 동작 |
|---|---:|---|---|
| 수동 | 0원 | 불필요 | 검증 후 외부 제출, 성공 관측 |
| 수동 | 1원 이상 | 제공됨 | 외부 제출 → keypad 입력 → 내부 제출 |
| 수동 | 1원 이상 | 없음 | 외부 제출 전에 인계 |
| scheduled | 0원 | 전달 경로 없음 | 검증과 필수 입력이 충족되면 완주 |
| scheduled | 1원 이상 | 저장 금지 | 외부 제출 전에 인계 |

유료 scheduled job을 무인 완주시키기 위한 PIN 저장소, 실행 시 prompt와
재접속 프로토콜은 이번 범위가 아니다.

## 8. 중복 제출 방지와 background claim

Content 메모리 boolean만으로는 Service Worker 재시작, stop 경쟁과
navigation을 설명할 수 없다. PIN이 아닌 최소 dispatch intent만
`LogicalRun`에 영속한다.

```ts
type CompletionDispatchPhase = "outer" | "pin";

interface CompletionDispatchClaim {
  fingerprint: string;
  outerClaimedAt: number;
  pinClaimedAt?: number;
  stopRequestedAt?: number;
}

type CompletionDispatchState =
  | { stopRequestedAt: number } // outer claim보다 먼저 직렬화된 stop
  | CompletionDispatchClaim;
```

fingerprint는 target slug, 날짜, 실제 선택 시간, 인원, 현재 금액과
폼 fingerprint의 hash다. PIN, 자유입력 값, 카드 label과 예약번호는 없다.

`LogicalRun.completionDispatch`는 `CompletionDispatchState`다. pre-claim
stop 표현을 위해 `CompletionDispatchClaim`의 필수 필드를 optional로
완화하지 않는다. success path navigation 예외와 reconcile의
“acknowledged claim” 판정은 `outerClaimedAt`이 존재하는 두 번째
variant만 인정한다.

Content→Background control message가 phase별 claim을 요청한다. Background
serial queue가 다음 순서로 처리한다.

1. active logical run·attempt·`EXECUTING` 일치 확인
2. stop 요청과 기존 claim 확인
3. `LogicalRun.completionDispatch` 영속
4. ACK
5. ACK를 받은 Content만 해당 button을 정확히 한 번 클릭

같은 phase와 fingerprint의 재전송은 같은 ACK를 반환하지만 새 클릭
권한을 만들지 않는다. 다른 fingerprint, 역순 phase, stale attempt와
stop 선행은 reject한다.

ACK 성공 payload는 `dispatchGranted: boolean`을 포함한다. phase를
처음 영속한 요청만 `true`, 동일 phase·fingerprint replay는 `false`다.
Content는 `dispatchGranted === true`인 응답에서만 button을 클릭한다.
단순 `{ ok: true }`만으로 최초 ACK와 replay를 합치지 않는다.

stop 경쟁:

- claim ACK 전 stop이 먼저 직렬화되면 claim을 거절하고 클릭하지 않는다.
- outer claim ACK 뒤 stop은 `stopRequestedAt`만 영속한다. 이미 허용된
  outer dispatch는 취소했다고 추측하지 않고 결과를 관측한다. 이
  경우 Background는 일반 `STOP`으로 Content 관측 루프를 abort하지
  않는다.
- stop이 outer와 pin claim 사이에 오면 pin claim을 거절하므로 내부
  결제는 클릭하지 않는다.
- pin claim ACK 뒤 stop은 이미 허용된 내부 dispatch를 되돌리려 하지
  않고 read-only 성공 관측만 수행한다.

claim 뒤 click API 오류, 응답 유실, DOM unload가 발생해도 자동으로 같은
phase를 다시 클릭하지 않는다.

Service Worker reconcile:

- completion claim이 있는 EXECUTING attempt는 RESET_PAGE로 복구하지
  않는다.
- PIN은 복구하지 않는다.
- 현재 Content 결과를 회수할 수 없으면 자동 재시작 없이 결과 불명
  `HANDED_OFF`로 종결한다.

새 사용자가 terminal 이후 명시적으로 다시 시작하는 것은 자동 retry가
아니다. 실행 내부 attempt와 recovery에서는 같은 예약을 재제출하지 않는다.

## 9. PIN 처리

유료 외부 제출 뒤 다음 사실을 모두 확인한다.

- top-level origin이 `https://app.catchtable.co.kr`
- path가 계속 `/ct/reservation/form`
- iframe 수가 0
- `캐치페이 비밀번호 입력` surface가 유일
- 일반 password input이 없음
- visible digit button이 0~9 각각 정확히 하나
- `전체삭제`와 내부 `결제하기`가 식별됨

숫자 배열의 위치와 관측 순서는 사용하지 않는다. 각 문자를 입력하기
직전에 fresh DOM에서 해당 accessible text의 button을 다시 찾아 한 번
클릭한다. 전체 입력 뒤 내부 button이 enabled이고 예약 intent·금액·
CatchPay facts가 유지될 때만 pin dispatch claim을 요청한다.

다음은 모두 자동 재시도 없이 secret 폐기 후 인계한다.

- keypad 구조 불일치
- digit button 중복·누락
- PIN 입력 뒤 내부 button 비활성
- 금액·예약 내용 변경
- 사이트 오류·PIN 실패·취소·timeout
- 사용자 stop이 pin claim보다 먼저 접수됨

잘못된 PIN live 화면은 미실측이므로 오류 문구를 추측해 다시 입력하지
않는다.

## 10. 상태 전이와 종료 의미

```text
ADVANCING_RESERVATION
  ├─ opt-in off / unsupported ───────────────→ HANDED_OFF
  └─ verified form ─→ COMPLETING_RESERVATION
                         ├─ success evidence ─→ COMPLETED
                         ├─ pre-claim stop ───→ STOPPED
                         ├─ pre-claim deadline → TIMED_OUT
                         ├─ unsupported/mismatch → HANDED_OFF
                         ├─ post-claim unknown ─→ HANDED_OFF
                         └─ pre-claim internal defect → FAILED
```

claim 이후에는 결제·예약 발생 가능성이 있으므로 timeout, navigation
소실과 예외를 `FAILED` 또는 `STOPPED`로 단정하지 않는다. 재제출 금지
메시지가 포함된 `HANDED_OFF`로 남긴다.

## 11. timeout과 navigation

- claim 전에는 기존 `stopAtMs`, 사이트 hold countdown과 AbortSignal을
  모두 지킨다.
- hold 만료 문구가 있거나 남은 시간을 확인할 수 없으면 제출하지 않는다.
- claim 뒤에는 최대 15초의 read-only 결과 관측 구간만 둔다.
- 관측 구간에는 외부·내부 button을 다시 클릭하지 않는다.
- 성공 path 외 다른 origin/path로 이동하면 결과 불명 인계다.
- acknowledged claim 뒤 탭이 닫히거나 실행 문맥이 사라져도
  `STOPPED`·`FAILED`로 단정하지 않고 결과 불명 `HANDED_OFF`로
  종결한다.

`src/background/navigation.ts`는 acknowledged completion claim이 있는
실행의 정확한 `/ct/mydining/my/planned`를 정상 완료 후보 path로
취급해 현재의 이탈 `STOPPED` 오판만 막는다. claim 없는 실행에는 이
예외를 적용하지 않는다.

현재 실측은 URL 전이만 확인했고 full reload와 SPA를 구분하지 못했다.
초기 구현은 살아 있는 Content Coordinator가 성공 DOM을 확인하는 최소
구조로 제한한다. 구현 E2E에서 document reload로 context 소실이
확인되면 새 사실로 `10-analysis.md`를 먼저 갱신하고, 그 뒤에만
background 재주입·완료 관측 재개 계약을 설계한다. 그 전에는 URL
하나만으로 `COMPLETED`를 만들지 않는다.

## 12. 성공 후조건

`CompletionFacts`는 다음 세 조건을 모두 만족해야 한다.

1. `location.pathname === "/ct/mydining/my/planned"`
2. visible element 중 normalized textContent가 정확히
   `자동결제로 예약을 완료했습니다`인 가장 작은 element가 하나 이상
   있음. heading role은 요구하지 않고, 같은 exact text를 가진 자손이
   있으면 부모는 후보에서 제외한다.
3. 방문예정 목록에 매장명·날짜·실제 선택 시간·인원이 모두 일치하는
   항목이 있음

초대장 overlay, tab badge, click return 값과 HTTP status만으로는
완료하지 않는다. message substring이나 후속 안내가 합쳐진 부모
textContent도 허용하지 않는다. raw 예약번호는 읽거나 저장하지 않는다.

## 13. telemetry와 diagnostic

허용 event/attribute:

- `completionEnabled`
- `paymentPinProvided`
- manual/scheduled origin
- 현재 금액
- required/optional control 수
- 빈 필수 입력 수와 처리 성공 여부
- CatchPay selected·general-payment-selected boolean
- claim phase와 ACK 성공 여부
- outer/internal dispatch 여부
- PIN UI의 same-origin, iframe 수, keypad 방식
- PIN 입력 성공 여부와 소요 시간
- success path/message/listing match boolean

금지:

- PIN 값·길이·문자·입력 순서
- keypad 관측 배열
- 자유입력 답변
- 카드 label·마스킹 번호
- Cookie, token, raw query와 raw 예약번호

`TraceLogger.cleanConfig()`는 `requiredFormDefaultAnswer`를 빈 값으로
redact한다. PIN은 처음부터 config나 trace API에 전달되지 않는다.
오류는 static code/message만 사용하며 caught value를 secret 경로에서
trace하지 않는다.

PIN surface를 감지한 diagnostic capture는 surface 전체를 민감 영역으로
표시하고 controls, text snippet과 fragment를 수집하지 않는다. PIN
입력 중 breadcrumb와 failure snapshot으로 입력 개수나 keypad 순서를
추론할 수 없어야 한다.

terminal event에 평탄화되는 compact `StageSnapshot`도 같은 PIN surface
에서는 heading, button, disabled 배열, dialog title/label을 수집하지
않고 `credential_surface` marker만 남긴다.

완주 단계의 `handed_off`와 `timed_out`은 일반 terminal transition을
직접 호출하지 않고 기존 diagnostic failure 경로를 사용한다. 예약 폼은
개인정보 보호를 위해 HTML fragment를 저장하지 않으며, 정제된
heading/button/radio/checkbox와 환경 정보만 저장한다. terminal event는
`diagnosticSnapshotId`로 해당 snapshot을 연결한다.

## 14. 파일 변경면

예상 최소 변경:

```text
src/shared/types.ts
src/shared/config.ts
src/shared/state-machine.ts
src/shared/run-control/logical-run.ts
src/shared/run-control/protocol.ts
src/content/adapter/reservation-form.ts
src/content/completion-coordinator.ts
src/content/orchestrator.ts
src/content/index.ts
src/content/telemetry/*
src/content/diagnostics/*
src/background/run-supervisor.ts
src/background/navigation.ts
src/background/index.ts
src/sidepanel/form-model.ts
src/sidepanel/index.ts
src/sidepanel/sidepanel.html
src/sidepanel/sidepanel.css
tests/fixtures/catchpay-*
tests/*reservation-form*
tests/*completion*
관련 config/state/supervisor/sidepanel/telemetry 테스트
```

새 외부 dependency, manifest permission과 unrelated refactor는 없다.

## 15. 구현 순서

각 task는 실패 테스트 작성 → 최소 구현 → 대상 테스트 →
`npm run check` 순서다.

1. 설정·migration·Side Panel
   - 기본 opt-in off와 상한 검증
   - PIN password input과 message 분리
   - draft/history/favorite/job 비유출
2. `ReservationFormAdapter`
   - C 비로그인, A 0원, B 유료, PIN, success fixture
   - 금액·예약 intent·CatchPay·필수 입력·약관 판정
3. `CompletionCoordinator`
   - 상태 전이, 외부/PIN dispatch 단일화
   - stop/timeout/DOM 변경
4. durable completion claim
   - 순수 logical-run 전이와 ACK replay
   - SW reconcile·navigation 경쟁
5. telemetry·diagnostic redaction
6. 문서 경계와 build regression 갱신

기존 “content bundle에 최종 버튼 문자열이 없어야 한다” build gate는
삭제만 하지 않는다. opt-in off, exact label, submit claim,
success postcondition과 PIN 비유출을 검증하는 gate로 교체한다.

## 16. 테스트 매트릭스

### Adapter fixture

- C 비로그인 gate → 제출 action 없음
- A 0원: 필수 10, multiline 3, optional 0
- B 유료: 필수 3, optional 0, 안전한 group 동의
- optional이 섞인 group → group 미클릭
- 방문 목적 → 미선택
- CatchPay 미선택·일반결제 선택 → 인계
- 등록 안내문이 없어도 CatchPay 선택·자동결제 button 계약이 맞으면 진행
- current 0원과 취소선 80,000원 구분
- 상한 초과·음수·두 금액·parse 실패 → 인계
- 날짜·시간·인원·매장 mismatch → 인계
- hold 만료·button 중복·DOM fingerprint 변경 → 인계
- PIN same-document keypad 0~9
- digit 누락·중복, iframe, password input 변형 → 인계
- success 세 조건 각각 누락 → `COMPLETED` 아님

### Coordinator·control plane

- opt-in off는 기존 `HANDED_OFF`
- 외부 submit 최대 1회
- 내부 submit 최대 1회
- claim ACK 유실·replay·conflict
- stop-before-outer, stop-between-outer-and-pin, stop-after-pin
- claim 뒤 context loss·timeout에서 재클릭 0회
- recovery attempt에 authorization 없음
- SW reconcile이 claimed attempt를 RESET하지 않음
- 같은 logical run의 중복 실행 차단
- 0원 scheduled 완료, 유료 scheduled 외부 제출 0회

### Secret 회귀

고유 sentinel PIN과 자유입력 sentinel을 사용해 다음을 검사한다.

- PIN sentinel이 `chrome.storage.local` 전체에 없음
- PIN sentinel이 IndexedDB run/event/snapshot에 없음
- PIN sentinel이 trace, error, Console과 diagnostic ZIP에 없음
- draft/history/favorites/scheduled job에 PIN 없음
- 이전 실행과 다른 실행에서 PIN 자동 재사용 없음
- 자유입력 sentinel은 의도된 config 저장 위치에는 존재할 수 있지만
  trace·diagnostic에는 없음
- dist source와 test failure 출력에 실제 테스트 PIN 값이 하드코딩되지 않음

## 17. 구현 후 검증

자동 검증:

- `npm run typecheck`
- 전체 단위·fixture 통합 테스트
- `npm run check`
- dist와 independence 검증
- `git diff --check`

Chrome E2E:

1. 확장 reload
2. Side Panel PIN input의 password·비영속성 확인
3. `ms` 비로그인 → 로그인 gate 인계, 제출 0회
4. `민석 + woo_blanc_` → 0원, PIN 없이 완료
5. `민석 + pizzeriamarket` → 일회성 PIN 자동 입력, 유료 완료
6. 성공 DOM과 terminal telemetry 대조
7. storage·IndexedDB·diagnostic에서 PIN 부재 확인

E2E는 실예약 두 건과 유료 1건을 다시 만들 수 있다. 허용된
매장·기간·시간·인원·500,000원 상한 안에서만 수행하고, 예약 알림 뒤
사용자가 직접 취소한다. 환불 완료는 사용자 확인 없이는 기록하지 않는다.

## 18. 잔여 위험과 deferred

- 완료 전이가 full reload면 초기 최소 구조는 결과 불명 인계할 수 있다.
  E2E 사실 확인 뒤에만 재주입 설계를 추가한다.
- PIN 오류·취소·timeout 화면은 미실측이므로 자동 retry하지 않는다.
- keypad 렌더 간 무작위성은 미확인이지만 숫자 label 재조회로 위치
  의존을 제거한다.
- 다른 매장의 새로운 폼 variant는 자동 일반화하지 않는다.
- 유료 scheduled job의 무인 완주는 지원하지 않는다.
- 사용자가 terminal 결과 불명 뒤 명시적으로 새 실행을 시작하기 전에
  실제 예약 내역을 확인해야 한다.

## 19. 승인 gate

승인이 필요한 핵심 결정:

1. 완주를 기본 `false` opt-in으로 추가한다.
2. 최대 결제금액 기본값은 0원, 설정 상한은 500,000원이다.
3. 빈 필수 multiline에는 영속되는 공통 기본 답변 하나만 사용한다.
4. PIN은 수동 실행 일회성 값이며 어떤 복구·예약 작업에도 저장하지
   않는다.
5. 유료 scheduled job은 외부 제출 전에 인계한다.
6. 구현 후 E2E에서 0원·20,000원 실예약을 다시 생성할 수 있고 사용자가
   직접 취소한다.
7. full reload가 확인되면 코드를 임기응변으로 확장하지 않고 분석·설계
   문서를 먼저 갱신한다.

2026-07-24 사용자가 설계와 Codex coordinator + Claude Sonnet 5 구현
orchestration 구조를 명시적으로 승인했다. `30-implementation.md`를
Codex가 작성한 뒤 구현을 시작한다.
