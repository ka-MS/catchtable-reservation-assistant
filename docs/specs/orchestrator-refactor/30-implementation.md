# A. 오케스트레이터 구조 리팩터 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 626줄 `start()`를 per-run `RunSession` 메서드 객체 + 순수 텔레메트리 빌더로 분해한다. 동작·이벤트·타이밍 무변경.

**Architecture:** `OpenRunOrchestrator`는 공개 계약만 유지하고 실행을 `RunSession`에 위임. run-scoped 상태는 `RunSession` 필드, 단계는 `RunResult | null` 반환 메서드로 분해. 거대 인라인 payload는 모듈 최상위 순수 함수로 추출.

**Tech Stack:** TypeScript(MV3 content script), node:test.

## Global Constraints

- 설계: `docs/specs/orchestrator-refactor/20-design.md`
- **behavior-neutral**: `tests/orchestrator.test.mjs` 18개를 **무수정** 통과. 새 테스트는 이 파일을 건드리지 않는다.
- 게이트: WSL에서 `wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check"` + `git diff --check`
- 대상 파일 단일: `src/content/orchestrator.ts` (분할 안 함)
- 이벤트 payload·trace attribute 값은 **바이트 동일** 유지
- Port 인터페이스·`Dependencies`·`RunResult` 타입 불변
- baseline: 착수 시점 전체 테스트 166개 green (2026-07-12 확인)

## TDD 노트 (이 계획의 특수성)

순수 구조 리팩터라 "실패하는 새 테스트 → 구현" 사이클이 아니라 **기존 18개 테스트를 회귀 가드로 쓰는 리팩터 사이클**이다: 각 스텝은 (1) 코드 이동/추출, (2) `npm run check`로 18개 green 재확인, (3) 커밋. 테스트가 깨지면 그 스텝 범위 안에서 원인을 찾는다(작은 스텝이라 범위가 좁다). 예외: Task 2의 텔레메트리 빌더는 선택적으로 순수 단위 테스트를 추가할 수 있으나 필수는 아니다(18개가 emit 결과를 이미 덮음).

각 Task 착수 전 실행하는 공통 게이트 명령:
```
wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && node --test tests/orchestrator.test.mjs"
```
전체 게이트(Task 종료 시):
```
wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check" && git diff --check
```

---

### Task 1: `RunSession` 껍데기 도입 (본문 통째 이관)

**Files:**
- Modify: `src/content/orchestrator.ts`

**Interfaces:**
- Produces: `class RunSession` (모듈 내부, export 안 함) — 필드 `controller: AbortController`, 메서드 `execute(): Promise<RunResult>`. `OpenRunOrchestrator.start()`가 이를 생성·위임.

이 Task는 단계 분해 없이 **상태·헬퍼·전체 try/catch/finally 본문을 `RunSession`으로 그대로 옮기는 것만** 한다. 로직은 한 줄도 안 바뀐다.

- [ ] **Step 1: 착수 baseline 확인**

Run: `wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && node --test tests/orchestrator.test.mjs 2>&1 | tail -4"`
Expected: `# pass 18` / `# fail 0`

- [ ] **Step 2: `RunSession` 클래스 작성**

`postSlotEventData` 함수 정의 뒤, `export class OpenRunOrchestrator` 앞에 삽입한다. 현재 `start()` 본문(108–625행)의 상태·헬퍼·try/catch/finally를 그대로 옮긴다. `this.dependencies` 참조는 `this.deps`로, `config`/`runId`/`controller`/`serverClock` 등 지역변수는 필드로 승격한다. `activeController` 관리는 여기서 하지 않는다(Orchestrator가 담당).

