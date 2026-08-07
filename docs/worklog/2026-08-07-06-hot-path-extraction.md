# 2026-08-07-06 핫패스 전략 추출 (SP-025/03)

## 한 것

- 착수 전 재측정으로 02가 남긴 미결 두 건을 해소했다. `advanceFromSlot`은
  `RunSession` 잔류, shadow listener는 핫패스 소유로 정했다.
- 슬롯 감지까지의 폴링 구간과 오픈런 전용 상태 8개를
  `src/content/flow/open-run-hot-path.ts`로 뺐다.
- `RunKernel.offsetMs` 죽은 필드를 별도 커밋으로 지웠다(02 리뷰 지적).

수치는 [40-verification](../specs/orchestrator-extensibility/03-hot-path-extraction/40-verification.md)에만 둔다.

## 내린 결정

**경계는 "슬롯을 찾을 때까지"다.** `advanceFromSlot` 이후는 슬롯을 찾은 뒤
한 번 도는 경로이고 폼·결제를 다룬다. 묶으면 핫패스 클래스가 예약 완주까지
삼킨다.

**02와 달리 별도 파일로 뺐다.** `build-regression`이 검사하는 문자열 5개가
전부 `RunKernel`·`OpenRunOrchestrator`에 있어 `orchestrator.ts`에 남는다.
02를 막았던 제약이 여기서는 걸리지 않는다.

## 검토했다 버린 선택지

- **`adjacentDate` 생성자 주입** — 설계에 넣었다가 구현에서 철회했다.
  `start()` 훅이 `confirmPageReady`보다 먼저 돌아 객체가 늦게 생기면 도착
  신호가 유실된다.
- **`advanceFromSlot`까지 핫패스로** — `lastArrivalAt`을 읽지만 갱신하지
  않는다. 소유권 기준으로 핫패스가 아니다.
- **전략 인터페이스 도입** — 04이며 게이트가 걸려 있다.
- **`offsetMs` 제거를 이동 커밋에 포함** — 섞으면 이동 diff에 무관한 변경이
  붙는다.

## 남은 것

- **Chrome dry-run(성공 기준 5) 미확인.** 핫패스를 통째로 다른 객체로
  옮겼으므로 01·02보다 실사이트 확인의 값이 크다.
- 04는 진입 조건 2번(두 번째 흐름 실측 근거)이 미확보다. 확보되지 않으면
  이 패키지는 03에서 완료 처리한다.

## 배운 것

설계에서 `advanceFromSlot`이 읽는 상태를 하나로 적었는데 실제로는 셋이었다.
**필드 이름으로 사용처를 세고 인자 목록을 보지 않은** 탓이다.
`slotDetectedEventData(...)`에 타이밍 둘이 인자로 들어가 있었다.

02가 만든 `start`/`cleanup` 훅 순서가 03의 설계를 제약했다. 앞 단계가 그은
경계는 다음 단계의 자유도를 줄인다 — 나쁜 것이 아니라, 설계할 때 앞 단계
산출물을 먼저 읽어야 한다는 뜻이다.

## 산출물

- spec: [03-hot-path-extraction](../specs/orchestrator-extensibility/03-hot-path-extraction/20-design.md)
- 커밋: `8256ff1`(설계) · `52e2206`(추출) · `5dd0fc4`(offsetMs 제거)
