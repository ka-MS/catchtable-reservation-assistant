# CatchPay 예약 완주 분석

**상태:** 확정 — 통제 실측 및 evidence 검토 완료
**기준일:** 2026-07-24
**구현 승인:** 없음

## 1. 분석 질문

다음 질문에 실측과 코드 근거로 답한 뒤에만 설계로 전환한다.

1. 예약 폼에서 어떤 필수 입력과 필수 약관을 어떻게 안정적으로 식별하는가?
2. 등록된 CatchPay가 존재하고 현재 선택됐음을 어떤 DOM 사실로 판정하는가?
3. 매장·날짜·시간·인원과 총 결제금액을 최종 제출 직전에 어떻게 재검증하는가?
4. 0원 CatchPay와 유료 CatchPay의 제출 이후 전이가 어떻게 다른가?
5. CatchPay PIN UI는 어느 origin·문서·iframe에 있고 일반 input 또는 보안 키패드 중 무엇인가?
6. 최종 제출 dispatch와 실제 예약 성공을 어떤 후조건으로 구분하는가?
7. PIN을 영속·로그하지 않고 수동 실행에만 전달할 최소 계약은 무엇인가?
8. stop, timeout, navigation, Content context 종료와 Service Worker 재시작에서 중복 제출을 어떻게 막는가?
9. PIN을 저장하지 않는 scheduled job에서 0원·유료 완주를 어디까지 지원할 수 있는가?

## 2. 현재 판정 요약

현재 저장소에는 예약 폼 이전 단계까지의 자동화와 실측 근거가 있다. `/ct/reservation/form`은 `PostSlotInspection.kind="form"`으로 판별되지만 `OpenRunOrchestrator.advancePostSlot()`은 1.5초 동안 늦은 홍보 안내만 처리한 뒤 `HANDED_OFF`로 종료한다.

`COMPLETED`는 타입, terminal 집합, Side Panel 표시, trace 저장과 예약 작업 결과에 포함돼 있지만 현재 상태 머신에는 `ADVANCING_RESERVATION`에서 `COMPLETED`로 가는 전이가 없다. 따라서 소비자는 일부 준비됐지만 성공을 생산하는 실행 경로와 의미 계약은 없다.

2026-07-23 자동화 경계는 방문 목적·필수 약관·유료 예약금·외부 결제·최종 예약까지 목표로 바뀌었다. 반면 제품 요구사항, 상태 머신, 테스트 전략과 기존 결제수단 패키지는 예약 폼에서 인계하는 과거 경계를 유지한다. 이 패키지는 새 정책을 그대로 구현하는 문서가 아니라, 먼저 실제 CatchPay 흐름을 관측하고 지원할 수 있는 좁은 계약을 확정하는 작업이다.

## 3. 근거 분류

### 3.1 사용자에게 확인된 사실

다음은 사용자가 직접 화면을 조작해 확인한 사실이다. DOM selector나 전이 시각은 아직 Claude 실측으로 재확인되지 않았다.

- CatchPay 결제수단이 등록된 로그인 프로필이 있다.
- 예약 폼에는 CatchPay와 일반결제 선택지가 표시될 수 있다.
- CatchPay 영역에는 등록된 결제수단이 선택된 상태로 표시될 수 있다.
- 필수 동의 항목을 처리한 뒤 최종 `결제하기` 버튼을 누르는 흐름이다.
- 0원 CatchPay는 PIN 화면 없이 바로 예약 제출로 진행되는 것으로 관측됐다.
- 예약금이 있는 CatchPay는 `결제하기` 뒤 CatchPay 내부 PIN 입력 화면이 나타난다.
- `민석` Chrome 프로필은 Catchtable 로그인 상태다.
- `ms` Chrome 프로필은 Catchtable 비로그인 상태다.
- 2026-07-24 최초 Claude 실측이 연결된 창은 `ms` 프로필이었고 예약 폼에서 로그인·회원가입 gate가 나타났다. 사용자가 별도 `민석` 프로필의 Catchtable `MY` 로그인 화면과 CatchPay 카드 관리 진입점을 확인해 두 창을 구분했다.
- 사용자는 허용 범위 안의 실결제를 승인했고 휴대폰 알림 확인 뒤 예약을 직접 취소한다.
- 2026-07-24 우블랑 0원 CatchPay 실예약 성공 직후 사용자가 해당 예약을 직접 취소했다고 확인했다.
- 2026-07-24 더피제리아마켓 20,000원 CatchPay 실예약도 사용자가 직접 취소했다고 확인했다. 환불 완료 여부는 별도로 확인되지 않았다.
- 구현 후 PIN은 Side Panel에서 매 실행 입력하는 일회성 파라미터여야 한다.
- 메뉴 키워드가 설정되지 않은 경우 기존 제품 규칙대로 첫 번째 선택 가능한 메뉴를 고른다. 수량형 메뉴는 예약 인원수와 같은 2개로 맞춘다.

사용자 제공 화면에서 확인 가능한 구조적 사실:

- 결제수단 섹션, CatchPay 선택 상태, 일반결제 미선택 상태와 최종 `결제하기` 버튼이 한 예약 폼에 표시된다.
- 총 결제금액과 예약 날짜·시간·인원 요약이 최종 버튼 주변에 표시된다.
- `[필수]` 표기가 있는 환불 정책 및 개인정보 제3자 제공 동의 항목이 있다.

화면에 표시된 카드 식별정보와 raw PIN은 이 문서에 기록하지 않는다.

### 3.2 기존 코드에서 확인된 사실

#### 예약 폼 도달과 종료

- `src/content/adapter/post-slot-inspection.ts`
  - `document.location.pathname === "/ct/reservation/form"`을 `reservation_form` URL kind로 분류한다.
  - 알려진 dialog가 없으면 예약 폼을 `PostSlotInspection.kind="form"`으로 반환한다.
