# 단조 서버 시계 분석

## 현재 구조

- Content Script의 기본 시계는 `Date.now()`다.
- 서버 동기화는 HTTP `Date` 표본으로 `server - local` 오프셋을 계산한다.
- 실행 중 서버 시각은 매번 `Date.now() + offset`으로 계산한다.

## 문제

동기화 뒤 Windows 시계가 NTP·사용자 조작으로 변경되면 서버 추정 시각과 예약 스케줄도 같은 폭으로 이동한다. 네트워크·DOM 지연은 별도 문제지만, 실행 중 wall clock 점프는 제거할 수 있는 오차 요인이다.

## 제약

- `openAtMs`와 로그는 epoch ms를 유지해야 한다.
- `performance.now()`는 epoch이 아니므로 직접 비교할 수 없다.
- 페이지 재로딩을 넘는 앵커 복구는 필요 없다. 새 Content Script 실행은 서버 시계를 다시 측정한다.
- 정밀 토글 루프에 서버 요청, storage, 메시지 전송을 추가하지 않는다.
