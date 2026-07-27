# CatchPay 예약 완주 적대적 리뷰

**상태:** 완료
**검토자:** Codex
**범위:** Task 3~6 diff와 기존 durable claim·authorization 경계

## 1. 판정

미해결 critical/high 결함은 없다. 아래 결함은 모두 실패 테스트를 먼저
고정하고 최소 수정했다. 최신 유료 Chrome E2E는 구현 결함이 아니라
`40-verification.md`의 잔여 검증 gate다.

## 2. 발견·수정

| 공격 | 발견 | 수정·회귀 근거 |
|---|---|---|
| stale 예약 intent | ready 뒤 매장·날짜·시간·인원이 바뀌어도 boolean match만 같으면 action 가능 | 실제 header/요약 DOM shape를 fingerprint에 포함하고 네 값 각각 변경 시 action 0회 |
| 중복 금액 anchor | 상단·하단 요약 때문에 단일 label 가정이 false negative | anchor별 현재값이 하나이고 모든 값이 같을 때만 수용; 불일치·복수·parse 실패 인계 |
| CatchPay 오판 | 등록 안내 copy를 hard gate로 삼으면 정상 선택도 거절; 일반결제 radio가 모호하면 반대편 추론 위험 | copy gate 제거, 유일한 일반결제 반대편만 CatchPay 후보, 모호하면 인계 |
| claim replay/충돌 | ACK 재전송을 새 클릭 권한으로 오해하거나 outer와 pin fingerprint가 달라질 위험 | durable claim replay는 `dispatchGranted=false`, phase 순서·동일 fingerprint·stop marker 회귀 |
| claim 뒤 예외 | click handler 예외를 `FAILED` 또는 재시도로 처리할 위험 | static 결과 불명 `HANDED_OFF`, `completionClaimed=true`, 자동 재제출 없음 |
| 성공 오판 | URL 또는 메시지 하나만으로 `COMPLETED` 가능 | path·정확한 최소 요소 문구·동일 예약 방문예정 목록을 모두 요구 |
| PIN 진단 유출 | keypad heading/order/active element와 예약 폼 카드 별칭이 snapshot에 남을 가능성 | PIN surface 전체 fail-closed redaction, 예약 폼 HTML fragment 생략, payment radio text/aria/selector 제거 |
| 비지원 PIN secret 수명 | 구조가 바뀐 PIN surface에서 15초 대기하며 PIN 참조 유지 | 즉시 참조 폐기·결과 불명 인계, digit/pin claim/sleep 0회 |
| 이전 PIN 재사용 | recovery·scheduled·다른 실행으로 authorization이 복사될 위험 | initial manual `START`에만 전달, Side Panel 즉시 비움, Content terminal cleanup 선폐기, storage key 부재 회귀 |
| stop·dispatch 경쟁 | outer 뒤 stop을 일반 취소 완료로 오판하거나 pin을 계속 허용할 위험 | pre-claim stop은 거절, outer 뒤 stop marker는 pin claim 거절, acknowledged claim은 결과 불명 정책 유지 |

## 3. 의도적으로 남긴 경계

- 미실측 CatchPay 미등록 전용 화면 문구·selector는 추측하지 않는다.
- 잘못된 PIN, 사용자가 닫은 PIN 화면과 사이트 timeout은 자동 재입력하지
  않고 결과 불명 인계한다.
- full reload 뒤에는 URL만으로 `COMPLETED`를 만들거나 자동 재주입해
  결제를 재시도하지 않는다.
- 유료 scheduled job을 위한 PIN 저장소는 만들지 않는다.