- `src/content/orchestrator.ts`
  - `advancePostSlot()`이 `inspection.kind === "form"`을 관측하면 1.5초 홍보 안내 유예 뒤 `handOff()`한다.
  - 사용자 메시지는 약관 확인과 최종 예약을 직접 진행하라고 안내한다.
  - 폼 최초 관측 시각과 오픈 대비 지연을 event data에 남긴다.
- `src/background/navigation.ts`
  - 같은 origin의 `/ct/reservation/` 경로는 정상 예약 흐름으로 허용한다.
  - 다른 origin은 현재 `leftReservationFlow()`에서 이탈로 판단한다.
- `manifest.json`
  - host permission은 `https://app.catchtable.co.kr/*`뿐이다.
  - 외부 origin이나 cross-origin PIN iframe이 확인되면 현재 Content Script 주입 범위로는 조작할 수 없다.

#### 상태와 terminal 처리

- `src/shared/types.ts`에 `COMPLETED`가 이미 있다.
- Background, trace repository, trace logger와 Side Panel terminal 집합에 `COMPLETED`가 포함돼 있다.
- Side Panel은 `COMPLETED`를 성공 표시한다.
- `src/shared/state-machine.ts`
  - `COMPLETED`는 terminal 상태다.
  - `ADVANCING_RESERVATION`의 허용 전이는 `HANDED_OFF | STOPPED | FAILED`뿐이다.
  - `COMPLETING_RESERVATION` 상태는 아직 없다.
- `docs/architecture/state-machine.md`
  - `COMPLETED`를 향후 실측용, MVP 미사용 상태로 설명한다.
  - 예약 폼에서 최종 예약 버튼을 누르지 않는 것을 불변식으로 둔다.

#### 기존 결제 방식 자동 진행

- `ReservationConfig.paymentMethodAutoAdvance`와 `paymentMethodPolicy`가 있다.
- `paymentMethodPolicy`는 `zero_only | selected_allowed`다.
- `PostSlotAdapter`는 예약 폼 이전의 예약금 방법 dialog만 처리한다.
- `selected_allowed`는 0원 방식이 없을 때 사이트에서 이미 선택된 활성 방식을 유지한 채 중간 진행 버튼을 누를 수 있다.
- 선택되지 않은 유료 방식을 임의로 선택하지 않는다.
- `reservation-flow-compatibility/02-payment-method-auto-advance/`는 예약 폼 도착 후 입력·약관·최종 제출을 명시적으로 금지한다.
- 기존 설정, draft, history, favorites와 scheduled job은 `ReservationConfig` 전체를 저장한다. PIN을 이 타입에 추가하면 요구된 비영속성 계약을 즉시 위반한다.

#### 기존 메뉴 기본 선택

- `PostSlotAdapter.advanceMenuChoices()`는 `menuKeyword`가 비어 있으면 현재 선택된 메뉴를 우선 유지하고, 선택된 메뉴가 없으면 첫 번째 활성 메뉴를 고른다.
- 수량형 메뉴의 `advanceMenuCounts()`는 키워드가 없으면 첫 번째 수량 항목을 목표로 삼고 그 수량을 `personCount`와 같게 맞춘 뒤에만 진행한다.
- Side Panel도 `menuKeyword` 입력의 빈 값 의미를 `비우면 첫 메뉴`로 안내한다.
- 따라서 이번 실측의 첫 번째 메뉴·2개 선택은 새 예외가 아니라 현재 제품 계약을 그대로 적용한 것이다.

#### 저장과 실행 수명주기

- Side Panel `saveDraft()`는 폼 값을 `chrome.storage.local.draftForm`에 저장한다.
- history, favorites와 scheduled jobs는 정규화된 `ReservationConfig`를 영속한다.
- Background의 `RunSupervisor`와 Content `START` 메시지는 실행 설정을 전달하고 logical run/attempt를 관리한다.
- Content telemetry는 Background를 거쳐 IndexedDB에 저장되며 diagnostic bundle로 내보낼 수 있다.
- PIN은 config·event·error·snapshot 어느 직렬화 객체에도 들어가면 안 된다.
- Service Worker와 Content context는 재시작·종료될 수 있으므로 메모리 전용 PIN은 자동 복구할 수 없다.

#### 기존 테스트의 의도된 충돌

- `docs/testing/test-strategy.md`와 build regression은 예약 폼의 약관·최종 예약 자동화 코드가 없음을 현재 게이트로 둔다.
- 구현 승인 후에는 이 게이트를 단순 삭제하지 않고 새 안전 계약을 검증하는 테스트로 교체해야 한다.
- `docs/specs/product-requirements.md`는 유료 예약금·약관·결제·완료 판정을 비범위로 둔다.
- README와 `automation-boundary.md`는 완주 목표를 명시한다.

### 3.3 실사이트 기준 원본

`docs/analysis/site-behavior.md` §12와
`docs/evidence/live-runs/2026-07-24/catchpay-recon/README.md`에 2026-07-24
통제 실측 결과를 개인정보 제거 형태로 기록했다.

- 비로그인 C는 예약 폼의 로그인·회원가입 gate에서 최종 제출 0회로 종료했다.
- 로그인 0원 A는 최종 제출 1회, PIN 없이 성공했다.
- 로그인 유료 B는 외부 최종 제출 1회 뒤 같은 문서의 CatchPay PIN
  키패드로 전이했고, 사용자가 직접 PIN과 내부 결제를 수행해 성공했다.
- A와 B 모두 `/ct/mydining/my/planned`, 정확한 완료 메시지와 일치하는
  방문예정 목록 등재를 공통 성공 후조건으로 보였다.
