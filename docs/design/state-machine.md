# 예약 실행 상태 머신

## 1. 상태

| 상태 | 의미 | 종료 상태 |
|---|---|---|
| `IDLE` | 실행 없음 | 아니오 |
| `CONFIGURED` | 검증 가능한 설정 생성 | 아니오 |
| `VALIDATING` | 값·탭·페이지 조건 검증 | 아니오 |
| `SYNCING_CLOCK` | 서버 시계 표본 수집 | 아니오 |
| `PREPARING_PAGE` | 목표 날짜와 인접 가용 날짜 확인 | 아니오 |
| `WAITING_FOR_OPEN` | 서버 기준 사전 토글 시각까지 대기 | 아니오 |
| `REFRESHING_SLOTS` | 날짜 토글과 슬롯 탐색 | 아니오 |
| `SLOT_DETECTED` | 선택할 논리 슬롯 확정 | 아니오 |
| `SLOT_SELECTED` | 실제 슬롯 click 호출 완료 | 아니오 |
| `DRY_RUN_COMPLETED` | 클릭 없이 후보 감지 완료 | 예 |
| `HANDED_OFF` | 자동화 종료 후 사용자 조작 필요 | 예 |
| `COMPLETED` | 향후 실측된 예약 완료 상태용, MVP 미사용 | 예 |
| `STOPPED` | 사용자가 중지 | 예 |
| `TIMED_OUT` | 감시 종료 시각 도달 | 예 |
| `FAILED` | 복구 불가능한 내부 오류 | 예 |

무기한 pause 상태는 존재하지 않는다.

## 2. 정상 전이

```text
IDLE
  -> CONFIGURED
  -> VALIDATING
  -> SYNCING_CLOCK
  -> PREPARING_PAGE
  -> WAITING_FOR_OPEN
  -> REFRESHING_SLOTS
  -> SLOT_DETECTED
       -> DRY_RUN_COMPLETED  (dry-run)
       -> SLOT_SELECTED
       -> HANDED_OFF         (실제 클릭 직후)
```

## 3. 종료 전이

- 모든 비종료 상태 + 사용자 중지 -> `STOPPED`
- `WAITING_FOR_OPEN`, `REFRESHING_SLOTS` + 종료 시각 도달 -> `TIMED_OUT`
- 페이지 사전 준비가 필요한 검증 실패 -> `HANDED_OFF`
- 예외, 잘못된 전이, 지원하지 않는 URL -> `FAILED`
- `SLOT_SELECTED` -> `HANDED_OFF` 외 다른 전이는 허용하지 않는다.
- `SLOT_DETECTED`에서 클릭 직전 슬롯이 사라지면 `REFRESHING_SLOTS`로 돌아갈 수 있다.

## 4. 전이 기록

각 전이는 다음 `StateTransition`을 이벤트로 남긴다.

```ts
interface StateTransition {
  from: RunState;
  to: RunState;
  enteredAt: number;
  exitedAt: number | null;
  reason: string;
  error?: string;
  userStopped: boolean;
  dryRun: boolean;
}
```

상태 객체는 이전 상태를 수정하지 않고 새 전이 레코드를 추가한다.

## 5. 불변식

- 종료 상태에 진입한 런은 다시 전이하지 않는다.
- 한 번의 런에서 `SLOT_SELECTED`는 최대 1회다.
- dry-run 런은 `SLOT_SELECTED`에 진입할 수 없다.
- 서버 기준 현재 시각이 `stopAtMs` 이상이면 DOM을 클릭할 수 없다.
- 새 시작은 새 runId와 빈 논리 클릭 기록을 가진다.
