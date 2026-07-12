# A. 오케스트레이터 구조 리팩터 설계

**기준일:** 2026-07-12
**선행:** `docs/specs/orchestrator-refactor/10-scope.md` (A/B/C/D 범위·순서)
**범위:** A만. 동작 무변경(behavior-neutral) 순수 구조 리팩터.

## 목표

`src/content/orchestrator.ts`의 626줄 단일 메서드 `start()`를 단계별 named 메서드와 순수 텔레메트리 빌더로 분해한다. 실행 동작·이벤트·타이밍은 한 치도 바뀌지 않는다.

## 성공 기준

- 기존 `tests/orchestrator.test.mjs` 18개를 **한 줄도 수정하지 않고** 그대로 통과.
- `npm run check`(타입·전체 테스트·dist·독립성) + `git diff --check` 통과.
- 리팩터 후 `start()` 및 각 단계 메서드가 사람이 한 화면에서 읽을 수 있는 크기.

## 비목표 (A에서 하지 않음)

- 새 에러 핸들링·스냅샷(B/C), 어댑터 중복 제거(D).
- 이벤트 payload·trace attribute의 **값** 변경. 추출은 하되 산출물은 바이트 동일해야 한다.
- Port 인터페이스·Dependencies 계약 변경.

## 핵심 구조: per-run 메서드 객체 `RunSession`

현재 `start()`가 비대한 근본 원인은 run-scoped 가변 상태(`serverClock`, `machine`, `offsetMs`, `serverClockReady`, `adjacentTiming`, `targetTiming`, `toggleCycle`, `setup.adjacentDate`)와 헬퍼 클로저(`emit`/`transition`/`finish`/`stopOrTimeout`)가 전부 한 메서드의 지역 스코프에 묶여, 단계를 함수로 빼려면 상태 12개를 인자로 넘겨야 하기 때문이다.

→ 모듈 내부에 **`RunSession` 클래스**를 도입한다. run-scoped 상태를 필드로 소유하고, 헬퍼·단계를 메서드로 갖는다. run 1회당 인스턴스 1개.

`OpenRunOrchestrator`는 공개 계약(`start`/`stop`/중복 실행 방지·`activeController`)만 유지하고 실행은 위임한다:

```ts
export class OpenRunOrchestrator {
  private activeController: AbortController | null = null;
  constructor(private readonly dependencies: Dependencies) {}

  stop(): void { this.activeController?.abort(); }

  async start(config: ReservationConfig, requestedRunId?: string): Promise<RunResult> {
    if (this.activeController) throw new Error("이미 실행 중입니다.");
    const session = new RunSession(this.dependencies, config, requestedRunId);
    this.activeController = session.controller;
    try {
      return await session.execute();
    } finally {
      this.activeController = null;
    }
  }
}
```

`RunSession`은 생성자에서 현재 `start()` 앞부분(108–144행)의 상태·헬퍼 초기화를 그대로 옮긴다. `runId`는 `requestedRunId ?? dependencies.runId()`.

## 단계 메서드 계약: `Promise<RunResult | null>`

각 단계는 `RunResult | null`을 반환한다 — **non-null = 실행 종료(터미널 상태 도달), null = 다음 단계로 진행**. 현재의 "종료면 `return finish()`, 아니면 fall-through" 시맨틱을 정확히 보존한다.

`execute()`가 단계를 순서대로 엮는다. `??`는 null일 때만 다음을 평가하므로 조기 종료가 그대로 재현된다:

```ts
async execute(): Promise<RunResult> {
  try {
    this.transition("CONFIGURED", "예약 설정을 불러왔습니다.");
    return this.validate()
      ?? await this.syncInitialClock()
      ?? await this.prepareEntry()
      ?? await this.prepareDate()
      ?? await this.preparePerson()
      ?? await this.confirmPageReady()
      ?? await this.waitForOpen()
      ?? await this.searchAndReserve()
      ?? this.finishStopped();
  } catch (error) {
    // 현행 catch 블록 그대로: TERMINAL 아닐 때 RUN_FAILED trace + FAILED 전이
  } finally {
    await this.dependencies.flushTrace?.().catch(() => undefined);
  }
}
```

주의: `activeController` 정리는 `OpenRunOrchestrator.start()`의 finally가 담당하므로 `execute()`의 finally에는 넣지 않는다(현행 위치와 동일하게 유지하되, 소유 주체가 옮겨간다 — 아래 "동작 보존 주의점" 참조).

### 단계 → 현재 코드 매핑

| 메서드 | 현재 행 | entryMode 가드 |
|---|---|---|
| `validate()` | 148–153 (VALIDATING+검증) | — |
| `syncInitialClock()` | 155–172 | — |
| `prepareEntry()` | 175–211 | `auto`에서만; 아니면 즉시 null |
| `prepareDate()` | 213–239 | `auto`에서만; 아니면 즉시 null |
| `preparePerson()` | 241–271 | `auto`에서만; 아니면 즉시 null |
| `confirmPageReady()` | 274–279 (PREPARING_PAGE, `setup` 저장) | — |
| `waitForOpen()` | 281–318 (대기+최종 재동기화) | — |
| `searchAndReserve()` | 320–606 (REFRESHING_SLOTS 루프) | — |
| `finishStopped()` | 608 | — |

`confirmPageReady()`가 계산한 `setup.adjacentDate`는 `this.adjacentDate` 필드에 저장해 `searchAndReserve()`가 읽는다.

## `searchAndReserve()` 내부 세분화

가장 큰 덩어리(287줄)이므로 한 겹 더 나눈다:

