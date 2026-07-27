# CatchPay 예약 완주 적대적 리뷰

**상태:** 완료
**검토자:** Codex
**범위:** Task 3~6 diff와 기존 durable claim·authorization 경계

## 1. 판정

미해결 critical/high 결함은 없다. 아래 결함은 모두 실패 테스트를 먼저
고정하고 최소 수정했다. 최신 유료 Chrome E2E와 terminal·storage·
diagnostic 대조도 `40-verification.md` 기준으로 통과했다.

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
| PIN 제목·container 변형 | live PIN surface가 상단·본문 exact heading 2개를 렌더하고 접근성 dialog 경계를 노출하지 않아 heading·dialog matcher가 surface를 놓침 | heading/container 대신 top-level 문서의 유일한 0~9·전체삭제·내부 submit control 집합을 판정; 중복·누락 keypad 거부 회귀 |
| PIN modal 아래 과잉 stale 판정 | modal이 바깥 form control의 visibility를 바꾸므로 전체 ready fingerprint 재검증이 정상 PIN 입력도 거부 | PIN 전후에는 매장·예약 요약·현재 금액·CatchPay 선택만 비교하고, modal 접근성 은닉만 허용; anchor 부재·복수·값 변경은 계속 거부 |
| PIN digit 동기 burst | live keypad가 첫 digit만 반영했는데 네 click을 20ms 안에 보내 내부 submit 비활성으로 인계 | digit마다 fresh keypad·stable context 재검증 후 100ms settle, 네 번째 뒤 enabled 확인; 지연 반영 회귀 |
| digit settle 중 stop | 첫 digit 뒤 stop인데 나머지 PIN과 내부 submit이 계속될 위험 | settle이 false면 즉시 결과불명 인계, 추가 digit·pin claim·내부 submit 0회 회귀 |
| PIN 접근성 격리 | 화면에 PIN keypad가 즉시 렌더돼도 조상 `aria-hidden`/`inert` 때문에 matcher와 diagnostic이 모두 처리 overlay만 봄 | PIN identity와 credential redaction에만 rendered 판정 사용; HTML/CSS hidden과 중복·불완전 keypad는 계속 거부. live outer→PIN 127ms 통과 |
| 이전 PIN 재사용 | recovery·scheduled·다른 실행으로 authorization이 복사될 위험 | initial manual `START`에만 전달, Side Panel 즉시 비움, Content terminal cleanup 선폐기, storage key 부재 회귀 |
| stop·dispatch 경쟁 | outer 뒤 stop을 일반 취소 완료로 오판하거나 pin을 계속 허용할 위험 | pre-claim stop은 거절, outer 뒤 stop marker는 pin claim 거절, acknowledged claim은 결과 불명 정책 유지 |

## 3. 의도적으로 남긴 경계

- 미실측 CatchPay 미등록 전용 화면 문구·selector는 추측하지 않는다.
- 잘못된 PIN, 사용자가 닫은 PIN 화면과 사이트 timeout은 자동 재입력하지
  않고 결과 불명 인계한다.
- full reload 뒤에는 URL만으로 `COMPLETED`를 만들거나 자동 재주입해
  결제를 재시도하지 않는다.
- 유료 scheduled job을 위한 PIN 저장소는 만들지 않는다.
- PIN 전용 rendered 판정은 접근성 격리된 live control을 읽기 위한
  예외다. 사이트가 시각적으로 중복된 두 keypad를 만들면 control-set
  유일성 때문에 안전 인계된다.

## 4. 최종 판정

- outer/PIN claim과 dispatch는 live에서 각각 한 번이었다.
- 내부 submit 뒤 path·정확한 완료 문구·방문예정 일치 전에는
  `COMPLETED`가 기록되지 않았다.
- 진단 63개 event는 seq가 연속이고 credential snapshot은 없었다.
- Chrome storage와 IndexedDB에는 raw PIN용 key가 없고 telemetry에는
  제공 여부 boolean만 남았다.
- 사용자가 실제 예약을 취소했다. 자동 취소 경로는 추가하지 않았다.