```ts
class RunSession {
  readonly controller = new AbortController();
  private readonly runId: string;
  private readonly machine: RunStateMachine;
  private readonly serverClock: MonotonicEpochClock;
  private offsetMs: number | null = null;
  private serverClockReady = false;
  private adjacentTiming: { actualAt: number; scheduledAt: number; phase: string } | null = null;
  private targetTiming: { actualAt: number; scheduledAt: number; phase: string } | null = null;
  private toggleCycle = 0;

  constructor(
    private readonly deps: Dependencies,
    private readonly config: ReservationConfig,
    requestedRunId?: string,
  ) {
    this.runId = requestedRunId ?? deps.runId();
    this.machine = new RunStateMachine({ dryRun: config.dryRun, now: () => deps.clock.now() });
    this.serverClock = new MonotonicEpochClock(deps.monotonicClock);
  }

  private emit(kind: RunEvent["kind"], message: string, data?: RunEvent["data"]): void {
    const at = this.deps.clock.now();
    this.deps.emit({ at, serverAt: this.serverClockReady ? this.serverClock.now() : null, runId: this.runId, kind, message, data });
  }

  private transition(
    state: RunState,
    reason: string,
    extra: { error?: string; userStopped?: boolean; data?: RunEvent["data"] } = {},
  ): void {
    this.machine.transition(state, reason, { error: extra.error, userStopped: extra.userStopped });
    this.emit("state", reason, { state, ...extra.data });
  }

  private finish(): RunResult { return { runId: this.runId, state: this.machine.state }; }

  private stopOrTimeout(result: "ready" | "timed_out" | "stopped"): RunResult | null {
    if (result === "timed_out") { this.transition("TIMED_OUT", "감시 종료 시각에 도달했습니다."); return this.finish(); }
    if (result === "stopped") { this.transition("STOPPED", "사용자가 실행을 중지했습니다.", { userStopped: true }); return this.finish(); }
    return null;
  }

  async execute(): Promise<RunResult> {
    const config = this.config;
    const controller = this.controller;
    const machine = this.machine;
    const serverClock = this.serverClock;
    const emit = this.emit.bind(this);
    const transition = this.transition.bind(this);
    const finish = this.finish.bind(this);
    const stopOrTimeout = this.stopOrTimeout.bind(this);
    // ↓ 현재 start()의 try { ... } catch { ... } finally { ... } 본문(146–624행)을
    //   여기에 그대로 붙인다. 단, offsetMs/serverClockReady/adjacentTiming/targetTiming/toggleCycle은
    //   지역 재선언을 제거하고 this.* 로 참조한다. flushTrace finally는 유지, activeController 정리는 제거.
  }
}
```

주의: `execute()` 안에서 지역 별칭(`const emit = this.emit.bind(this)` 등)을 두면 기존 본문을 최소 수정으로 이관할 수 있다. `offsetMs` 등 재대입되는 값은 별칭 대신 `this.offsetMs`로 직접 참조해야 한다(별칭은 값 복사라 재대입이 반영 안 됨).

- [ ] **Step 3: `start()`를 위임으로 축소**

```ts
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
```

- [ ] **Step 4: 게이트**

Run: `wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check 2>&1 | grep -E '^# (tests|pass|fail)|error TS|validation'"`
Expected: `# pass 166` / `# fail 0`, dist·independence validation passed

- [ ] **Step 5: `git diff --check` 후 커밋**

```bash
git add src/content/orchestrator.ts
git commit -m "refactor: move run execution into a per-run RunSession"
```

---

### Task 2: 순수 텔레메트리 빌더 추출

**Files:**
- Modify: `src/content/orchestrator.ts`

**Interfaces:**
- Produces (모듈 최상위 함수):
  - `clockMetricData(estimate: ClockEstimate, phase: "initial" | "final", offsetMs: number): NonNullable<RunEvent["data"]>`
  - `toggleCycleAttributes(input: ToggleCycleTrace): TraceAttributes`
  - `targetClickMetricData(targetClickedAt: number, plan: TogglePlan, openAtMs: number): NonNullable<RunEvent["data"]>`
  - `slotDetectedEventData(slotDetectedAt: number, adjacent: TimingMark | null, target: TimingMark | null, openAtMs: number): NonNullable<RunEvent["data"]>`
  - `slotSelectedEventData(slotSelectedAt: number, openAtMs: number): NonNullable<RunEvent["data"]>`
  - 타입 별칭 `TimingMark = { actualAt: number; scheduledAt: number; phase: string }`

