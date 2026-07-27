# CatchPay 예약 완주 검증

**상태:** 자동 검증 완료, 최신 dist 유료 Chrome E2E 진행
**기준:** `ab5e825` 이후 Codex 단독 구현

## 1. 자동 검증

최신 구현과 적대적 리뷰 수정 뒤 다음 gate를 통과했다.

```text
npm run check
  typecheck: 통과
  node test: 511/511 통과
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
| `민석 + pizzeriamarket` 유료 | 최신 dist 실행 준비 | Side Panel 실제 실행, 완주 opt-in, 상한 500,000원, 일회성 password input까지 확인. 사용자의 직접 PIN 입력 뒤 실행·telemetry/storage 대조가 남음 |

과거 실측에서는 더피제리아마켓 20,000원 CatchPay의 same-origin,
same-document custom keypad와 실제 결제 성공을 확인했고 사용자가 예약을
취소했다. 최신 구현 E2E는 Side Panel의 일회성 PIN 전달·자동 keypad
입력·terminal 대조를 함께 검증하는 별도 gate다.

## 3. 최신 유료 E2E 완료 조건

- 허용 매장·기간·2명·11:00~21:00·500,000원 이하 재검증
- Side Panel password input에서만 PIN을 받아 시작 직후 input 비움
- outer와 PIN 내부 submit 각각 1회 이하
- 성공 화면 세 조건과 terminal `COMPLETED` 일치
- run/event/snapshot의 seq·eventCount·dropped 상태 대조
- `chrome.storage.local`과 IndexedDB에 `catchPayPin` key가 없음
- 예약 취소와 환불 확인은 사용자 결과로만 기록
