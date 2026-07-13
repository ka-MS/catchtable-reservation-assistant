# RT-06 예약금 안내 다음 버튼 설계

## 판별

`supportedInspection()`의 예약금 안내 조건에서 진행 증거를 `hasConfirm`에서 기존 `progress(hasNext || hasConfirm)`로 넓힌다. 제목과 `zeroDepositControlCount === 0` 조건은 유지한다.

exact 판별은 기존 `aria-label === 예약금 안내` 계약을 유지한다.

## 행동

`advanceDepositNotice()`가 같은 dialog 안의 `확인` 또는 `다음`만 찾는다. 공용 `clickProgress()`의 가시성·disabled 검사를 그대로 사용한다.

## 안전 경계

- inspection kind가 `deposit_notice`가 아니면 이 행동에 진입하지 않는다.
- 클릭 직전 kind와 fingerprint를 재검증한다.
- `이전`은 허용 목록에 넣지 않는다.
- unknown dialog의 일반 진행 버튼은 자동 클릭하지 않는다.
- 결제 수단, 약관, 최종 예약은 건드리지 않는다.