각 함수는 현재 인라인 객체를 **키·값 동일**하게 만들어 반환한다. `nextTogglePlan` 반환 타입을 `TogglePlan`으로 참조(이미 존재하면 재사용, 없으면 `ReturnType<typeof nextTogglePlan>`).

- [ ] **Step 1: baseline 확인** (`node --test tests/orchestrator.test.mjs` → pass 18)

- [ ] **Step 2: `clockMetricData` 추출**

`postSlotEventData` 옆에 추가:
```ts
function clockMetricData(estimate: ClockEstimate, phase: "initial" | "final", offsetMs: number): NonNullable<RunEvent["data"]> {
  return {
    clockOffsetMs: phase === "initial" ? estimate.offsetMs : offsetMs,
    clockSamples: estimate.sampleCount,
    clockSpreadMs: estimate.spreadMs ?? -1,
    clockFallback: estimate.fallback,
    clockMethod: estimate.method,
    clockPrecisionMs: estimate.precisionMs ?? -1,
    clockPhase: phase,
  };
}
```
`execute()` 본문의 두 metric emit을 이 함수 호출로 교체한다. **주의:** initial은 `estimate.offsetMs`, final은 `offsetMs ?? 0`을 쓴다. final 호출부는 `clockMetricData(finalEstimate, "final", this.offsetMs ?? 0)`.

- [ ] **Step 3: 게이트 확인** (pass 166) — 실패 시 값 불일치이므로 키·값을 원본과 대조.

- [ ] **Step 4: 나머지 4개 빌더 추출**

`toggleCycleAttributes`, `targetClickMetricData`, `slotDetectedEventData`, `slotSelectedEventData`를 동일 방식으로 추출하고 각 호출부를 교체한다. `toggleCycleAttributes` 입력 타입:
```ts
interface ToggleCycleTrace {
  cycle: number; phase: string; adjacentDate: string | null;
  adjacentPlannedAt: number; adjacentClickedAt: number | null;
  targetPlannedAt: number; targetClickedAt: number | null;
  targetSelectedAt: number | null;
  slotScanCount: number; availableSlotCount: number; matchedSlotCount: number;
  result: string;
}
function toggleCycleAttributes(t: ToggleCycleTrace): TraceAttributes {
  return {
    cycle: t.cycle, phase: t.phase, adjacentDate: t.adjacentDate,
    adjacentPlannedAt: t.adjacentPlannedAt, adjacentClickedAt: t.adjacentClickedAt,
    adjacentClickOk: t.adjacentClickedAt !== null,
    targetPlannedAt: t.targetPlannedAt, targetClickedAt: t.targetClickedAt,
    targetClickOk: t.targetClickedAt !== null,
    targetSelectedAt: t.targetSelectedAt,
    slotScanCount: t.slotScanCount, availableSlotCount: t.availableSlotCount, matchedSlotCount: t.matchedSlotCount,
    result: t.result,
  };
}
```
`traceCycle` 클로저는 이 attributes 빌더를 쓰도록 바꾸되 클로저 자체는 Task 4까지 유지한다.

- [ ] **Step 5: 게이트** (pass 166) + `git diff --check`

- [ ] **Step 6: 커밋** — `refactor: extract pure telemetry payload builders`

---

### Task 3: 앞단 단계 메서드 분해

**Files:**
- Modify: `src/content/orchestrator.ts`

**Interfaces:**
- Produces (RunSession private 메서드, 각 `Promise<RunResult | null>` 또는 동기 `RunResult | null`):
  - `validate(): RunResult | null`
  - `syncInitialClock(): Promise<RunResult | null>`
  - `prepareEntry(): Promise<RunResult | null>`
  - `prepareDate(): Promise<RunResult | null>`
  - `preparePerson(): Promise<RunResult | null>`
  - `confirmPageReady(): RunResult | null`
  - `waitForOpen(): Promise<RunResult | null>`
  - `finishStopped(): RunResult`
  - 필드 추가: `private adjacentDate: string | null = null;` (confirmPageReady가 설정, searchAndReserve가 읽음)