- 두 실예약은 사용자가 직접 취소했다. 환불 완료 여부는 별도 사실로
  확정하지 않는다.

### 3.4 Claude 실측 결과

Orca orchestration의 Claude Opus 4.8 worker가 Chrome DevTools MCP로
2026-07-24 세 시나리오를 순차 실측했다. 같은 Chrome 프로필·탭의 병렬
조작을 피하기 위해 worker는 한 명만 사용했다.

- runtime: `0ae8d91c-b3bb-4b7b-8096-822b2d600537`
- task: `task_40cf0633762e`
- dispatch: `ctx_a53e1568a6f6`
- 최종 결과: `worker_done` 회수 완료

#### 비로그인 대조군

- 최초 연결 창은 `ms` 비로그인 프로필이었다.
- `/ct/reservation/form?isDepositFree=1`에 로그인·회원가입 gate가 나타났고 이름·휴대폰·비밀번호 입력과 회원가입 약관이 노출됐다.
- `GET /api/v1/collections/count`의 401 응답이 비로그인 상태를 뒷받침했다.
- 자동 로그인, 회원가입, 약관 동의와 최종 제출은 수행하지 않았다.

#### 로그인 0원 CatchPay

- `민석` 로그인 전용 `MY` 화면을 별도 target으로 식별한 뒤 우블랑을 같은 계약으로 재실행했다.
- `2026-08-10 12:00`, 2명에서 첫 번째 수량형 메뉴를 2개 선택했다. 메뉴 보증액은 80,000원이지만 예약 폼의 즉시 결제금액은 `80,000원 → 0원`이었다.
- 로그인 흐름은 별도 결제 방식 dialog 없이 `/ct/reservation/form?isDepositFree=1&openRegisterCard=0`으로 이동했다.
- 폼의 `input[name="payment-type"]` 첫 radio인 CatchPay가 checked이고 일반결제 radio는 disabled였다. 등록 카드의 식별정보는 기록하지 않았다.
- 0원 예약도 카드 확인용 100원 승인 후 즉시 취소된다는 안내가 있었다.
- 방문 목적 9개는 `[필수]` 표기가 없는 다중선택이었다.
- 로그인 변형의 필수 항목은 매장 유의사항 7개, 결제 영역 약관 3개와 multiline 자유입력 3개였다. 선택·마케팅 약관은 처리하지 않았다.
- 최종 버튼은 `자동결제로 예약하기`였고 필수 미충족 상태에서도 DOM상 enabled여서 활성 속성만으로 제출 가능 여부를 판정할 수 없다.
- 약 7분의 예약 점유 timer가 있으며 만료된 첫 시도는 제출하지 않고 fresh flow로 다시 진행했다.
- 동일 DOM 시점 재검증 뒤 최종 버튼을 1회 dispatch했다. PIN 화면 없이 `/ct/mydining/my/planned`로 전이했고 `자동결제로 예약을 완료했습니다` 메시지와 방문예정 목록 등재를 확인했다.
- 사용자는 휴대폰 알림 확인 뒤 해당 우블랑 예약을 직접 취소했다고 확인했다.

#### 로그인 유료 CatchPay

- `pizzeriamarket`은 월요일 휴무라 허용 범위의 첫 후보가
  `2026-08-11 11:00`, 2명이었다.
- 예약금 안내는 1인 10,000원, 총 20,000원을 표시했다. 폼의 현재
  총 결제금액도 20,000원으로 상한 500,000원 안이었다.
- `/ct/reservation/form?openRegisterCard=0`에서
  `input[name="payment-type"]`의 CatchPay가 checked, 일반결제가
  disabled였고 등록 결제수단 행이 있었다.
- 필수 약관은 환불정책과 개인정보 제3자 제공 2개, 총 3개였다.
  선택·마케팅 약관과 필수 자유입력은 없었다.
- 개별 control 조작이 되지 않는 두 약관이 있었지만, `모두 동의합니다`
  그룹이 정확히 이 필수 3개만 포함하고 선택·마케팅 항목은 0개임을
  먼저 확인한 뒤 그룹 control로 처리할 수 있었다.
- 외부 최종 버튼 `자동결제로 예약하기`를 1회 dispatch한 뒤
  최상위와 동일 origin·동일 document의 PIN UI가 나타났다. iframe은
  0개, 일반 password input은 0개였고 숫자 button 10개와 `전체삭제`로
  구성된 custom keypad였다.
- 한 번 관측한 숫자 배치는 비순차였지만 렌더 간 무작위 재배열 여부는
  확인하지 않았다. 위치가 아니라 현재 숫자 button의 accessible text로
  매번 식별해야 한다.
- 사용자가 브라우저에서 PIN과 내부 `결제하기`를 직접 수행한 뒤 기존
  문서 context에서 완료 흐름이 이어졌다.
- A와 같은 성공 URL·완료 메시지·방문예정 목록 등재가 나타났고 실제
  20,000원 결제가 발생했다.
- 사용자는 해당 예약을 직접 취소했다고 확인했다. 환불 완료는 별도
  확인하지 않았다.

#### 예약 폼 매장 표시명 추가 실측

Task 3 착수 중 예약 폼 안의 매장명 selector가 기존 §12에 기록되지
않았음을 확인해 구현을 멈추고, 같은 Orca orchestration 계약으로
Opus 4.8 focused read-only recon을 추가 수행했다.

- task: `task_41c8dcf66683`
- dispatch: `ctx_a95f2e411ffc`
- 우블랑 0원 폼과 더피제리아마켓 유료 폼 모두 매장 표시명이
  top bar의 네이티브 `header` 안 단일 `h1`로 나타났다.
- `header`는 접근성 `banner`, `h1`은 level-1 heading이며 이름 원천은
  자체 textContent다. `id`, `aria-label`과 `aria-labelledby` 참조는
  없었다.
