# CatchPay 예약 완주

**상태:** 구현·자동 검증·자체 적대적 리뷰 완료, 최종 유료 E2E 진행
**착수일:** 2026-07-24
**현재 gate:** `40-verification.md` 최신 dist 유료 E2E
**구현 승인:** 2026-07-24 사용자 명시 승인

## 목표

Catchtable 예약 폼에서 실측된 필수 입력과 필수 약관만 처리하고, 이미 등록·선택된 CatchPay를 사용해 예약을 제출한 뒤 실측된 성공 후조건을 확인한 경우에만 `COMPLETED`로 종료한다.

로그인, 유일하게 판정된 CatchPay 선택 상태, 일반결제 미선택,
매장·날짜·시간·인원, 결제금액 상한과 폼 입력을 최종 제출 직전에 다시
검증한다. 등록 카드 안내 문구는 표시 문구이므로 hard gate로 사용하지
않는다. 알 수 없는 화면, 일반결제, 선택 약관, 설정 불일치와 성공
미확인은 자동 진행하지 않는다.

## 개발 흐름

```text
HANDOFF·backlog 확인
→ 00-index + DRAFT 10-analysis
→ Orca orchestration Claude 실측
→ 10-analysis 확정
→ 20-design
→ 사용자 승인 gate
→ 30-implementation
→ 40-verification
→ 50-adversarial-review 및 수정
→ worklog·HANDOFF
```

`20-design.md` 보고 뒤에는 사용자의 새 메시지로 명시적 승인을 받기 전까지 구현·테스트·상태 머신·Side Panel을 변경하지 않는다.

새 DOM·URL·전이 사실이 나오면 [실사이트 실측 기준](../../analysis/site-behavior.md)과 `10-analysis.md`를 먼저 갱신한다. 그 뒤 영향을 받는 설계·테스트·코드를 변경한다.

## 문서

| 문서 | 상태 | 역할 |
|---|---|---|
| [10-analysis.md](10-analysis.md) | 확정 | 사용자 관측, 기존 코드, Claude 실측, 불확실성과 범위 |
| [20-design.md](20-design.md) | 승인됨 | 책임, 상태, 일회성 secret, 안전·테스트 계약 |
| [30-implementation.md](30-implementation.md) | 완료 | 실패 테스트 우선 구현 순서와 결과 |
| [40-verification.md](40-verification.md) | 진행 | 자동 검증과 통제된 Chrome E2E |
| [50-adversarial-review.md](50-adversarial-review.md) | 완료 | 중복 결제, secret 유출, 오성공 판정 공격 |

## 기준 문서

충돌 시 우선순위는 다음과 같다.

1. 실사이트 실측 결과
2. [제품 요구사항](../product-requirements.md)
3. [자동화 경계](../automation-boundary.md)
4. [상태 머신](../../design/state-machine.md)
5. [아키텍처](../../design/architecture.md)
6. [테스트 전략](../../testing/test-strategy.md)
7. 구현 계획
8. 기존 코드와 폐기 문서

현재 제품 요구사항·상태 머신·테스트 전략에는 과거 “예약 폼 인계” 경계가 남아 있다. 자동화 경계와 README는 완주 목표로 먼저 바뀌었으며, 이 패키지가 실측과 설계로 충돌을 해소한다.

## 통제된 실측 범위

| 시나리오 | Chrome 프로필 | 매장 | 목적 |
|---|---|---|---|
| 0원 CatchPay | `민석` 로그인 | `woo_blanc_` | PIN 없는 제출과 성공 후조건 |
| 유료 CatchPay | `민석` 로그인 | `pizzeriamarket` | 내부 PIN UI와 결제 완료 경로 |
| 비로그인 대조 | `ms` 비로그인 | 위 허용 매장 중 하나 | 로그인 필요 탐지와 무동작 인계 |

공통 계약:

- 예약 기간: `2026-08-10`~`2026-08-31`
- 인원: 2명
- 시간: 11:00~21:00
- 후보: 가장 빠른 예약 가능 날짜의 가장 빠른 허용 시간
- 최대 결제금액: 500,000원
- 범위 안의 실결제 허용
- 한 실행의 최종 제출 dispatch 최대 1회
- 성공 여부가 불확실하면 재제출 금지
- 예약 취소는 사용자가 휴대폰 알림 확인 후 직접 수행

## Secret 경계

CatchPay PIN raw 값은 spec, Git, orchestration task·message, Console, telemetry, IndexedDB, diagnostic ZIP과 `chrome.storage`에 기록하지 않는다. `ReservationConfig`, draft, history, favorites와 scheduled job에도 포함하지 않는다.

구현 후에는 Side Panel의 `type="password"` 입력에서 영속 설정과
분리된 일회성 실행 파라미터로만 전달하고 실행 종료 시 폐기한다.

## 단계 상태

- HANDOFF blocking backlog: `예약 완주 구현` 1건. 구현과 자동 검증은
  완료됐으며 최신 dist 유료 E2E·최종 문서·커밋을 마치면 해제한다.
- 기존 CatchPay 완주 spec: 없음
- 관련 선행 패키지: `reservation-flow-compatibility/02-payment-method-auto-advance/`
- 현재 구현: Task 1~6과 자체 적대적 리뷰 수정 완료. stale intent,
  중복 제출, success 오판, PIN 비영속성과 진단 redaction을 회귀
  테스트로 고정했다.
- Orca 실측: Claude Opus 4.8 worker 1명으로 C(비로그인)→A(0원)→B(유료) 순차 완료
- 실예약: 우블랑·더피제리아마켓 모두 사용자가 직접 취소 완료, 환불 상태는 별도 미확인
- 다음 행동: 최신 dist에서 Side Panel 일회성 PIN을 사용한
  더피제리아마켓 유료 E2E와 terminal/storage 대조를 완료한다.
