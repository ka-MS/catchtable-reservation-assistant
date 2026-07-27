# CatchPay 예약 완주 실측 인벤토리 (2026-07-24)

CatchPay 예약 완주(`docs/specs/catchpay-reservation-completion/`) 통제 실측 세션의 개인정보 제거 증거 인벤토리다. DOM/URL/Network 사실 원문은 [site-behavior.md §12](../../../../analysis/site-behavior.md#12-catchpay-예약-완주-실측-2026-07-24)에 기록한다. 이 문서는 무엇을 어디까지 관측했는지의 목록과 상태만 담는다.

- 도구: Chrome DevTools MCP (`--auto-connect`, 사용자 Chrome 프로필).
- 관측일: 2026-07-24 (KST).
- 안전: 시나리오 C(비로그인)는 예약 폼 로그인 게이트에서 **최종 제출 0회**로 종료. A(0원)·B(유료)는 통제 범위 안에서 각각 **외부 최종 제출(`자동결제로 예약하기`) 1회** 수행(실예약 생성); B의 CatchPay **PIN 입력과 내부 `결제하기`는 사용자가 브라우저에서 직접** 수행. 자동 로그인·회원가입 0회. raw PIN·카드 식별·Cookie/token·개인정보·raw 예약번호·URL query secret 미기록. Network는 endpoint/method/status만 정제.
- 스크린샷: Windows측 MCP가 WSL 저장 경로 밖으로 해석해 바이너리 저장 불가. 구조 증거는 접근성 스냅샷 + `evaluate_script`(개인정보 없는 boolean/구조값)로 대체 수집했고, 사실은 site-behavior.md §12에 텍스트로 정제해 남겼다.

## 세션 요약

| 시나리오 | 매장 | 프로필 상태 | 도달 지점 | 결과 |
|---|---|---|---|---|
| A (0원 CatchPay) | `woo_blanc_`(우블랑) | 민석 **로그인** | 예약 완료 `/ct/mydining/my/planned` | **완료** — 등록 CatchPay checked·일반결제 disabled·0원 확인, **PIN 없이 제출 성공**, 성공 후조건 관측(실예약 생성) |
| C (비로그인 대조) | `woo_blanc_`(우블랑) | 비로그인 | 예약 폼 로그인/회원가입 게이트 | **관측 완료** — 게이트 구조 기록, 자동 로그인·제출 0회 |
| B (유료 CatchPay) | `pizzeriamarket`(더피제리아마켓 하남미사) | 민석 **로그인** | 예약 완료 `/ct/mydining/my/planned` | **완료** — 유료 20,000원, 제출 후 **CatchPay PIN 화면(동일 오리진·무 iframe·1표본 비순차 보안 키패드)**, 사용자가 직접 PIN 입력→결제, 성공 후조건 관측(실결제·실예약) |

핵심 경과: 최초 연결 프로필이 예약 기준 비로그인이라 시나리오 A 흐름이 그대로 시나리오 C 로그인 게이트 증거가 됐다(→ 기록). 이후 사용자가 민석으로 로그인해 시나리오 A를 재실행, 로그인 예약 폼·등록 CatchPay 판정·0원(100원 검증 후 취소)·필수 약관 10개를 확인하고 최종 `자동결제로 예약하기`를 통제 범위에서 1회 제출 → **PIN 화면 없이** 완료(실예약 1건). 시나리오 B는 `pizzeriamarket` 8월 11(화, 8/10 월 휴무)·오전 11:00·2명·총 20,000원으로 진행, 최종 제출 후 CatchPay PIN 화면을 구조만 관측하고 사용자가 브라우저에서 직접 PIN 입력·결제 → 완료(실결제 1건). 취소 상태: **우블랑·더피제리아마켓 두 예약 모두 사용자가 직접 취소해 확인 완료**(환불 완료 여부는 별도 미확인).

## 관측 경로 — 초기 비로그인(시나리오 C) 경로 (우블랑, 2026-07-24)

아래는 **최초 비로그인(C) 통과** 경로다. 이후 사용자가 민석으로 로그인해 같은 매장으로 시나리오 A를 재실행했고(로그인 폼·CatchPay 판정·PIN 없는 최종 제출·성공 후조건은 site-behavior §§12.4-12.5), 유료 시나리오 B는 `pizzeriamarket`에서 진행했다.

1. `/ct/shop/woo_blanc_` 매장 상세(로그인 게이트 미노출, `예약금 0원`·`자동결제` 편의시설 뱃지). 홍보 인터스티셜을 `다음에 볼게요`로만 닫음(`7일간 보지 않기` 미클릭).
2. dock `예약하기` → SPA 달력 모달(`?date=YYMMDD`). 인원 기본 `2명` checked. `Next page`로 2026년 8월 이동.
3. 8월 10(월) 선택 → 슬롯: 오전 9:30, 오후 12:00~2:00, 오후 5:30~9:00. 시간창 11:00~21:00의 최단 슬롯 = 오후 12:00 선택(오전 9:30은 11:00 미만).
4. `메뉴 선택` dialog(필수 메인 메뉴, 1인당 예약금). 첫 선택 가능 메뉴 `평일 런치 테이스팅 코스` 수량 2(=인원) → 총 예약금 80,000원, `다음`.
5. `결제 방식 선택` dialog. `예약금 0원 + 자동결제`(CatchPay) 기본 checked. 프로모션 오버레이 `닫기` 후 `다음`.
6. `/ct/reservation/form?isDepositFree=1` 예약 폼 — **비로그인/회원가입 게이트**. 결제금액 80,000원→0원, 최종 버튼 `자동결제로 예약하기`. **이 비로그인(C) 경로는 여기서 최종 제출 0회로 종료**(로그인 A 재실행은 별도).

## 수집한 안정 증거 (요약, 상세는 site-behavior.md §12)

- 필수 메뉴 dialog: `div[role="dialog"][aria-label="메뉴 선택"]`, `button[aria-label="<메뉴명> 수량 추가/감소"]`, `spinbutton[aria-label="<메뉴명> 수량"]`. 진행 버튼은 `다음` 또는 `확인` 변형.
- 중간 결제 방식 dialog(비로그인 경로): `div[role="dialog"][aria-modal="true"][aria-label="결제 방식 선택"]` 내부 `input[type="radio"][name="catch-pay-auto-payment"]`, 0원+자동결제가 기본 `:checked`.
- 비로그인 예약 폼 게이트: `h3` `회원가입하며 예약하기` + 이름/휴대폰/비밀번호 `textbox`(값 없음) + `가입하기` 버튼, `로그인` 문구. `[필수]` 회원가입 약관 5 + 매장 유의사항 7, `[선택]` 4.
- 로그인 예약 폼 CatchPay 판정: 결제 수단 `input[type="radio"][name="payment-type"]` — `캐치페이` 기본 `:checked`, `일반결제` `disabled`. 로그인 변형 필수 약관 = `[필수]` 10개(매장유의 7 + 결제 3: 취소수수료 정책/개인정보 제3자 와드/개인정보 제3자 캐치테이블페이), `[선택]` 없음. 필수 자유입력 3(알러지/VVIP룸/테이블).
- 방문 목적: `checkbox` 9개, `[필수]` 표기 없음(비필수 다중선택). 두 변형 공통.
- 금액: `80,000원(예약금/보증) → 0원(실결제 now)`. 안내 `100원 결제 후 즉시 취소`(카드 검증). 최종 버튼 `자동결제로 예약하기`.
- 성공 후조건(0원): 최종 클릭 1회 → **PIN 없이** 완료, URL이 `/ct/mydining/my/planned`로 전이(document reload vs SPA는 미측정), `자동결제로 예약을 완료했습니다` 문구, 방문예정 목록 등재(`우블랑 … 2026.08.10(월) 오후 12:00 2명`, D-17, 예약·자동결제). raw 예약번호 미노출.
- 유료 폼(pizzeriamarket): 슬롯 클릭 → `div[role="dialog"][aria-label="예약금 안내"]`(1인 10,000 × 2 = 20,000원, 확인=안내). 폼 URL `/ct/reservation/form?openRegisterCard=0`(isDepositFree 없음). 캐치페이 checked·일반결제 disabled, 총 결제 20,000원(실결제). [필수] 3개만(환불정책/개인정보 제3자 와드/개인정보 제3자 캐치테이블페이), [선택]·마케팅 0개 → `모두 동의`가 정확히 3개. 개인정보 제3자 2개는 개별 클릭/fill_form 미토글 → `모두 동의` 그룹 컨트롤로 체크.
- 유료 PIN UI: 제출 후 CatchPay PIN 화면. 최상위 **동일 오리진·동일 문서**(`app.catchtable.co.kr/ct/reservation/form`), **iframe 0개**. 일반 password input 없음(=커스텀 보안 키패드, 숫자 button 10개+전체삭제), 배열 **1표본 비순차(관측 순서 4,5,6,1,3,9,7,8,2,0; 다중 렌더 무작위성 미확인)**. `결제하기` 입력 전 disabled. 사용자가 직접 PIN 입력·결제 → 같은 문서에서 재개 → 성공.
- 성공 후조건(유료): URL이 `/ct/mydining/my/planned`로 전이(document reload vs SPA는 미측정), `자동결제로 예약을 완료했습니다`, 방문예정 등재(`더피제리아마켓 하남미사 … 2026.08.11(화) 오전 11:00 2명`, D-18, 예약·자동결제). 0원과 동일 표식 구조. raw 예약번호·PIN 미기록.
- Network(정제): `GET /api/v1/collections/count → 401`(비로그인 근거), 매장 API `/api/v3/init`·`/api/v4/shops/woo_blanc_`·`/api/display/v2/shops/woo_blanc_` (200). SPA 번들 `dining-booking-app`·`payment-app`·`shop-detail-app` manifest.
- 예약 폼 매장 표시명 anchor(2026-07-24 read-only 후속, 상세 site-behavior §12.8): 두 폼 변형(우블랑 0원, 더피제리아마켓 유료) 모두 매장명이 top-bar `<header>`(banner) 안 **단일 `<h1>`**(level 1, 접근성 이름=textContent, id/aria-label 없음)로 **정확히 1회**만 존재. 폼 본문 `main`·`예약 정보` 섹션에는 매장명 없음(예약 정보는 날짜/시간/인원만). `document.title`은 매장명 없는 일반 문자열. 안정 anchor = `header h1` textContent(generated class 비의존). 이 후속 실측은 read-only(최종 제출·PIN·결제·예약 생성 0).

## 도구·안전 메모

- auto mode classifier가 유료/결과적 action(메뉴 수량 추가, fill_form, 최종 제출)을 자동 차단함. 우회 없이 coordinator가 manual mode로 전환한 뒤 native fill_form/click을 일회성 permission으로 승인해 진행함.
- `fill_form` 일괄 체크 시 매장 유의사항 마지막 2개 `[필수]` checkbox가 간헐적으로 미토글 → 개별 click 보정 후 재검증했다.
- 최초 시도는 manual 승인 왕복 중 `예약 찜`(~7분) hold 만료로 제출 보류(재클릭 금지) 후 fresh 재실행으로 완료.
- 실예약 2건 생성됨(우블랑 0원, 더피제리아마켓 20,000원 실결제). 자동 취소하지 않음. 취소 상태: **두 건 모두 사용자가 직접 취소해 확인 완료**(환불 완료 여부는 별도 미확인).
- 유료 PIN 개인정보 제3자 [필수] 2개도 개별 클릭/fill_form로 미토글 → `모두 동의` 그룹 컨트롤로만 체크됨(과동의 없음: 그룹 = 정확히 3개 [필수], [선택] 0개 사전 확인).

## 미수집 / 다음 단계

- 완료 후조건의 전이 방식: URL 전이만 관측했고 document reload vs SPA navigation은 미측정.
- PIN 키패드 숫자 배열의 렌더 간 무작위성(다표본), 잘못된 PIN·취소·timeout 화면과 재시도 정책.
- 0원/유료 공통: 완료 화면 raw 예약번호 없이 reload 후 동일 결과 재판독 가능성.