- 폼 문서 전체에서 매장명 텍스트는 정확히 한 번만 나타났고,
  본문 `main`의 `예약 정보`에는 날짜·시간·인원만 있으며 매장명은
  없었다.
- `document.title`은 매장명이 없는 공통 문자열이라 대체 판정 근거로
  사용할 수 없다.
- 따라서 폼의 매장 identity는 유일하고 비어 있지 않은
  `header > h1` textContent로만 판정한다. 없거나 중복되거나 비면
  다른 heading·title을 추측하지 않고 인계한다.
- 두 폼 모두 최종 제출·PIN·결제·예약 생성 없이 관측을 종료했다.

#### 구현 후 통제 E2E 매장 상세 anchor 정정

2026-07-25 로그인된 우블랑 매장 상세를 read-only로 재확인하자 문서
전체의 `h1`은 매장명 하나뿐이었지만 `main` 아래에는 없었다. 따라서
예약 전 표시명을 `main h1`로 읽는 구현은 안전하게 실패하기만 하며
완주할 수 없다. 매장 상세에서는 문서 전체의 유일하고 비어 있지 않은
`h1`만 사용하고, 예약 폼에서는 기존 실측대로 유일한 `header > h1`을
사용한다.

같은 실행에서 우블랑 0원 폼은 본문의 `총 결제 금액`과 고정 하단의
`결제금액` 두 요약을 동시에 렌더했다. 둘 다 취소선 80,000원과 현재
0원을 표시했다. 본문 취소선은 `<del>`, 고정 하단 취소선은 일반
`span`의 CSS `text-decoration-line: line-through`였다. 따라서 라벨
하나만 허용하거나 의미 태그 취소선만 제외하는 기존 구현은 안전하게
인계하지만 정상 폼을 완주할 수 없다. 각 요약이 단일 현재값을 내고
모든 현재값이 같을 때만 그 값으로 수렴시키며, 하나라도 모호하거나
불일치하면 인계하는 것이 최소 수정이다. 또한 React가 같은 금액
요소 안에서 숫자와 `원`을 별도 text node로 만들므로, text node마다
파싱하지 않고 가장 작은 금액 요소의 전체 textContent를 파싱해야 한다.

후속 2026-07-25 폼에서는 매장명 `h1`과 네이티브 `header` 사이에
두 개의 generated wrapper가 추가됐다. `header > h1` direct-child
가정은 안전 인계만 일으켰다. 의미 구조는 그대로이므로 wrapper 깊이를
고정하지 않은 유일한 `header h1`을 사용하고, 중복·빈 값이면 인계한다.

같은 폼에서 CatchPay radio 자체와 두 겹 label에는 텍스트가 없고,
다른 radio의 바깥 label만 `일반결제`였다. radio는 정확히 2개였으며
선택된 비-일반결제 radio의 행에 등록 카드 자동결제 문구가 있었다.
따라서 명시적 CatchPay label이 없을 때만 이 2-radio 보완 판정을
허용한다. 어느 radio도 자동으로 선택하지 않는다.

2026-07-25 구현 E2E에서 `catchpay_not_ready`로 안전 인계됐지만 당시
terminal event에는 CatchPay 하위 판정값과 예약 폼 failure snapshot이
없어 radio 선택, 등록 안내문, 일반결제 중 어느 조건이 실패했는지
사후 구분할 수 없었다. 현재 등록 판정은 CatchPay radio의 가장 가까운
`section`에 `이 카드로 식사 금액이 자동결제 됩니다`라는 정확한 문구가
있는지에 의존한다. 이 문구와 wrapper는 결제 방식 자체보다 약한
presentation 근거라 정상 선택 상태를 거절할 수 있다.

사용자는 이 false negative를 줄이기 위해 중간안을 승인했다. 등록 카드
안내문은 더 이상 hard gate나 `registered` 사실로 사용하지 않는다.
제출 허용 조건은 유일하게 식별된 CatchPay radio가 checked이고
일반결제가 selected가 아니며, 최종 button이 정확히
`자동결제로 예약하기`인 경우다. 명시적 등록 필요 상태가 추후 실측되면
분석 원본을 먼저 갱신한 뒤 별도 인계 gate로 추가한다.

필수 입력 action까지 도달한 실행에서는 단순 textarea `.value=`가 React
상태에 반영되지 않아 값이 비어 있었고 반복 상한으로 안전 인계됐다.
또한 전체동의 문구가 `모두 동의합니다.`로 변형됐으며, 개별 필수 중
개인정보 2개만 클릭 후에도 unchecked였다. 네이티브 textarea setter와
`InputEvent`·`change` 및 action 후 상태 확인을 사용하고, 개별 required
클릭 실패 시에만 기존 required-only group 안전성 검사를 통과한
전체동의로 fallback한다. semantic section이 없을 수 있으므로 group
membership는 checkbox가 2개 이상인 가장 가까운 ancestor에서 열거한다.

후속 실행은 최종 제출 claim 없이 약관 단계에서 안전 인계됐다. 이
폼의 textarea에는 label/required/aria 연결이 없고, 가장 가까운
단일-textarea 질문 `div`의 유일한 direct `h4`가 `[필수]` 표기를
소유했다. 이 구조로 필수 textarea 3개와 비필수 textarea 3개가 정확히
분리됐다. 또한 `모두 동의합니다.` 재선택은 required 3개까지 checked가
되기까지 약 76.6ms가 걸려 클릭 직후 동기 판정이 실패를 오인했다.
질문 container의 구조가 유일할 때만 heading marker를 사용하고, group
click 뒤에는 bounded 확인으로 required 전부와 optional baseline을
재검증한다. 확인되지 않으면 group을 다시 클릭하지 않고 인계한다.

