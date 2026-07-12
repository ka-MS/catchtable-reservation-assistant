# XHR 슬롯 응답 감시 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** time-slots XHR 도착 신호로 토글 콰이어스·스캔 버스트를 구현해 실오픈 슬롯 감지를 +1303ms → ~+430ms로 줄인다.

**Architecture:** PerformanceObserver 기반 `SlotRefreshWatch` 어댑터가 도착 신호를 올리고, 오케스트레이터 감지 루프가 신호 유무에 따라 3-모드 데드라인(그리드 폴백 / 콰이어스 / 도착 버스트)으로 동작한다. 신호가 한 번도 안 온 실행에서는 현행 그리드 동작과 완전히 동일하다.

**Tech Stack:** TypeScript(브라우저 MV3 content script), node:test + fake clock 하네스, 스펙 `10-analysis-design.md` §3.1.

## Global Constraints

- 실측 근거: site-behavior §8.1 — 필터는 pathname suffix `/dining/time-slots`, 클릭→발사 217~379ms, 렌더 56~182ms.
- 상수: `QUIESCE_TIMEOUT_MS = 700`, `ARRIVAL_BURST_MS = 250` (근거 주석 필수).
- 자동화 경계 불변: 클릭 대상·정책 변화 없음. 관측 계층만 추가.
- 폴백 불변식: `slotWatch` 미주입 또는 신호 0회 실행 = 기존 그리드 타이밍과 bit-동일. 기존 orchestrator 테스트 무수정 통과가 이 가드다.
- 각 Task 종료마다 `npm run check`(WSL) green 후 커밋. 커밋 트레일러 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: SlotRefreshWatch 어댑터

**Files:**
- Create: `src/content/adapter/slot-refresh-watch.ts`
- Test: `tests/slot-refresh-watch.test.mjs`

**Interfaces:**
- Produces: `SlotRefreshWatchPort { start(onArrival: () => void): void; stop(): void }`, `createSlotRefreshWatch(): SlotRefreshWatchPort`, `SlotRefreshWatch` 클래스(팩토리 주입형), `isSlotRefreshEntry(name, origin): boolean`.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// tests/slot-refresh-watch.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { SlotRefreshWatch, isSlotRefreshEntry } from "../dist/content/adapter/slot-refresh-watch.js";

const ORIGIN = "https://app.catchtable.co.kr";

function fakeObserverFactory() {
  const state = { callback: null, observed: null, disconnected: 0 };
  const factory = (callback) => {
    state.callback = callback;
    return {
      observe: (options) => { state.observed = options; },
      disconnect: () => { state.disconnected += 1; },
    };
  };
  return { state, factory };
}

test("slot refresh entries match only the time-slots path", () => {
  assert.equal(isSlotRefreshEntry("https://ct-api.catchtable.co.kr/api/reservation/v1/dining/time-slots?shopRef=x", ORIGIN), true);
  assert.equal(isSlotRefreshEntry("https://ct-api.catchtable.co.kr/api/reservation/v1/dining/day-slots", ORIGIN), false);
  assert.equal(isSlotRefreshEntry("not a url", ORIGIN), false);
});

test("watch fires onArrival once per matching entry and stops cleanly", () => {
  const { state, factory } = fakeObserverFactory();
  const watch = new SlotRefreshWatch(factory, ORIGIN);
  const arrivals = [];
  watch.start(() => arrivals.push(1));
  assert.deepEqual(state.observed, { type: "resource", buffered: false });
  state.callback([
    { name: "https://ct-api.catchtable.co.kr/api/reservation/v1/dining/time-slots?shopRef=x" },
    { name: "https://app.catchtable.co.kr/api/v3/user/lastLoginTime" },
    { name: "https://ct-api.catchtable.co.kr/api/reservation/v1/dining/time-slots?shopRef=y" },
  ]);
  assert.equal(arrivals.length, 2);
  watch.start(() => arrivals.push(9)); // 중복 start는 무시
  state.callback([{ name: "https://ct-api.catchtable.co.kr/api/reservation/v1/dining/time-slots" }]);
  assert.equal(arrivals.length, 3);
  assert.equal(arrivals.includes(9), false);
  watch.stop();
  assert.equal(state.disconnected, 1);
  watch.stop(); // 중복 stop 무해
  assert.equal(state.disconnected, 1);
});
```

- [ ] **Step 2: RED 확인** — `wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run build >/dev/null 2>&1; node --test tests/slot-refresh-watch.test.mjs"` → 모듈 없음으로 FAIL.

