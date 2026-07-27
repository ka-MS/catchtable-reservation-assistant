# CatchPay 예약 완주 검증

**상태:** 완료
**기준:** `ab5e825` 이후 Codex 단독 구현

## 1. 자동 검증

최신 구현과 적대적 리뷰 수정 뒤 다음 gate를 통과했다.

```text
npm run check
  typecheck: 통과
  node test: 518/518 통과
  dist validation: 통과
  MAIN/ISOLATED independence: 통과

git diff --check: 통과
```

자동 테스트가 직접 고정하는 핵심 계약:

- 매장·날짜·시간·인원·금액 또는 폼 shape가 바뀐 stale action은 0회
- CatchPay radio가 유일하게 선택되고 일반결제가 미선택일 때만 진행
- 등록 카드 안내 문구 부재만으로 거절하지 않음
- 필수 입력과 필수 약관만 처리하고 선택 약관 상태를 보존
- outer/PIN durable claim은 phase별 최대 한 번
- outer claim 뒤 결과 불명은 재제출하지 않음
- 성공 path·정확한 완료 문구·방문예정 항목이 모두 일치해야 `COMPLETED`
- opt-in off는 기존 예약 폼 인계 유지
- scheduled 유료 실행은 PIN이 없어 outer submit 전에 인계
- PIN은 config, logical/active run, event, trace, snapshot과 dist에 저장되지
  않음
- 예약 폼 failure snapshot은 남기되 HTML fragment와 카드 식별정보는
  남기지 않음
- PIN surface snapshot은 controls·text·keypad 순서·active element를
  남기지 않음

## 2. 통제된 Chrome E2E

| 시나리오 | 결과 | 증거 |
|---|---|---|
| `민석 + woo_blanc_` 0원 | 실예약 생성 확인 | outer 1회, PIN 없음, 성공 path·문구·방문예정 일치. 초기 matcher의 heading 한정으로 terminal은 결과 불명 인계했으나 재제출하지 않았고, 실제 성공 DOM을 분석에 선반영한 뒤 fixture 회귀를 추가했다. 사용자가 취소 완료 |
| `ms + woo_blanc_` 비로그인 | 안전 인계 | `login_required`, outer claim/dispatch 0회, `COMPLETING_RESERVATION` failure snapshot `ss-e06b7fd6`, 예약 생성 없음 |
| `민석 + pizzeriamarket` 유료 | 실예약 생성과 `COMPLETED` 확인 | 20,000원, CatchPay selected, 일반결제 unselected, 필수 약관 3개. outer/PIN claim·dispatch 각 1회. same-origin·same-document keypad를 관측하고 성공 path·문구·방문예정 일치 뒤에만 terminal `COMPLETED`. 사용자가 취소 완료 |

최종 유료 실행의 completion phase 시각은 다음과 같다.

- `form_ready` 12:05:18.081
- `payment_authorization` 12:05:18.368
- outer claim/dispatch 12:05:18.370/18.380
- PIN surface 12:05:18.507
- pin claim/dispatch 12:05:18.984/18.992
- success observed와 terminal `COMPLETED` 12:05:21.558

outer dispatch에서 PIN surface까지 127ms, surface에서 pin dispatch까지
485ms, pin dispatch에서 success까지 2.566초였다. PIN surface facts는
same-origin·same-document, iframe/password input 0, keypad button
10개였다.

## 3. terminal·storage·diagnostic 대조

성공 run의 진단 ZIP을 Side Panel에서 내보내 다음을 확인했다.

- manifest event count 63, events `seq=1..63` 연속, snapshot 0
- completion phase는 `paymentPinProvided=true`와 PIN UI 구조·성공
  boolean만 보존
- manifest/environment에는 secret-like key와 네 자리 문자열 값 없음
- CSV의 secret-like column은 `paymentPinProvided`와
  `passwordInputCount`뿐이며 raw PIN column 없음
- 세 Chrome 프로필의 extension `chrome.storage.local`과 IndexedDB
  LevelDB에 `catchPayPin` key 없음
- 성공 telemetry가 있는 민석 프로필 IndexedDB에는 허용된
  `paymentPinProvided` boolean만 존재
- Side Panel PIN input은 실행 시작 때 즉시 비우는 자동 회귀를 통과

예약 취소는 자동화하지 않았다. 사용자가 성공 직후 직접 취소 완료를
확인했으며 환불의 금융기관 정산 상태는 별도로 판정하지 않았다.