다음 0원 구현 E2E는 외부 제출 claim 한 번 뒤 실제 우블랑 예약을
생성했지만 완료 문구를 heading에서만 찾던 판정 때문에 재제출 없이
결과 불명 인계됐다. 현재 성공 문구는 일반 `div` 안의
`strong`+text node+`br`+`span`으로 분할되고, 가장 작은 해당 `div`의
normalized textContent만 정확히 `자동결제로 예약을 완료했습니다`였다.
성공 path와 일치하는 방문예정 `li`는 정상 관측됐다. 따라서 성공
문구는 heading role을 요구하지 않고 가장 작은 visible element의
exact normalized text로 판정한다. 부모의 추가 안내나 substring은
성공 근거로 인정하지 않는다. 이 실행은 제출 전 document marker가
없어 reload/SPA 구분 근거로는 사용하지 않는다.

같은 날 `ms` 비로그인 프로필의 negative-control은 예약 폼까지 도달한
뒤 `login_required`로 `HANDED_OFF` 됐다. 외부 제출 claim과 최종 버튼
dispatch는 없었다. terminal에는 `COMPLETING_RESERVATION` stage와
failure snapshot `ss-e06b7fd6`가 남아, 기존 예약 폼 handoff의 진단
누락이 해소됐음을 확인했다. 스냅샷은 프로모션 오버레이의 버튼 구조만
요약했고 로그인이나 결제를 진행하지 않았다.

2026-07-27 최신 dist의 더피제리아마켓 유료 E2E에서는 예약금
20,000원과 CatchPay 선택을 확인하고 outer claim/dispatch를 각각 한
번 수행해 PIN 오버레이까지 도달했다. 접근성 tree에는 exact
`캐치페이 비밀번호 입력` heading이 상단과 본문에 하나씩, 총 2개
있었다. 현재 adapter의 문서 전체 heading 단일성 가정 때문에 PIN
phase로 분류되지 않았고, PIN claim·digit action·내부 submit은 모두
0회였다. 결과 관측 timeout 뒤 재제출 없이 `completionClaimed=true`
`HANDED_OFF`로 끝났고, 사용자가 PIN이나 내부 결제를 수행하지 않아
예약·결제는 생성되지 않았다.

이 표본은 PIN UI가 제목을 중복 렌더하며 접근성 `dialog` 경계를
노출하지 않음을 확정한다. 같은 날 `role=dialog` 하나에 두 heading이
포함될 때만 허용한 최신 dist 재실행도 PIN phase 0회로 안전 인계됐다.
따라서 heading 수나 조상 role을 identity로 사용하지 않는다. top-level
문서에 exact heading이 하나 이상 있고 0~9 숫자 button, `전체삭제`,
내부 `결제하기`가 각각 유일한 완전한 control 집합일 때만 지원한다.
control 중복·누락은 복수/불완전 surface로 보고 계속 인계한다.

10:29 control-set 수정 빌드는 PIN surface를 정상 분류했다
(`sameOrigin=true`, `sameDocument=true`, iframe/password input 0,
keypad button 10). 그러나 PIN 입력 전 `inspectFormBelowPin()`이
제출 전 전체 ready fingerprint를 다시 요구하면서 인계됐다. live modal은
배경 예약 정보를 픽셀로 남기지만 바깥 폼 control을 이전과 동일한
visible shape로 열거하지 않는다. 전체 fingerprint에는 최종 button,
점유 타이머, 약관과 그 visibility까지 섞여 있어, 설계가 요구한
매장·날짜·시간·인원·금액·CatchPay 불변성보다 강한 false-negative
조건이었다. 이 실행은 digit, pin claim과 내부 submit 모두 0회였고
결제·예약은 생성되지 않았다.

PIN 전후에는 modal 표시로 달라지는 전체 ready shape를 비교하지 않는다.
같은 문서의 stable payment context인 매장 header, 예약 요약,
현재 결제금액, CatchPay selected와 일반결제 unselected만 제출 전 값과
다시 비교한다. 접근성 modal 때문에 `aria-hidden`/`inert`가 적용된
배경도 읽을 수 있어야 하지만, HTML `hidden`, CSS `display:none`/
`visibility:hidden`, anchor 부재·중복·불일치까지 허용하는 fallback은
만들지 않는다.

수정 dist의 10:42 사용자 수동 실행은 outer 뒤 PIN을 렌더하지 않고
`예약을 진행 중입니다`로 바로 전환됐다. pin surface/claim/dispatch와
성공 근거가 모두 없었고 15초 뒤 무재제출 결과 불명 인계됐다. 사용자는
실제 결제·예약 없음도 확인했다. 이는 post-claim 불명 정책의 음성
표본이며 stable-context live 통과 표본으로 세지 않는다.

11:02 재실행도 15초 안에 PIN이나 성공을 분류하지 못했으며 terminal 뒤
사용자 화면에는 입력 전 PIN keypad가 있었다. 다만 공유 화면의 시각은
PIN 전이 시각이 아니므로 `PIN 렌더가 15초보다 늦다`고 확정하지 않는다.
같은 조건의 11:09 재실행에서는 outer dispatch 91ms 뒤 PIN surface를
관측했다.

11:09 진단 bundle은 PIN 입력 동기화 결함을 확정한다. `pin_surface`
facts는 same-origin·same-document, iframe/password input 0, digit
button 10개와 내부 submit 비활성이었다. 20ms 뒤
`PIN 입력 뒤 결제 화면을 확인할 수 없어 자동 제출하지 않습니다.`로
끝났고, 화면의 PIN 진행 점은 하나만 채워져 있었다. 이는 첫 digit은
등록됐지만 나머지 digit을 React 반영 대기 없이 연속 dispatch한 뒤
즉시 확인해 내부 submit이 계속 비활성이었던 표본이다. pin claim,
내부 submit과 성공 관측은 없었다. credential snapshot은 control과
fragment를 보존하지 않아 PIN redaction도 유지됐다.