계약: non-null 반환 = 종료, null = 진행. `prepareEntry/Date/Person`은 각각 `if (this.config.entryMode !== "auto") return null;` 가드로 시작.

- [ ] **Step 1: baseline 확인** (pass 18)

- [ ] **Step 2: `execute()`를 `??` 체인으로 교체하고 앞단만 우선 분해**

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
    if (!TERMINAL.has(this.machine.state)) {
      const message = error instanceof Error ? error.message : "알 수 없는 실행 오류";
      this.deps.trace?.("RUN_FAILED", "error", message, {
        serverAt: this.serverClockReady ? this.serverClock.now() : null,
        state: "FAILED",
        error,
      });
      this.transition("FAILED", message, { error: message });
    }
    return this.finish();
  } finally {
    await this.deps.flushTrace?.().catch(() => undefined);
  }
}
```
이 시점에 `searchAndReserve()`는 아직 없으므로, Task 3에서는 **REFRESHING_SLOTS 이후 본문을 임시로 `searchAndReserve()` private 메서드에 통째 담아** 컴파일되게 한다(Task 4에서 내부 분해). `finishStopped()`는 `{ this.transition("STOPPED", "사용자가 실행을 중지했습니다.", { userStopped: true }); return this.finish(); }`.

- [ ] **Step 3: 각 앞단 메서드 본문 이식**

현재 `execute()` 본문에서 해당 구간을 잘라 각 메서드로 옮긴다. 매핑(20-design.md 표): `validate`=VALIDATING+검증, `syncInitialClock`=초기 시계, `prepareEntry/Date/Person`=세 루프(각 auto 가드), `confirmPageReady`=PREPARING_PAGE(`this.adjacentDate = setup.adjacentDate` 저장), `waitForOpen`=대기+최종 재동기화. 각 메서드는 종료 지점에서 `return this.finish()`, 정상 진행 시 `return null`.

- [ ] **Step 4: 게이트** (pass 166). 실패 시 어느 단계 메서드인지 좁혀서 수정.

- [ ] **Step 5: `git diff --check` 후 커밋** — `refactor: split run preamble into named RunSession phase methods`

---

### Task 4: `searchAndReserve` 내부 분해

**Files:**
- Modify: `src/content/orchestrator.ts`

**Interfaces:**
- Produces (RunSession private 메서드):
  - `searchAndReserve(): Promise<RunResult | null>` — 바깥 루프
  - `runToggleCycle(): Promise<ToggleCycleOutcome>` — `type ToggleCycleOutcome = { kind: "terminal"; result: RunResult } | { kind: "retry" } | { kind: "slot"; candidate: SlotCandidate }`
  - `advanceFromSlot(candidate: SlotCandidate): Promise<RunResult | null>` — null = clickSlot 실패로 루프 재개
  - `advancePostSlot(): Promise<RunResult>`

- [ ] **Step 1: baseline 확인** (pass 18)

- [ ] **Step 2: `ToggleCycleOutcome` 타입 + `searchAndReserve` 골자 작성**

```ts
type ToggleCycleOutcome =
  | { kind: "terminal"; result: RunResult }
  | { kind: "retry" }
  | { kind: "slot"; candidate: SlotCandidate };