- [ ] **Step 3: 구현**

```ts
// src/content/adapter/slot-refresh-watch.ts
export interface SlotRefreshWatchPort {
  start(onArrival: () => void): void;
  stop(): void;
}

type ResourceEntryLike = { name: string };
type ObserverLike = { observe(options: { type: string; buffered: boolean }): void; disconnect(): void };
type ObserverFactory = (callback: (entries: ResourceEntryLike[]) => void) => ObserverLike;

// 실측(site-behavior §8.1): 슬롯 목록은 ct-api 호스트의 이 경로로만 온다.
// URL에 날짜가 없어 도착 신호는 날짜 불문 — 검증은 감지 스캔이 담당한다.
const SLOT_REFRESH_PATH_SUFFIX = "/dining/time-slots";

export function isSlotRefreshEntry(name: string, origin: string): boolean {
  try {
    return new URL(name, origin).pathname.endsWith(SLOT_REFRESH_PATH_SUFFIX);
  } catch {
    return false;
  }
}

export class SlotRefreshWatch implements SlotRefreshWatchPort {
  private observer: ObserverLike | null = null;

  constructor(private readonly createObserver: ObserverFactory, private readonly origin: string) {}

  start(onArrival: () => void): void {
    if (this.observer) return;
    const observer = this.createObserver((entries) => {
      for (const entry of entries) {
        if (isSlotRefreshEntry(entry.name, this.origin)) onArrival();
      }
    });
    observer.observe({ type: "resource", buffered: false });
    this.observer = observer;
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}

export function createSlotRefreshWatch(): SlotRefreshWatchPort {
  return new SlotRefreshWatch(
    (callback) => new PerformanceObserver((list) => callback(list.getEntries() as unknown as ResourceEntryLike[])),
    location.origin,
  );
}
```

- [ ] **Step 4: GREEN 확인** — 동일 명령 → 2 테스트 PASS. `npm run check` 전체 green.
- [ ] **Step 5: 커밋** — `git add src/content/adapter/slot-refresh-watch.ts tests/slot-refresh-watch.test.mjs && git commit -m "feat: add slot refresh watch adapter over resource timing"`

---

### Task 2: 오케스트레이터 콰이어스 + 도착 버스트

**Files:**
- Modify: `src/content/orchestrator.ts` — `Dependencies`(±L44-64), `RunSession` 필드(±L120-131), `execute()`(±L206-234), 감지 루프(±L524-544), `advanceFromSlot`(±L554-560), `ToggleCycleTrace`/`toggleCycleAttributes`(±L681-729), `slotDetectedEventData`(±L730-755)
- Test: `tests/orchestrator.test.mjs` — 하네스 확장 + 신규 3 테스트

**Interfaces:**
- Consumes: Task 1의 `SlotRefreshWatchPort`(import type).
- Produces: `Dependencies.slotWatch?: SlotRefreshWatchPort`(옵셔널 — 미주입 시 완전 현행 동작), SLOT_DETECTED data 신규 필드 `xhrArrivalServerAtMs`·`arrivalToDetectMs`, DATE_TOGGLE_CYCLE attrs 신규 필드 `watch`("live"|"idle")·`arrivalAt`(number|null).

- [ ] **Step 1: 하네스 확장 + 실패하는 테스트 3개 작성**

하네스(`harness()`): 옵션에 `readSlots = null` 추가, 본문에 아래 추가. 기존 `slots` 정의를 교체:

```js
// 옵션: readSlots = null,  (시그니처에 추가)
let arrivalCallback = null;
const slotWatchCalls = { started: 0, stopped: 0 };
const slotWatch = {
  start: (cb) => { slotWatchCalls.started += 1; arrivalCallback = cb; },
  stop: () => { slotWatchCalls.stopped += 1; },
};
const slotCtx = {
  get now() { return now; },
  get cycles() { return cycles; },
  scans: 0,
  fireArrival: () => arrivalCallback?.(),
};
const slots = {
  readAvailableSlots: () => {
    slotCtx.scans += 1;
    if (readSlots) return readSlots(slotCtx);
    return cycles >= slotAfterCycles ? [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }] : [];
  },
  clickSlot: () => { slotClicks += 1; return clickResult; },
};
```

orchestrator 생성 인자에 `slotWatch,` 추가. 반환 객체에 `slotWatchCalls, fireArrival: () => arrivalCallback?.(),` 추가.