따라서 PIN 입력은 각 digit 직전에 fresh keypad에서 표시 숫자를 다시
찾아 한 번 클릭하고, click 사이에 bounded settle을 둬야 한다. 각
settle 뒤 PIN surface와 stable payment context가 유지되지 않거나 네
번째 입력 뒤 내부 submit이 활성화되지 않으면 secret을 폐기하고
무재시도 인계한다. 11:09의 91ms 표본 때문에 현재 15초 PIN surface
관측 상한은 유지한다. 실제 15초 초과 전이가 별도 타임스탬프로
확인될 때만 timeout 설계를 다시 연다.

11:21 재실행은 당시 timeout 재설계 조건으로 해석했다. outer dispatch는
11:21:45.224였고, 15.065초 뒤 terminal snapshot은 처리 presentation과
button 0개만 기록했다. 11:22:08.431 사용자 화면에는 입력 전 PIN
surface가 나타나 있었다. 그러나 11:37 동일 탭 교차 관측에서 화면에는
PIN이 보이는 동안 접근성 tree와 공통 diagnostic에는 처리 presentation과
button 0개만 남는 것을 확인했다. 따라서 11:21 snapshot은 PIN 미렌더
증거가 아니며 `15.065초보다 늦게 mount`했다는 추론을 철회한다.

11:37 실행은 outer dispatch 11:37:12.939 뒤 사용자에게 PIN 창이 바로
보였지만 matcher는 30.114초 동안 `pin`을 분류하지 못했다. 종료 뒤 같은
활성 `/ct/reservation/form`과 같은 Side Panel 실행을 읽었으므로 다른
탭 혼동은 배제됐다. 시각 화면에는 heading·고유 0~9 keypad·clear·내부
submit이 있었지만 접근성 tree에는 PIN 요소가 전혀 없고 처리
presentation만 있었다. exact DOM 격리 속성은 직접 측정하지 않았지만,
현재 matcher와 diagnostic이 `aria-hidden`/`inert`를 포함한 동일
visibility 필터를 공유하는 코드 사실과 일치한다.

따라서 원인은 timeout이 아니라 PIN credential surface의 accessibility
isolation false negative다. PIN surface identity에만 조상의
`aria-hidden`/`inert`를 무시하는 rendered 판정을 적용하되, HTML
`hidden`, CSS `display:none`/`visibility:hidden`, 불완전하거나 중복된
control 집합은 계속 거부한다. diagnostic PIN redaction도 같은 판정을
사용해야 한다. 유료 outer 뒤 관측 상한은 근거 없는 30초 확장을
철회하고 기존 15초로 되돌린다. 외부 submit은 어떤 경우에도 재클릭하지
않고 stop이나 만료 시 secret을 폐기해 결과 불명 인계한다.

12:05 수정 dist의 통제 실행은 같은 매장, 2026-08-11 오전 11:00,
2명, 20,000원 조건에서 실제 `COMPLETED`에 도달했다. outer
claim/dispatch는 각각 한 번이었고 dispatch 127ms 뒤
same-origin·same-document PIN surface를 관측했다. iframe/password
input은 0개, keypad button은 10개였다. surface 관측 485ms 뒤
pin claim/dispatch를 각각 한 번 수행했고, 2.566초 뒤 성공 path,
정확한 완료 문구와 일치 방문예정 항목을 모두 확인했다. terminal의
세 success boolean도 모두 true였다. 사용자는 생성된 예약을 직접
취소했다고 확인했다.

따라서 구현 E2E가 확정한 현재 계약은 다음과 같다. 접근성 격리
surface는 PIN 전용 rendered 판정으로 읽을 수 있고, digit별 bounded
settle 뒤 활성화된 내부 submit을 한 번 보낼 수 있다. `COMPLETED`는
outer나 pin dispatch가 아니라 세 성공 후조건 이후에만 기록된다.

### 3.5 시나리오 비교

| 항목 | C: 비로그인 우블랑 | A: 로그인 우블랑 0원 | B: 로그인 피제리아 20,000원 |
|---|---|---|---|
| 로그인 gate | 있음 | 없음 | 없음 |
| CatchPay | 판정 전 중단 | checked + 자동결제 최종 버튼 | checked + 자동결제 최종 버튼 |
| 일반결제 | 자동 선택 안 함 | disabled | disabled |
| 필수 약관 | 회원가입 변형 포함 | 매장 7 + 결제 3 | 결제 3 |
| 필수 자유입력 | 회원가입·매장 변형 | multiline 3 | 없음 |
| 현재 결제금액 | 0원 표시, 제출 안 함 | 0원 | 20,000원 |
| 외부 최종 제출 | 0회 | 1회 | 1회 |
| PIN | 도달 안 함 | 없음 | same-document keypad |
| 성공 후조건 | 없음 | URL + 메시지 + 목록 일치 | URL + 메시지 + 목록 일치 |

## 4. 통제된 실측 계약

### 허용 대상

| 구분 | 값 |
|---|---|
| 0원 CatchPay 매장 | `https://app.catchtable.co.kr/ct/shop/woo_blanc_` |
| 유료 CatchPay 매장 | `https://app.catchtable.co.kr/ct/shop/pizzeriamarket` |
| 로그인 프로필 | `민석` |
| 비로그인 프로필 | `ms` |
| 예약 기간 | `2026-08-10`~`2026-08-31` |
| 인원 | 2명 |
| 시간 | 11:00~21:00 |
| 선택 순서 | 가장 빠른 예약 가능 날짜의 가장 빠른 허용 시간 |
| 메뉴 | 별도 키워드가 없으므로 첫 번째 선택 가능한 메뉴, 수량 2개 |
| 결제금액 상한 | 500,000원 |

