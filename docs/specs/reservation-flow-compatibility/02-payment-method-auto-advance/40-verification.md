# 02 결제 방식 자동 진행 검증

상태: 완료

## 자동 검증

- TDD red: 설정 필드·UI·판별·행동이 없는 상태에서 관련 테스트 8건 실패를 확인했다.
- 대상 테스트: 70/70 통과.
- 전체 게이트: 최종 fixture·오케스트레이터 보강 후 272/272 통과. typecheck, dist validation, independence validation도 통과했다.
- Side Panel 실 DOM에서 상위 설정 on/off/on 전환 시 결제 하위 체크값이 유지되고 disabled 상태만 함께 바뀌는 것을 확인했다.

## 실제 비드라이런 검증

2026-07-14 비스트로 꼬꼬뜨에서 다음 설정으로 실제 예약 폼 도착을 검증했다.

- `runId`: `run-1f1179a2-1487-472e-bf28-d1ac15b23ce6`
- 예약: 2026-07-31, 2명, 18:00
- `dryRun=false`, `paymentMethodAutoAdvance=true`
- 최종 상태: `HANDED_OFF`
- 상세 추적: 34 events, dropped 0
- 실제 순서: 홀 선택 → 테이블 타입 확인 → 추가 상품 무선택 → 예약금 안내 확인 → 폼 안내 닫기 → 예약 폼 인계
- 최종 URL: `/ct/reservation/form?isDepositFree=1&openRegisterCard=0`
- 폼 표시: `07월 31일 (금) · 오후 6시 · 2명 · 홀`, `예약금 0원 + 자동결제`

약관, 결제 승인, `자동결제로 예약하기` 버튼은 클릭하지 않았다.

이번 실런에서는 `payment_method_notice` 단계가 상세 추적에 직접 나타나지 않았다. 해당 신형 인터스티셜은 측정 화면 기반 fixture로 검증했으며, 실제 관측 결과와 fixture 검증 결과를 구분한다.

## 정책 UX 단축 패치 검증

- `zero_only`에서 선택된 유료 방식 진행 금지
- `selected_allowed`에서만 선택된 활성 방식 진행
- `20,000원`을 0원 방식으로 오인하지 않음
- 구버전 저장 정책을 `selected_allowed`로 복원
- 관련 targeted test 73/73 통과

- 전체 게이트: 275/275 통과. typecheck, dist validation, MAIN/ISOLATED independence, `git diff --check`도 통과했다.
