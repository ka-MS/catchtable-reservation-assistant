# 03 핫패스 전략 추출 — 검증

**상태:** 코드 검증 완료, 실사이트 확인 대기
**설계:** [20-design.md](20-design.md)

## 성공 기준 대조

| # | 기준 | 결과 |
|---|---|---|
| 1 | 기존 테스트 무수정 통과 | **충족.** `git diff --name-only -- tests/` 빈 결과 |
| 3 | `npm run check` 통과 | **충족.** 625/625, version·typecheck·dist·independence·docs |
| 4 | `git diff --check` 통과 | **충족** |
| 5 | Chrome 오픈런 dry-run 1회 | **미확인** |
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

## 미확인 항목

**성공 기준 5 (Chrome 오픈런 dry-run)는 확인하지 않았다.** 이 단계는
핫패스를 통째로 다른 객체로 옮겼으므로, 01·02보다 실사이트 확인의 값이 크다.

특히 확인할 것은 다음이다.

- 토글 사이클이 이전과 같은 상관관계(`EXACT`)와 wake 판정을 내는지
- `slotDetectedEventData`의 타이밍 세 값이 `detectionTiming` 경유로도 같은
  payload를 만드는지
- shadow 콜백 위임 후에도 body가 DOM보다 선행하는 관계가 유지되는지

## 04로 넘기는 것

`OpenRunHotPath`는 구현체 하나뿐인 구체 클래스다. 전략 인터페이스화와 흐름
선택 지점은 04이며, [00-index §04 진입 조건](../00-index.md#04-진입-조건)
2번(두 번째 흐름의 실측 근거)이 **여전히 미확보**다.

조건이 확보되지 않으면 이 패키지는 03에서 완료 처리한다.
