# 02 결제 방식 자동 진행 구현

상태: 완료

## 설정과 저장 호환

- `ReservationConfig.paymentMethodAutoAdvance`를 추가했다.
- `paymentMethodPolicy`에 `zero_only`와 `selected_allowed`를 추가했다.
- 새 설정의 기본값은 `true`다.
- 새 정책 기본값과 구버전 복원값은 기존 동작과 같은 `selected_allowed`다.
- draft, 최근 설정, 즐겨찾기, 예약 작업에서 구버전 항목을 정규화한다.
- Side Panel의 `후속 선택 자동 진행` 아래에 `결제 방식까지 자동 진행` 체크박스를 배치했다.
- 자동 진행이 켜진 동안에만 결제 정책 radio를 표시한다.
- 상위 설정이 꺼지면 테이블·메뉴·결제 하위 입력을 모두 비활성화하고 값은 보존한다.

## Adapter

- 결제 자동 진행이 꺼진 경우 `deposit`과 `payment_method_notice`에서 인계한다.
- 활성 예약금 0원 control을 우선하며, 없으면 이미 선택된 활성 방식만 진행한다.
- `zero_only`에서는 0원 방식이 없으면 진행하지 않고 인계한다.
- 선택되지 않은 유료 방식을 임의로 선택하지 않는다.
- `예약금 0원`, `자동결제`, 정확한 CTA `이 방식으로 예약`을 모두 확인한 경우에만 `payment_method_notice`로 판별한다.
- 예약 폼 도착 뒤에는 기존 안전 경계를 유지해 약관·결제 승인·최종 예약을 수행하지 않는다.

## 테스트 자산

- `tests/fixtures/post-slot-payment-method-notice.html`
- 저장 데이터 기본값·구버전 복원 회귀 테스트
- 결제 방식 on/off와 안전 선택 정책 Adapter 테스트
- 결제 off에서도 선행 후속 단계가 진행되는 Orchestrator 테스트

## 2026-07-14 단축 패치

기존 고정 fallback을 사용자 선택 정책으로 노출했다. 이 과정에서 `20,000원`이 문자열 부분 일치로 `0원`으로 오인되던 문제를 발견해 금액 경계 판별로 수정했다. 슬롯 탐색과 availability hot path는 변경하지 않았다.