실결제는 이 범위 안에서 허용됐다. 예약 취소는 자동화하지 않고 사용자가 휴대폰 알림을 확인한 뒤 직접 수행한다.

### 최종 제출 안전선

- 한 실행의 최종 제출 dispatch는 최대 1회다.
- 제출 직전에 동일 DOM 시점에서 매장·날짜·시간·인원·금액·CatchPay 선택·필수 입력·필수 약관·버튼 identity를 재확인한다.
- inspection과 dispatch 사이 fingerprint 또는 값이 바뀌면 클릭하지 않는다.
- dispatch 뒤 성공이 불확실하면 timeout, Network 오류, reload를 이유로 재클릭하지 않는다.
- 완료 화면, 예약 내역 또는 사용자 확인으로 결과가 판정될 때까지 escalation한다.
- 허용 범위를 벗어난 대안을 찾거나 다른 매장으로 확장하지 않는다.

### PIN 실측

- raw PIN을 Claude task, prompt, orchestration message, 문서와 evidence에 넣지 않는다.
- PIN 화면에 도달하면 worker가 decision gate를 보내고 사용자가 브라우저에서 직접 입력한다.
- worker는 PIN 값이 아니라 origin, iframe, input/keypad 구조, 배열 특성, 입력 후 전이와 재개 가능성만 기록한다.

## 5. 남은 불확실성

다음은 실측하지 않았거나 1표본만 확인한 항목이다. 설계는 이를 성공으로
추측하지 않고 안전 인계로 닫으므로 구현 착수를 막지는 않는다.

| 미확정 사실 | 설계 영향 |
|---|---|
| 완료 전이가 full reload인지 SPA navigation인지 | 제출 claim 뒤 URL·Content 양쪽에서 결과를 관측하되 재클릭하지 않는다. |
| 성공 화면 reload 뒤 동일 예약을 다시 판독할 수 있는지 | 현재 실행에서 URL·메시지·일치 목록을 확인하지 못하면 `COMPLETED`가 아닌 결과 불명 인계다. |
| PIN 배열이 렌더마다 재배열되는지 | 위치를 사용하지 않고 매 입력마다 현재 button의 숫자 accessible text를 재조회한다. |
| 잘못된 PIN·취소·timeout 화면 | 자동 재입력·재제출 없이 secret을 폐기하고 인계한다. |
| CatchPay 미등록 로그인 폼 | 미실측이다. 등록 안내문 부재만으로 거절하지 않는다. 명시적 등록 필요 UI가 관측되면 분석 갱신 후 인계 gate를 추가한다. |
| 다른 매장의 새로운 필수 input·약관 구조 | 명시적으로 지원한 control 외에는 추측 입력하지 않고 인계한다. |
| 예약 폼의 shop slug 속성 | slug 속성은 확인되지 않았다. 이전 매장 페이지에서 캡처한 표시명과 폼의 유일한 `header > h1`을 정규화 비교하고, 없거나 중복·불일치면 인계한다. |

0원 폼의 `100원 결제 후 즉시 취소`는 사이트가 표시한 안내다. Network
차원에서 별도 검증한 금융 사실로 확대 해석하지 않는다.

## 6. 분석 결론과 구현 제약

- 예약 폼은 중간 dialog와 책임·DOM 수명이 달라 별도
  `ReservationFormAdapter`로 분리한다.
- 외부 제출, 선택적 PIN, 내부 결제와 성공 관측은 단순 adapter action을
  넘어선다. 최소 `CompletionCoordinator`가 순서와 단일 제출 claim을
  소유해야 한다.
- 상태는 `COMPLETING_RESERVATION` 하나만 추가한다. 폼 세부 단계를
  공유 상태로 늘리지 않는다.
- PIN UI는 현재 same-origin·same-document여서 새 host permission이나
  iframe runtime은 필요 없다.
- PIN은 현재 숫자 button의 accessible text로 입력 가능하다고 판단한다.
  입력 위치·관측 배열을 계약으로 삼지 않는다.
- `ReservationConfig`는 이미 draft, history, favorites, scheduled job과
  logical run에 저장된다. PIN은 반드시 `PANEL_START`의 별도 일회성
  authorization으로 전달하고 초기 수동 attempt 메모리에만 둔다.
- Service Worker·Content 복구 attempt에는 PIN을 복구하지 않는다. 다음
  attempt나 다른 작업에 자동 재사용하지 않는다.
- 유료 scheduled job은 PIN을 영속하지 않는 조건에서 무인 완주할 수
  없다. PIN 단계 전 인계가 안전한 범위다.
- 0원 scheduled job은 opt-in, 최종 검증, 필수 입력 기본값이 모두
  충족될 때만 완주 후보가 된다.
- `COMPLETED`는 클릭이나 URL 하나가 아니라 실측된 성공 path, 완료
  메시지와 예약 내용이 일치하는 방문예정 항목을 확인한 뒤에만 만든다.
- 제출 claim 이후 context 소실·timeout은 재제출하지 않고 결과 불명
  인계한다.

## 7. 위험