- `searchAndReserve()`: 바깥 `while (!aborted)` 루프. 매 회 `runToggleCycle()`를 호출하고 결과로 분기.
- `runToggleCycle()`: 토글 1회(인접 클릭 → 목표 클릭 → 선택 확인 → 슬롯 감지). 사이클-지역 타이밍 변수와 `traceCycle` 클로저는 **이 메서드 안에 갇힌다**. 반환:
  - `{ kind: "terminal"; result: RunResult }` — 중지/타임아웃/인계
  - `{ kind: "retry" }` — 슬롯 없음(NO_SLOT), 바깥 루프 continue
  - `{ kind: "slot"; candidate: SlotCandidate }` — 감지 성공
- `advanceFromSlot(candidate)`: SLOT_DETECTED 전이 → dryRun/stopAt 체크 → `clickSlot`. 클릭 실패면 REFRESHING_SLOTS 전이 후 `null`(바깥 루프 재개), 성공이면 SLOT_SELECTED 후 `advancePostSlot()`.
- `advancePostSlot()`: 후속 단계 루프(536–605). 폼/unknown/waiting/advance 처리. `RunResult` 반환.

`searchAndReserve()` 골자:
```ts
while (!this.controller.signal.aborted) {
  if (this.serverClock.now() >= this.config.stopAtMs) { this.transition("TIMED_OUT", ...); return this.finish(); }
  const cycle = await this.runToggleCycle();
  if (cycle.kind === "terminal") return cycle.result;
  if (cycle.kind === "retry") continue;
  const advanced = await this.advanceFromSlot(cycle.candidate);
  if (advanced) return advanced;  // null이면 clickSlot 실패 → 루프 재개
}
return this.finishStopped();
```

## 텔레메트리 페이로드 빌더 (A의 (b)층)

거대 인라인 `data:{}`·trace attribute 블롭을 **모듈 최상위 순수 함수**로 추출한다. `postSlotEventData`가 이미 선례. 입력만 받아 동일 객체를 만들며 부수효과 없음:

- `clockMetricData(estimate, phase, offsetMs)` — 164–172, 301–309 두 곳의 metric data
- `toggleCycleAttributes(input)` — 343–358의 traceCycle attributes
- `targetClickMetricData(targetClickedAt, plan, config)` — 414–420
- `slotDetectedEventData(slotDetectedAt, adjacentTiming, targetTiming, config)` — 482–499
- `slotSelectedEventData(slotSelectedAt, config)` — 526–530

추출 후 산출 객체는 기존과 **키·값 동일**해야 한다(테스트가 emit 결과를 검증).

## 파일 구성

`src/content/orchestrator.ts` 한 파일 유지(분할하지 않음). 파일 내부 순서: import → 상수/타입 → 순수 텔레메트리 빌더들 → `RunSession` 클래스 → `OpenRunOrchestrator` 클래스. 텔레메트리 빌더가 커지면 후속으로 `orchestrator-telemetry.ts` 분리를 검토하되 A 범위 밖.

## 동작 보존 주의점 (회귀 위험 지점)

1. **`activeController` 소유권 이동.** 현재 `start()`가 `this.activeController = controller` 후 finally에서 null 처리. 리팩터 후엔 `RunSession`이 `controller`를 만들고 `start()`가 그 참조를 `activeController`에 걸었다가 finally에서 정리한다. `stop()`이 여전히 실행 중 세션을 abort하는지 테스트로 확인.
2. **`serverClockReady` 게이팅.** `emit`의 `serverAt` 계산은 `serverClockReady` 이후에만 서버시각. 필드로 옮겨도 초기 false → syncInitialClock 이후 true 순서 유지.
3. **`finally`의 `flushTrace`.** run 종료 시 1회 flush가 반드시 실행돼야 한다(현행 위치 보존).
4. **`??` 체이닝과 falsy.** 단계는 `RunResult`(객체) 또는 `null`만 반환한다. `RunResult`는 항상 truthy이므로 `??`로 충분하나, 실수로 다른 falsy를 반환하지 않도록 반환 타입을 `RunResult | null`로 명시.
5. **`prepareEntry/Date/Person`의 entryMode 가드.** 현재는 `if (config.entryMode === "auto") { 세 루프 }`로 한 번에 감싼다. 세 메서드로 나눌 때 각자 `if (this.config.entryMode !== "auto") return null;`로 가드해 동일 스킵.

## 구현 순서 (단계별 green 유지)

각 단계 끝마다 18개 테스트 green 확인 후 커밋:

1. `RunSession` 껍데기 도입 — 상태·헬퍼를 필드/메서드로 옮기고 `execute()`에 기존 본문을 **통째로** 이관(아직 단계 분해 없음). `start()`는 위임만. → green.
2. 순수 텔레메트리 빌더 추출(값 불변). → green.
3. 앞단 단계 메서드 분해: `validate`/`syncInitialClock`/`prepareEntry`/`prepareDate`/`preparePerson`/`confirmPageReady`/`waitForOpen`. → 단계별 green.
4. `searchAndReserve` + `runToggleCycle`/`advanceFromSlot`/`advancePostSlot` 분해. → green.
5. 최종 게이트 + 워크로그·HANDOFF.

## 베이스 브랜치 의존성

이 리팩터는 626줄 최신 오케스트레이터(`lastInspection`·`dismissPromo`·request-sheet)를 기준으로 한다. 해당 코드는 `codex/fix-postslot-timeout-diagnostics`에 있고 main 미병합 상태다. 본 작업 브랜치 `codex/refactor-orchestrator-session`은 그 위에서 잘렸다. postslot 브랜치가 main에 병합된 뒤 이 브랜치를 병합한다.