// RunSession 메서드:
private async searchAndReserve(): Promise<RunResult | null> {
  this.transition("REFRESHING_SLOTS", "날짜 토글로 예약 슬롯을 갱신합니다.");
  while (!this.controller.signal.aborted) {
    if (this.serverClock.now() >= this.config.stopAtMs) {
      this.transition("TIMED_OUT", "감시 종료 시각에 도달했습니다.");
      return this.finish();
    }
    const cycle = await this.runToggleCycle();
    if (cycle.kind === "terminal") return cycle.result;
    if (cycle.kind === "retry") continue;
    const advanced = await this.advanceFromSlot(cycle.candidate);
    if (advanced) return advanced;
  }
  return this.finishStopped();
}
```

- [ ] **Step 3: `runToggleCycle` 이식**

현재 루프 본문 327–477행(토글 plan → traceCycle → 인접/목표 클릭 → 선택 확인 → 슬롯 감지)을 옮긴다. 사이클-지역 변수(`plan`,`cycle`,`adjacentClickedAt`,`targetClickedAt`,`targetSelectedAt`,`slotScanCount`,`availableSlotCount`,`matchedSlotCount`,`adjacentDateValue`)와 `traceCycle` 클로저는 이 메서드 안에 둔다. `adjacentDateValue` 초기값은 `this.adjacentDate`. 종료 조건은 `{ kind: "terminal", result: this.finish() }`, NO_SLOT은 `{ kind: "retry" }`, 감지는 `{ kind: "slot", candidate }`로 반환. `stopOrTimeout` 사용부는 `const exit = this.stopOrTimeout(...); if (exit) return { kind: "terminal", result: exit };`.

- [ ] **Step 4: 게이트** (pass 166)

- [ ] **Step 5: `advanceFromSlot` + `advancePostSlot` 이식**

479–535행(SLOT_DETECTED→dryRun/stopAt→clickSlot→SLOT_SELECTED)을 `advanceFromSlot`으로. clickSlot 실패 시 `transition("REFRESHING_SLOTS", ...); return null;`. 성공 후 `!postSlotEnabled`면 `HANDED_OFF` 반환, 아니면 `ADVANCING_RESERVATION` 전이 후 `return this.advancePostSlot()`. 536–605행(후속 루프)을 `advancePostSlot`으로 옮기고 `RunResult` 반환.

- [ ] **Step 6: 게이트** (pass 166) + `git diff --check`

- [ ] **Step 7: 커밋** — `refactor: split slot search loop into toggle-cycle and advance methods`

---

### Task 5: 최종 게이트·문서

**Files:**
- Create: `docs/worklog/2026-07-12-05-orchestrator-refactor.md`
- Modify: `docs/worklog/HANDOFF.md`

- [ ] **Step 1: 최종 전체 게이트**

Run: `wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check"` + `git diff --check`
Expected: 166 pass, 모든 validation 통과.

- [ ] **Step 2: 라인 수 확인 (목표 달성 근거)**

Run: `wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && wc -l src/content/orchestrator.ts"`
기대: 파일 총량은 비슷하되(추출로 상쇄) 단일 최대 메서드가 대폭 축소. 워크로그에 각 메서드 대략 라인 수를 기록.

- [ ] **Step 3: 워크로그 작성**

`2026-07-12-05-orchestrator-refactor.md`: 수행(RunSession 도입·단계 분해·텔레메트리 빌더), 검증(166 green 무수정, diff-check), 동작 보존 근거(테스트 무수정), 다음(B+C 재브레인스토밍, 베이스=postslot 병합 후 이 브랜치 병합).

- [ ] **Step 4: HANDOFF 갱신** — 현재 상태를 오케스트레이터 리팩터 완료로, 다음 작업에 "postslot 병합 후 이 브랜치 병합, 이후 B+C 브레인스토밍".

- [ ] **Step 5: 커밋** — `docs: record the orchestrator refactor worklog and handoff`

---

## Self-Review

**Spec coverage:** RunSession(핵심 구조)=Task1, `RunResult|null` 계약·`??` 체인=Task3, searchAndReserve 세분화=Task4, 텔레메트리 빌더=Task2, 검증 전략=전 Task 게이트, 문서=Task5. 동작 보존 주의점 5개 — activeController 이동=Task1 Step3, serverClockReady 게이팅=Task1(필드화), flushTrace finally=Task1/Task3 catch·finally, ?? falsy=Task3 반환타입, entryMode 가드=Task3 Step3. 전부 커버.

**Placeholder scan:** 코드 스텝은 실제 코드 제시. "본문 그대로 이관"은 원본 행 번호를 명시했으므로 실행 가능(플레이스홀더 아님).

**Type consistency:** `RunResult | null` 계약 전 Task 일관. `TimingMark`(Task2)와 `adjacentTiming/targetTiming` 필드 타입 동일. `ToggleCycleOutcome`(Task4) 일관.