| 위험 | 영향 | 현재 대응 |
|---|---|---|
| 최종 submit 중복 | 중복 예약·결제 | 실행별 단일 claim, 불확실 결과 재클릭 금지 |
| 설정 불일치 | 잘못된 예약 | dispatch 직전 동일 시점 재검증 |
| 선택 약관 오동의 | 계정 설정·마케팅 동의 변경 | 필수 control만 exact 판별, 모호하면 인계 |
| 일반결제 전환 | 미허용 결제 흐름 | 이미 선택된 등록 CatchPay만 허용 |
| PIN 유출 | 인증정보 노출 | config와 모든 영속·진단 경로에서 분리 |
| 이전 PIN 재사용 | 다른 실행 무단 결제 | 실행 메모리 전용, 종료·attempt 전환 시 폐기 |
| 클릭만 성공으로 오인 | 잘못된 `COMPLETED` | 실측된 성공 후조건 필수 |
| reload/context 사망 | 결과 불확실 또는 재제출 | claim 유지, 재클릭 금지, URL·DOM 결과 관측 후 불명 인계 |
| PIN 구조 변경 | 잘못된 인증 입력 | 숫자 button 0~9 집합이 정확하지 않으면 입력하지 않고 인계 |
| 비로그인 오판 | 로그인 화면 오클릭 | negative-control 실측과 exact handoff |
| scheduled job secret 부재 | 유료 무인 실행 불가 | 20-design에서 명시적 선택 |

## 8. 설계 대안과 판정

### A. `PostSlotAdapter` 확장 대 새 `ReservationFormAdapter`

- 확장: 파일 수는 적지만 예약 폼의 입력·약관·결제·성공 확인이 중간 dialog 책임과 섞인다.
- 새 Adapter: 페이지 경계와 테스트가 명확하지만 실측 결과가 매우 단순하면 불필요한 계층이 될 수 있다.
- **판정: 새 `ReservationFormAdapter`.** 실측 결과 폼은 필수 입력,
  약관, 결제수단, 금액, PIN overlay와 성공 화면까지 별도 fixture가
  필요한 페이지 경계다.

### B. 오케스트레이터 직접 루프 대 Coordinator

- 직접 루프: 단계가 단순하면 최소 코드다.
- Coordinator: 필수 입력→약관→submit→성공 확인과 PIN 대기가 독립 상태를 가지면 책임이 명확하다.
- **판정: 최소 `CompletionCoordinator`.** adapter는 fresh DOM
  inspection/action만 담당하고 coordinator가 검증→claim→외부 제출→PIN
  →성공 관측과 timeout/stop 경쟁을 직렬화한다.

### C. PIN 자동 입력 대 사용자 인증 대기

- 자동 입력: 수동 실행 완주 목표에 부합하지만 secret 전달·키패드·실패 정책이 필요하다.
- 사용자 입력: secret 공격면이 작지만 무인 완주는 아니다.
- 실측 단계에서는 사용자 입력만 사용했다.
- **판정: 수동 실행에 한해 Side Panel 일회성 PIN 자동 입력을 지원하고,
  구조 불일치·실패 시 무재시도 인계한다.** PIN이 없으면 유료 제출 전에
  인계해 사용자가 직접 진행할 수 있다.

### D. Scheduled job

- **판정: 0원만 조건부 무인 완주, 유료는 무인 완주 미지원.**
- scheduled job에는 일회성 PIN을 저장하거나 나중에 주입하지 않는다.
- 유료 폼은 외부 제출 전에 인계한다.

PIN을 영속하지 않는다는 확정 요구와 MV3 Service Worker 수명 때문에
유료 scheduled job의 무인 완주는 안전하게 복구할 수 없다.

### E. 상태 수

- 기존 `ADVANCING_RESERVATION` 안에서 완료까지 처리
- `COMPLETING_RESERVATION` 하나만 추가
- 폼 입력·인증 대기·제출 확인을 여러 상태로 분리

- **판정: `COMPLETING_RESERVATION` 하나만 추가한다.** 세부 단계는
  coordinator 내부 phase와 telemetry event로 유지한다.

## 9. 구현 범위

- 예약 폼 inspection/action
- completion coordinator
- 완주 opt-in 설정
- PIN과 설정을 분리한 일회성 authorization
- `ADVANCING_RESERVATION → COMPLETING_RESERVATION → COMPLETED` 경로
- 폼 도착 즉시 handoff 조건 분기
- 중복 방지 submit claim과 성공 확인 telemetry
- 저장 설정 normalize/migration
- Side Panel password 입력과 비영속성
- 수동 실행과 0원/유료 scheduled job 차등 정책
- success URL을 현재 `leftReservationFlow()`로 오판하지 않는 navigation 처리
- fixture, 상태, secret 유출과 중복 제출 테스트

same-origin·same-document custom keypad가 확인됐으므로 새 host permission,
외부 결제 adapter와 iframe runtime은 추가하지 않는다.

## 10. 비범위

- 자동 로그인
- CAPTCHA·대기열 우회
- CatchPay 등록
- 일반결제
- 선택·마케팅 약관 동의
- 추가 상품 수량 변경
- 설정과 다른 예약 대체
- 알 수 없는 버튼 추측 클릭
- 예약 자동 취소
- raw 예약번호 수집
- 사용자 승인 없는 허용 범위 확대
- 증거 없는 외부 결제 도메인 일반화

## 11. 분석 완료 gate

분석 확정 시점의 gate:

- [x] 0원 CatchPay 예약 폼 구조
- [x] 유료 CatchPay 예약 폼 구조
- [x] CatchPay 등록·선택 판정 근거
- [x] 필수 입력·필수/선택 약관 식별 근거
- [x] 금액·날짜·시간·인원 재검증 근거
- [x] PIN origin·iframe·input/keypad 구조
- [x] 사용자 PIN 입력 후 재개 가능성
- [x] 비로그인 gate 구조와 최종 제출 0회
- [x] submit dispatch와 성공 후조건 구분
- [x] 개인정보가 제거된 `site-behavior.md` 기록과 evidence
- [x] 구현 범위·비범위 판정

남은 미실측 항목은 §5의 fail-closed 계약으로 처리할 수 있어 설계를
차단하지 않는다. 이 문서 확정은 구현 승인이 아니다.
