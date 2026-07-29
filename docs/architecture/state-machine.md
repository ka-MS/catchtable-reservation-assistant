# 예약 실행 상태 머신

## 상태

| 상태 | 의미 | 종료 |
|---|---|---|
| `IDLE` | 실행 없음 | 아니오 |
| `NAVIGATING` | 목표 매장 탭으로 이동 | 아니오 |
| `CONFIGURED` | 실행 설정과 attempt 생성 | 아니오 |
| `VALIDATING` | 설정·탭·페이지 조건 검증 | 아니오 |
| `SYNCING_CLOCK` | 서버 시계 표본 수집 | 아니오 |
| `ENTERING_RESERVATION` | 예약 CTA와 달력 준비 | 아니오 |
| `SELECTING_DATE` | 목표 월·날짜 선택 | 아니오 |
| `SELECTING_PERSON` | 정확한 예약 인원 선택 | 아니오 |
| `PREPARING_PAGE` | 목표 날짜와 인접 날짜 안전 검증 | 아니오 |
| `WAITING_FOR_OPEN` | 사전 토글 시각까지 대기 | 아니오 |
| `REFRESHING_SLOTS` | 날짜 토글과 슬롯 탐색 | 아니오 |
| `SLOT_DETECTED` | 논리 슬롯 후보 확정 | 아니오 |
| `SLOT_CLICK_DISPATCHED` | 슬롯 click 전달 | 아니오 |
| `SLOT_TRANSITION_CONFIRMED` | 알려진 후속 화면 확인 | 아니오 |
| `SLOT_SELECTED` | 과거 저장 로그 호환 상태 | 아니오 |
| `ADVANCING_RESERVATION` | 선택적 중간 단계와 예약 폼 처리 | 아니오 |
| `COMPLETING_RESERVATION` | 폼·금액·CatchPay 검증과 제출 | 아니오 |
| `DRY_RUN_COMPLETED` | 클릭 없이 후보 감지 완료 | 예 |
| `HANDED_OFF` | 자동화 중단, 사용자 확인 필요 | 예 |
| `COMPLETED` | 성공 후조건을 확인한 예약 확정 | 예 |
| `STOPPED` | 사용자 중지 | 예 |
| `TIMED_OUT` | 감시 종료 시각 도달 | 예 |
| `FAILED` | 복구 불가능한 내부 오류 | 예 |

무기한 pause 상태는 없다. `SLOT_SELECTED`는 persisted run 호환용이며
새 실행은 진입하지 않는다.

## 정상 전이

```text
IDLE
  ├─> NAVIGATING ─> CONFIGURED
  └────────────────> CONFIGURED
        ─> VALIDATING
        ─> SYNCING_CLOCK
        ─> ENTERING_RESERVATION   (entryMode=auto)
        ─> SELECTING_DATE         (entryMode=auto)
        ─> SELECTING_PERSON       (entryMode=auto)
        ─> PREPARING_PAGE
        ─> WAITING_FOR_OPEN
        ─> REFRESHING_SLOTS
        ─> SLOT_DETECTED
             ├─> DRY_RUN_COMPLETED
             ├─> REFRESHING_SLOTS       (dispatch 전 후보 소실)
             └─> SLOT_CLICK_DISPATCHED
                   ├─> HANDED_OFF        (unknown/timeout)
                   └─> SLOT_TRANSITION_CONFIRMED
                         ├─> HANDED_OFF   (후속 진행 꺼짐)
                         └─> ADVANCING_RESERVATION
                               ├─> HANDED_OFF
                               └─> COMPLETING_RESERVATION
                                     ├─> COMPLETED
                                     ├─> HANDED_OFF
                                     ├─> STOPPED
                                     ├─> TIMED_OUT
                                     └─> FAILED
```

예약 폼에 도착해도 `reservationCompletionEnabled=false`면
`COMPLETING_RESERVATION`에 진입하지 않고 `HANDED_OFF`로 종료한다.

## 종료와 복구

- 모든 실행은 사용자 중지와 내부 예외를 terminal 상태로 수렴시킨다.
- 오픈 준비·대기·슬롯 탐색·완주 단계는 각 단계의 deadline과
  `stopAtMs`를 넘기지 않는다.
- 준비 정체는 content attempt가 원인 fact를 보고하고 Background
  `RunSupervisor`가 `RETRY | RESET_PAGE | HANDOFF | FAIL` 정책을
  결정한다.
- RESET_PAGE는 같은 논리 실행의 새 attempt이며 최대 한 번이다.
- supervisor는 결정을 영속한 뒤 ACK하고 행동한다. bootstrap reconcile
  또한 같은 persisted decision을 사용한다.
- slot 또는 submit claim 뒤 결과 불명 상태는 자동 복구·재제출하지
  않고 `HANDED_OFF`로 끝낸다.

## 기록

각 상태 전이는 다음 `StateTransition`으로 기록한다.

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

논리 실행, attempt, recovery decision과 terminal 효과는 background
control plane이 별도로 영속한다. Content의 `RUN_EVENT`는 projection과
telemetry 입력이며 terminal side effect를 직접 확정하지 않는다.

## 불변식

- 종료 상태에 진입한 런은 다시 전이하지 않는다.
- dry-run은 슬롯 click 상태에 진입하지 않는다.
- slot click dispatch는 실행당 최대 한 번이다.
- outer submit과 PIN submit은 phase별 durable claim 없이
  dispatch하지 않는다.
- claim replay는 새 dispatch 권한을 주지 않는다.
- 종료 시각과 사용자 중지 뒤 새 DOM action을 시작하지 않는다.
- `COMPLETED`는 성공 path·정확한 문구·동일 예약 방문예정이 모두
  일치할 때만 가능하다.
- raw PIN은 상태·설정·event·trace·snapshot에 기록하지 않는다.
- 새 시작은 새 logicalRunId/attempt와 빈 click·submit claim을 가진다.
