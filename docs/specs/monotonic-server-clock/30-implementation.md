# 단조 서버 시계 구현

## 구현 결과

- `MonotonicEpochClock`이 서버 epoch와 monotonic 시각을 앵커링한다.
- Content Script는 wall clock과 `performance.now()`를 각각 주입한다.
- Orchestrator의 wait, deadline, toggle plan, `serverAt`은 단조 서버 시계를 사용한다.
- 초기 동기화와 성공한 최종 동기화에서만 앵커를 갱신한다.
- `finalClockSyncAt()`이 일반 설정의 최종 동기화를 오픈 5초 전에 고정하고 긴 사전 시작에서는 안전하게 앞당긴다.
- HTTP HEAD RTT는 wall clock 차이가 아니라 monotonic 경과 시간으로 계산한다.
- Side Panel은 동일 `MonotonicEpochClock` 클래스로 별도 표시 앵커를 만들고, 서버 측정값이 없을 때만 로컬 시각을 사용한다.
- 카운트다운 모델은 오프셋을 다시 더하지 않고 계산 완료된 현재 시각을 입력받는다.

정밀 루프의 시계 조회 비용은 `performance.now()` 한 번과 뺄셈·덧셈뿐이다. DOM Adapter와 토글 계획 함수는 변경하지 않았다.
