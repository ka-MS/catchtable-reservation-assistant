# 04 실제 예약 폼 E2E 설계

상태: 완료

## 성공 기준

1. 예약 설정과 실제 폼의 날짜·시간·인원이 일치한다.
2. 최종 URL이 `/ct/reservation/form`이다.
3. 실행 최종 상태는 `HANDED_OFF`다.
4. IndexedDB run/event 수, seq 연속성, dropped count를 확인한다.
5. 약관, 결제 승인, 최종 예약 명령은 실행하지 않는다.

실패 런은 DOM 변형을 찾는 증거로 사용하되 성공 판정에는 포함하지 않는다.
