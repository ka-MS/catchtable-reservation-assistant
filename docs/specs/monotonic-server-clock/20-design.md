# 단조 서버 시계 설계

## 앵커 모델

동기화 완료 시 다음 두 값을 저장한다.

```text
serverEpochAnchor = wallNow + measuredOffset
monotonicAnchor   = performance.now
```

이후 서버 현재 시각은 다음처럼 계산한다.

```text
serverNow = serverEpochAnchor + (performance.now - monotonicAnchor)
```

오픈 직전 재동기화 성공 시 두 앵커를 원자적으로 교체한다. 재동기화 실패 시 기존 앵커를 유지한다.

## 시계 역할

- wall clock: 설정 검증과 로컬 로그 `at`
- monotonic server clock: wait, toggle plan, deadline, `serverAt`, 오픈 대비 지연
- monotonic latency clock: 서버 HEAD 요청 RTT

## 변경 경계

- `shared/monotonic-clock.ts` 추가
- Content Script에 `performance.now()` 시계 주입
- Clock sync RTT와 Orchestrator 서버 시계 교체
- DOM Adapter, 토글 계획, 슬롯 선택, Background 변경 없음

## Side Panel

- Content Script와 앵커 인스턴스는 공유하지 않는다.
- 최신 `clockOffsetMs`가 생기거나 변경될 때 패널의 `Date.now() + offset`을 공유 단조 시계에 앵커링한다.
- 카운트다운 렌더링은 앵커 이후 `performance.now()` 경과 시간만 사용한다.
