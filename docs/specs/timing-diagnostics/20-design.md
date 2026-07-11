# 정밀 타이밍 로그·고급 설정 설계

## 이벤트 데이터

타이밍 이벤트는 다음 공통 필드를 사용한다.

```ts
{
  timingStage: string;
  timingServerAtMs: number;
  openDeltaMs: number;
  scheduledServerAtMs?: number;
  scheduleDriftMs?: number;
  togglePhase?: string;
}
```

- 핫 루프에서는 마지막 인접·목표 날짜 클릭의 예정·실제 시각을 메모리에만 보관한다.
- 슬롯 감지 이벤트 하나에 최종 인접 클릭, 목표 클릭, 슬롯 감지 시각을 함께 첨부해 로그 IPC가 정각 실행을 방해하지 않게 한다.
- 슬롯 감지·선택은 실제 관측 시각만 기록한다.
- Side Panel은 인접 클릭, 목표 클릭, 슬롯 감지를 각각 한 줄의 `서버 HH:mm:ss.SSS · 오픈 ±Nms · 계획 ±Nms` 형식으로 표시한다.

## 고급 설정

- 사전 시작: 오픈 전에 날짜 갱신 루프를 가동하는 여유 시간
- 토글 간격: 목표 날짜 재클릭 주기. 정밀 구간에서는 최대 150ms
- 시계 표본: 서버 시계 측정 횟수. 표본이 많을수록 측정 안정성이 높아짐

사전 시작은 `0~10000ms`, `50ms` 배수만 허용한다. 기존 100ms 배수 설정은 그대로 유효하다.