**중요(폴백 가드):** 하네스가 항상 침묵 watch를 주입하므로, 신호가 없으면 기존 모든 타이밍 단언(`adjacentTimingServerAtMs=960` 등)이 무수정으로 통과해야 한다 — 이것이 폴백 회귀 테스트다.

신규 테스트 3개 (`test("dry-run detects...")` 앞에 삽입):

```js
test("slot watch is started once per run and stopped when the run finishes", async () => {
  const h = harness({ slotAfterCycles: 1 });
  await h.orchestrator.start(config());
  assert.equal(h.slotWatchCalls.started, 1);
  assert.equal(h.slotWatchCalls.stopped, 1);
});

test("an arrival during detection extends the scan burst and records xhr metrics", async () => {
  let arrivalAt = null;
  const h = harness({
    readSlots: (ctx) => {
      if (ctx.scans === 1) { ctx.fireArrival(); arrivalAt = ctx.now; return []; }
      if (arrivalAt !== null && ctx.now >= arrivalAt + 50) {
        return [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }];
      }
      return [];
    },
  });
  const result = await h.orchestrator.start(config());
  assert.equal(result.state, "DRY_RUN_COMPLETED");
  const detected = h.events.find((event) => event.data?.state === "SLOT_DETECTED");
  assert.equal(detected?.data?.xhrArrivalServerAtMs, arrivalAt);
  assert.ok(detected?.data?.arrivalToDetectMs >= 50, `arrivalToDetectMs=${detected?.data?.arrivalToDetectMs}`);
});

test("a live watch quiesces the next toggle until the timeout when no arrival comes", async () => {
  // 사이클1 스캔 중 도착 신호 1회(watch live 전환) 후 침묵 → 사이클2는
  // 그리드가 아니라 목표클릭+700ms까지 기다렸다가 다음 토글로 넘어가야 한다.
  const h = harness({
    readSlots: (ctx) => {
      if (ctx.scans === 1) ctx.fireArrival();
      return ctx.cycles >= 3 ? [{ key: "slot:1140", minutes: 1140, label: "오후 7:00" }] : [];
    },
  });
  const result = await h.orchestrator.start(config());
  assert.equal(result.state, "DRY_RUN_COMPLETED");
  const targets = h.dateClickTimes.filter((c) => c.date === "2026-07-30");
  const adjacents = h.dateClickTimes.filter((c) => c.date === "2026-07-29");
  assert.ok(adjacents.length >= 3 && targets.length >= 2);
  const gap = adjacents[2].at - targets[1].at;
  assert.ok(gap >= 700, `quiesce gap=${gap}`);
});
```

- [ ] **Step 2: RED 확인** — `node --test tests/orchestrator.test.mjs` → 신규 3개 FAIL(기존은 전부 PASS 유지 확인).

- [ ] **Step 3: 구현**

(a) import + Dependencies + 상수:

```ts
import type { SlotRefreshWatchPort } from "./adapter/slot-refresh-watch.js";

// Dependencies에 추가 (captureSnapshot 아래):
  slotWatch?: SlotRefreshWatchPort;

// 모듈 상수 (TERMINAL 근처):
// 실측(site-behavior §8.1): 클릭→XHR 발사 217~379ms + 왕복 ~60ms → 도착은
// 클릭 후 ~450ms 안. 700ms는 유실 판정 타임아웃, 250ms는 응답→렌더(56~182ms) 커버.
const QUIESCE_TIMEOUT_MS = 700;
const ARRIVAL_BURST_MS = 250;
```

(b) RunSession 필드 + execute() 라이프사이클:

```ts
// 필드 (adjacentDate 아래):
  private watchLive = false;
  private lastArrivalAt: number | null = null;

// execute()의 try 첫 줄(CONFIGURED transition 직전)에:
    this.deps.slotWatch?.start(() => {
      this.watchLive = true;
      if (this.serverClockReady) this.lastArrivalAt = this.serverClock.now();
    });
// finally 블록에 (flushTrace 앞):
      this.deps.slotWatch?.stop();
```

(c) 감지 루프(현행 L524-544 교체) — 3-모드 데드라인:

