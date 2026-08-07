# 03 핫패스 전략 추출 — 검증

**상태:** 완료
**설계:** [20-design.md](20-design.md)

## 성공 기준 대조

| # | 기준 | 결과 |
|---|---|---|
| 1 | 기존 테스트 무수정 통과 | **충족.** `git diff --name-only -- tests/` 빈 결과 |
| 3 | `npm run check` 통과 | **충족.** 625/625, version·typecheck·dist·independence·docs |
| 4 | `git diff --check` 통과 | **충족** |
| 5 | Chrome 오픈런 dry-run 1회 | **충족.** 아래 참조 |
| 6 | 핫패스 타이밍 무영향 | **충족.** 토글 그리드 시각 단언 무수정 통과 |
| 7 | 생명주기 순서 유지 | **충족.** `kernel-lifecycle` 3건 무수정 통과 |
| 8 | 상태 누출 없음 | **충족.** 아래 참조 |

## 결과

| 파일 | 줄 |
|---|---|
| `orchestrator.ts` | 1,310 → 925 |
| `flow/open-run-hot-path.ts` | 신규 464 |

`orchestrator.ts`는 SP-025 착수 시점 1,630줄에서 **925줄**이 됐다.

### 기준 8 — 상태 소유권

이동한 8개 필드가 `orchestrator.ts`에 **한 건도 남지 않았다.**

| 상태 | orchestrator | hot-path |
|---|---|---|
| `adjacentTiming` | 0 | 2 |
| `targetTiming` | 0 | 2 |
| `toggleCycle` | 0 | 1 |
| `adjacentDate` | 0 | 2 |
| `watchLive` | 0 | 3 |
| `lastArrivalAt` | 0 | 4 |
| `availabilityCorrelation` | 0 | 3 |
| `availabilityWake` | 0 | 9 |

`advanceFromSlot`이 읽어야 하는 셋은 `detectionTiming` 접근자로만 노출한다.
쓰기 경로는 핫패스 안에만 있다.

### 기준 6·7 — 무엇이 이것을 증명하는가

핫패스가 다른 파일·다른 객체로 옮겨갔으므로, 타이밍이 어긋나면 토글 그리드
시각을 고정한 기존 단언이 깨진다. 그 단언들을 **수정 없이** 통과한 것이
타이밍 무영향의 근거다.

`kernel-lifecycle` 3건은 `start`/`cleanup`이 핫패스 위임으로 바뀐 자리를
지킨다. 특히 `noteArrival`·`reset` 위임을 빠뜨리면 1번(호출 순서)이 깨진다.

## 설계에서 되돌린 것 둘

### `adjacentDate` 생성자 주입

`start()` 훅이 `confirmPageReady`보다 먼저 돌고 그 훅의 slotWatch 콜백이
핫패스를 부른다. 생성자 주입으로 두면 객체가 늦게 생겨 **그 사이 도착
신호가 유실된다** — 동작 변경이다.

생성은 `RunSession` 생성자에서 하고 인접 날짜는 `armAdjacentDate()`로
넘긴다. 타입은 이전과 같은 `string | null`이라 판정 동작도 그대로다.

02가 만든 훅 순서가 03의 설계를 제약한 사례다.

### `advanceFromSlot`이 읽는 상태 수

초안은 `lastArrivalAt` 하나로 적었으나 실제로는 `adjacentTiming`·
`targetTiming`도 읽었다(`slotDetectedEventData` 인자). 셋을 `detectionTiming`
하나로 묶었다.

설계 단계에서 사용처를 필드 이름으로만 세고 **인자 목록을 보지 않은** 탓이다.

## 실사이트 확인 (성공 기준 5)

`run-f1c72402-98e8-4f44-b035-8000ddf712da` (mangam, 2026-09-03, dryRun,
`entryMode=auto`, `empty_exit`, `toggleIntervalMs=100`).
`DRY_RUN_COMPLETED`, 68 이벤트, **droppedCount 0**, 관측 실패 0건.

02 실행(`run-3f7ecd6b`)과 **payload 키 집합을 직접 대조했다.** 이 단계는
핫패스를 통째로 다른 객체로 옮겼으므로 값이 아니라 모양이 어긋날 위험이
크다.

| 이벤트 | 02 | 03 | 결과 |
|---|---|---|---|
| `STATE_CHANGED`(SLOT_DETECTED) | 21키 | 21키 | **동일** |
| `SLOT_DETECTED` | 3키 | 3키 | **동일** |
| `DATE_TOGGLE_CYCLE` | 20키 | 20키 | **동일** |

이벤트 code 시퀀스도 `PREPARATION_OBSERVED` 개수를 빼면 같다. 그 차이는
실사이트 준비 단계의 재시도 횟수라 실행마다 다르며 코드 변경과 무관하다.

### 세 확인 항목

- **토글 상관관계·wake 판정** — cycle 1, `correlationQuality=EXACT`,
  `wakeAccepted=true`, `wakeReason=verified_target_body`, `wakeUsed=true`,
  `SLOT_FOUND`. 02와 같다.
- **`detectionTiming` 경유 payload** — 인접·목표 타이밍 8개 필드와
  `arrivalToDetectMs`(61ms)·`monoFromRunStartMs`가 모두 정상이다. 접근자
  경유로 바꾼 세 값이 같은 payload를 만든다.
- **shadow 콜백 위임** — `bodyLeadOverDomMs` 60.7ms로 body가 DOM보다
  앞선다. 콜백을 핫패스로 옮긴 뒤에도 선행 관계가 유지된다.

스케줄 드리프트는 인접 14ms·목표 114ms다.

## 리뷰 반영

PR #30 리뷰 3건을 모두 반영했다.

- **핫패스의 미사용 import 3개**(`RunEvent`·`detectionClockData`·
  `slotClickDispatchedEventData`)와 **`orchestrator.ts`의 고아 import
  8개**를 제거했다. 이동이 만든 부산물이므로 `AGENTS.md` §3 대상이다.
  `tsc`가 emit에서 elide 해 런타임 영향은 없었으나, "핫패스가 한 건도
  남지 않았다"는 주장과 소스가 어긋나 보였다.
- **`hotPath.reset()`을 감쌌다.** `cleanup()`의 docblock은 이 한 줄을
  감싸지 않는 근거를 "내부 필드 초기화라 던지지 않는다"로 적고 있었는데,
  03에서 그 호출이 **다른 모듈**로 위임됐다. 이제
  `flow/open-run-hot-path.ts`의 `reset()`에 무언가 추가되는 것만으로
  #27의 실패 모드(뒤따르는 watch 원복 건너뜀)가 이 파일을 고치지 않고
  재현된다. docblock도 "모든 호출을 각자 감싼다"로 갱신했다.

## 04로 넘기는 것

`OpenRunHotPath`는 구현체 하나뿐인 구체 클래스다. 전략 인터페이스화와 흐름
선택 지점은 04이며, [00-index §04 진입 조건](../00-index.md#04-진입-조건)
2번(두 번째 흐름의 실측 근거)이 **여전히 미확보**다.

조건이 확보되지 않으면 이 패키지는 03에서 완료 처리한다.