```ts
    const nextPlan = nextTogglePlan(serverClock.now(), config.openAtMs, config.toggleIntervalMs);
    const gridDetectUntil = Math.min(nextPlan.adjacentClickAtMs, config.stopAtMs);
    // watch가 살아 있으면: 도착 전엔 클릭+700ms까지 콰이어스(토글이 비행 중
    // 응답의 렌더를 밟는 것을 방지 — worklog 12 실오픈 +1303ms의 원인),
    // 도착 후엔 도착+250ms까지 렌더 스캔 버스트. 신호가 없던 실행은 현행 그리드.
    const quiesceUntil = Math.min(targetClickedAt + QUIESCE_TIMEOUT_MS, config.stopAtMs);
    const detectDeadline = () => {
      if (!this.watchLive) return gridDetectUntil;
      const arrival = this.lastArrivalAt;
      if (arrival !== null && arrival >= targetClickedAt) {
        return Math.min(arrival + ARRIVAL_BURST_MS, config.stopAtMs);
      }
      return quiesceUntil;
    };
    let candidate: SlotCandidate | null = null;
    const inspectSlots = () => { /* 기존 그대로 */ };
    while (!controller.signal.aborted && serverClock.now() < detectDeadline()) {
      candidate = inspectSlots();
      if (candidate) break;
      const delay = Math.min(25, detectDeadline() - serverClock.now());
      if (delay <= 0 || !(await this.deps.sleep(delay, controller.signal))) break;
    }
```

(d) 계측 — `advanceFromSlot`의 SLOT_DETECTED data 호출과 `slotDetectedEventData`:

```ts
// advanceFromSlot:
      data: slotDetectedEventData(slotDetectedAt, this.adjacentTiming, this.targetTiming, config.openAtMs, this.lastArrivalAt),

// slotDetectedEventData: 파라미터 `arrivalAt: number | null` 추가, openDeltaMs 다음에 삽입
// (trace-view 일반 이벤트는 앞 6개 속성만 보이므로 앞쪽에 배치):
    ...(arrivalAt !== null ? {
      xhrArrivalServerAtMs: arrivalAt,
      arrivalToDetectMs: Math.round(slotDetectedAt - arrivalAt),
    } : {}),
```

(e) DATE_TOGGLE_CYCLE 계측 — `ToggleCycleTrace`에 `watch: string; arrivalAt: number | null;` 추가, `toggleCycleAttributes` 반환에 `watch: t.watch, arrivalAt: t.arrivalAt,` 추가, `runToggleCycle`의 traceCycle attributes 인자에 `watch: this.watchLive ? "live" : "idle", arrivalAt: this.lastArrivalAt,` 추가.

- [ ] **Step 4: GREEN 확인** — `node --test tests/orchestrator.test.mjs` 전부 PASS → `npm run check` 전체 green.
- [ ] **Step 5: 커밋** — `git commit -m "feat: quiesce toggles on slot xhr arrival and burst-scan renders"`

---

### Task 3: 배선 + E2E 검증(R4 확정)

**Files:**
- Modify: `src/content/index.ts:8` import 블록, `:42` orchestrator deps
- Modify: `docs/worklog/HANDOFF.md`, Create: `docs/worklog/2026-07-12-13-xhr-watch.md`

- [ ] **Step 1: 배선**

```ts
import { createSlotRefreshWatch } from "./adapter/slot-refresh-watch.js";
// deps에 (postSlot 아래):
    slotWatch: createSlotRefreshWatch(),
```

- [ ] **Step 2: `npm run check` green 확인 후 커밋** — `git commit -m "feat: wire slot refresh watch into the content composition root"`

- [ ] **Step 3: E2E (use-chrome-devtools 스킬)** — ① 확장 관리 페이지에서 새로고침(dist 재로드), ② 이시즈에에서 openAt=현재+1~2분 dry-run 실행, ③ IndexedDB에서 해당 run의 DATE_TOGGLE_CYCLE attrs 확인:
  - `watch: "live"` 확인 → **R4(격리 월드 가시성) 확정.** site-behavior §8.1 미확정 항목 갱신.
  - `watch: "idle"`만 보이면 → R4 실패. 콰이어스는 비활성(폴백 동작 확인)이고, 스펙 §3 방식 C(webRequest) 재평가로 회귀 — worklog에 기록하고 중단.
  - SLOT_DETECTED에 `xhrArrivalServerAtMs`·`arrivalToDetectMs` 기록 확인, openDelta 비교.

- [ ] **Step 4: 문서** — worklog 13(방법·수치·R4 판정), HANDOFF 갱신(다음: 실오픈런에서 +500ms 이하 검증, 2단계 선발사 판단), site-behavior §8.1 R4 갱신. 커밋 `docs: record xhr watch E2E and R4 verdict`.
