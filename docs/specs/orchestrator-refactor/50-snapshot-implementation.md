# B+C. 실패 스냅샷 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 실패·포기·예외 순간의 DOM 증거를 단일 범용 캡처로 남겨 전 단계에 걸쳐 관측한다.

**Architecture:** 신규 `captureStageSnapshot(document)`가 단계 무관 DOM 요약(`StageSnapshot`)을 만든다. `Dependencies.captureSnapshot?()` 옵셔널 포트로 주입하고, RunSession의 `handOff`/`timedOut` 헬퍼가 실패 사이트를 중앙집중해 스냅샷을 터미널 전이 `data`에 flatten 첨부한다.

**Tech Stack:** TypeScript(MV3 content script), node:test, jsdom.

## Global Constraints

- 설계: `docs/specs/orchestrator-refactor/40-snapshot-design.md`
- 게이트: `wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check"` + `git diff --check`
- **성능 무영향**: 스냅샷은 실패/포기/catch 지점에서만. 성공 경로에 캡처 분기 없음.
- `captureSnapshot`은 **옵셔널 포트** — 미주입 시 기존 동작 완전 동일(기존 orchestrator 18 테스트 무수정 통과가 게이트).
- STOPPED·DRY_RUN_COMPLETED·SLOT_SELECTED, **그리고 정상 인계 2곳(postSlotEnabled=false·폼 도착)**에는 스냅샷 안 붙임. 실패/포기만 `diagnosticHandOff`/`timedOut`.
- 개인정보: snippet은 **활성 dialog/sheet에서만**·전화/이메일 마스킹·`reservation_form`이면 금지. main/body는 구조(heading·button)만. snippet 160자·headings/buttons 각 8개 상한.
- fingerprint: 버튼별 disabled 포함 + 숫자 정규화(`\d+`→`#`).
- `snapshotRunState`(전이 직전 machine.state)를 실패 data에 포함.
- 베이스: `codex/feat-failure-snapshot`(A 브랜치 `codex/refactor-orchestrator-session` 위 스택). 착수 시 전체 166 green 확인.

---

### Task 1: `captureStageSnapshot` + `StageSnapshot` (신규 어댑터)

**Files:**
- Create: `src/content/adapter/snapshot.ts`
- Test: `tests/snapshot-adapter.test.mjs`
- Test fixtures: `tests/fixtures/snapshot-unknown-dialog.html`, `tests/fixtures/snapshot-no-dialog.html`

**Interfaces:**
- Consumes: `isElementHidden`,`cleanText`(dom.js); `findActiveDialog`,`findRequestSheet`,`normalized`(post-slot-inspection.js)
- Produces: `interface StageSnapshot { urlKind: "shop"|"reservation_form"|"other"; headings: string[]; buttons: string[]; disabledButtonCount: number; dialogLabel: string; dialogTitle: string; textSnippet: string; fingerprint: string }`; `captureStageSnapshot(document: Document): StageSnapshot`

- [ ] **Step 1: fixture 작성**

`tests/fixtures/snapshot-unknown-dialog.html` — label·title 없는 dialog(실사용 unknown 재현). 마스킹 검증용 전화번호 포함:
```html
<!doctype html><html><body>
<main><h1>레스토랑</h1></main>
<div role="dialog">
  <p>예약 확정을 위해 추가 확인이 필요합니다. 담당자 010-1234-5678로 곧 연락드립니다.</p>
  <button>확인</button>
  <button disabled>취소</button>
</div>
</body></html>
```
`tests/fixtures/snapshot-no-dialog.html` — dialog 없음(main 폴백, snippet 없어야 함):
```html
<!doctype html><html><body>
<main><h2>예약 가능한 시간</h2><button>오후 7:00</button><button>오후 7:30</button></main>
</body></html>
```

- [ ] **Step 2: 실패 테스트 작성** — `tests/snapshot-adapter.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";
import { loadFixture } from "./fixture-helper.mjs";
import { captureStageSnapshot } from "../dist/content/adapter/snapshot.js";

test("captures an unknown dialog with empty label via text snippet, masking phone", async () => {
  const dom = await loadFixture("snapshot-unknown-dialog.html");
  const s = captureStageSnapshot(dom.window.document);
  assert.equal(s.urlKind, "shop");
  assert.equal(s.dialogLabel, "");
  assert.equal(s.dialogTitle, "");
  assert.match(s.textSnippet, /추가 확인이 필요합니다/);
  assert.doesNotMatch(s.textSnippet, /010-1234-5678/);   // 전화 마스킹
  assert.deepEqual(s.buttons, ["확인", "취소"]);
  assert.deepEqual(s.disabledButtons, [false, true]);
  assert.equal(s.disabledButtonCount, 1);
  assert.ok(s.fingerprint.startsWith("ss-"));
});

test("main fallback collects structure only, no snippet", async () => {
  const dom = await loadFixture("snapshot-no-dialog.html");
  const s = captureStageSnapshot(dom.window.document);
  assert.deepEqual(s.headings, ["예약 가능한 시간"]);
  assert.equal(s.textSnippet, "");   // main 폴백은 snippet 없음
  assert.equal(s.dialogLabel, "");
});

test("fingerprint normalizes dynamic numbers", async () => {
  const dom = await loadFixture("snapshot-unknown-dialog.html");
  const doc = dom.window.document;
  const button = doc.querySelector('[role="dialog"] button');
  button.textContent = "50,000원 확인";
  const first = captureStageSnapshot(doc).fingerprint;
  button.textContent = "70,000원 확인";
  const second = captureStageSnapshot(doc).fingerprint;
  assert.equal(first, second);   // 금액만 달라진 동일 구조 → 같은 fingerprint
});

test("caps headings and buttons at eight", async () => {
  const dom = await loadFixture("snapshot-no-dialog.html");
  const doc = dom.window.document;
  const main = doc.querySelector("main");
  for (let i = 0; i < 12; i += 1) {
    const b = doc.createElement("button");
    b.textContent = `b${i}`;
    main.append(b);
  }
  const s = captureStageSnapshot(doc);
  assert.equal(s.buttons.length, 8);
});

test("fingerprint ignores text snippet changes", async () => {
  const dom = await loadFixture("snapshot-unknown-dialog.html");
  const doc = dom.window.document;
  const first = captureStageSnapshot(doc).fingerprint;
  doc.querySelector('[role="dialog"] p').textContent = "완전히 다른 안내 문구입니다.";
  const second = captureStageSnapshot(doc).fingerprint;
  assert.equal(first, second);
});
```

- [ ] **Step 3: 실행해 실패 확인**

Run: `wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run build >/dev/null 2>&1; node --test tests/snapshot-adapter.test.mjs 2>&1 | tail -4"`
Expected: FAIL (모듈 없음)

- [ ] **Step 4: 구현** — `src/content/adapter/snapshot.ts`

```ts
import { cleanText, isElementHidden } from "./dom.js";
import { findActiveDialog, findRequestSheet, normalized } from "./post-slot-inspection.js";

export interface StageSnapshot {
  urlKind: "shop" | "reservation_form" | "other";
  headings: string[];
  buttons: string[];
  disabledButtons: boolean[];
  disabledButtonCount: number;
  dialogLabel: string;
  dialogTitle: string;
  textSnippet: string;
  fingerprint: string;
}

const MAX_ITEMS = 8;
const SNIPPET_LEN = 160;

function urlKind(document: Document): StageSnapshot["urlKind"] {
  if (document.location.pathname === "/ct/reservation/form") return "reservation_form";
  if (document.location.pathname.startsWith("/ct/shop/")) return "shop";
  return "other";
}

function safeText(value: string | null | undefined): string {
  return cleanText(value).slice(0, 80);
}

function maskPii(value: string): string {
  return value
    .replace(/\d{2,3}-\d{3,4}-\d{4}/g, "###-####-####")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "###@###");
}

function visible<T extends Element>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector)).filter((el) => !isElementHidden(el));
}

function hash(value: string): string {
  // 동적 숫자를 지워 구조 동일 화면이 같은 fingerprint를 받게 한다.
  const normalized = value.replace(/\d+/g, "#");
  let h = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i += 1) {
    h ^= normalized.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `ss-${(h >>> 0).toString(16).padStart(8, "0")}`;
}

export function captureStageSnapshot(document: Document): StageSnapshot {
  const dialogEl = findActiveDialog(document) ?? findRequestSheet(document);
  const container: ParentNode = dialogEl ?? document.querySelector("main") ?? document.body;
  const headings = visible<HTMLElement>(container, 'h1, h2, [role="heading"]')
    .map((el) => safeText(el.textContent)).filter(Boolean).slice(0, MAX_ITEMS);
  const buttonEls = visible<HTMLButtonElement>(container, "button").slice(0, MAX_ITEMS);
  const buttons = buttonEls.map((b) => safeText(b.textContent)).filter(Boolean);
  const disabledButtons = buttonEls.map((b) => b.disabled || b.getAttribute("aria-disabled") === "true");
  const disabledButtonCount = disabledButtons.filter(Boolean).length;
  const kind = urlKind(document);
  const dialogLabel = dialogEl ? safeText(dialogEl.getAttribute("aria-label")) : "";
  const dialogTitle = dialogEl
    ? safeText(visible<HTMLElement>(dialogEl, 'h1, h2, [role="heading"]').at(0)?.textContent)
    : "";
  // snippet은 활성 dialog/sheet에서만, 예약 폼에서는 금지, 전화·이메일 마스킹.
  const textSnippet = (dialogEl && kind !== "reservation_form")
    ? maskPii(cleanText(dialogEl.textContent)).slice(0, SNIPPET_LEN)
    : "";
  const fingerprint = hash(JSON.stringify({
    kind, headings, buttons, disabledButtons, dialogLabel, dialogTitle,
  }));
  return {
    urlKind: kind,
    headings,
    buttons,
    disabledButtons,
    disabledButtonCount,
    dialogLabel,
    dialogTitle,
    textSnippet,
    fingerprint,
  };
}
```

주의: `container`는 dialog/sheet가 있으면 그것, 없으면 main→body. `dialogLabel`/`dialogTitle`/`textSnippet`은 dialog/sheet가 있을 때만(main 폴백·예약 폼은 빈 문자열). `disabledButtons`는 버튼 8개 상한 이후 슬라이스와 정렬을 맞추려 `buttonEls`를 먼저 8개로 자른 뒤 계산한다.

- [ ] **Step 5: 통과 확인** — 같은 명령, Expected: PASS (4 테스트)

- [ ] **Step 6: Commit** — `feat: add stage-agnostic DOM snapshot capture`

---

### Task 2: `stageSnapshotData` flatten 빌더 + 포트 타입

**Files:**
- Modify: `src/content/orchestrator.ts`
- Test: `tests/snapshot-data.test.mjs`

**Interfaces:**
- Consumes: `StageSnapshot`(snapshot.js)
- Produces: `Dependencies.captureSnapshot?(): StageSnapshot | null`; module fn `stageSnapshotData(s: StageSnapshot | null): NonNullable<RunEvent["data"]>` (null이면 `{}`)

- [ ] **Step 1: 실패 테스트 작성** — `tests/snapshot-data.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";
import { stageSnapshotData } from "../dist/content/orchestrator.js";

const snap = {
  urlKind: "shop", headings: ["레스토랑"], buttons: ["확인", "취소"], disabledButtonCount: 1,
  dialogLabel: "", dialogTitle: "", textSnippet: "추가 확인이 필요합니다", fingerprint: "ss-12345678",
};

test("flattens a snapshot into event data", () => {
  const d = stageSnapshotData(snap);
  assert.equal(d.snapshotUrlKind, "shop");
  assert.equal(d.snapshotButtons, "확인 | 취소");
  assert.equal(d.snapshotHeadings, "레스토랑");
  assert.equal(d.snapshotDisabledButtonCount, 1);
  assert.equal(d.snapshotTextSnippet, "추가 확인이 필요합니다");
  assert.equal(d.snapshotFingerprint, "ss-12345678");
});

test("returns empty object for null snapshot", () => {
  assert.deepEqual(stageSnapshotData(null), {});
});
```

- [ ] **Step 2: 실패 확인** — `node --test tests/snapshot-data.test.mjs` → FAIL (export 없음)

- [ ] **Step 3: 구현** — `orchestrator.ts`

import 추가:
```ts
import { captureStageSnapshot, type StageSnapshot } from "./adapter/snapshot.js";
```
(참고: `captureStageSnapshot`은 orchestrator에서 직접 안 쓰고 content/index.ts가 씀. orchestrator는 타입 `StageSnapshot`만 필요 → `import type { StageSnapshot } from "./adapter/snapshot.js";`로 한다.)

`Dependencies`에 추가(`flushTrace?` 아래):
```ts
  captureSnapshot?(): StageSnapshot | null;
```

`postSlotEventData` 옆에 export 함수 추가:
```ts
export function stageSnapshotData(s: StageSnapshot | null): NonNullable<RunEvent["data"]> {
  if (!s) return {};
  return {
    snapshotUrlKind: s.urlKind,
    snapshotHeadings: s.headings.join(" | "),
    snapshotButtons: s.buttons.join(" | "),
    snapshotDisabledButtonCount: s.disabledButtonCount,
    snapshotDialogLabel: s.dialogLabel,
    snapshotDialogTitle: s.dialogTitle,
    snapshotTextSnippet: s.textSnippet,
    snapshotFingerprint: s.fingerprint,
  };
}
```

- [ ] **Step 4: 통과 확인** — PASS (2 테스트)

- [ ] **Step 5: 게이트** — `npm run check`로 166 green(옵셔널 포트 추가는 기존 무영향) + `git diff --check`

- [ ] **Step 6: Commit** — `feat: add snapshot event-data builder and optional capture port`

---

### Task 3: RunSession 실패/정상 인계 헬퍼 + 사이트 교체

**Files:**
- Modify: `src/content/orchestrator.ts`
- Test: `tests/orchestrator.test.mjs` (신규 케이스 추가만; 기존 18개 무수정)

**Interfaces:**
- Consumes: `stageSnapshotData`, `StageSnapshot`, `Dependencies.captureSnapshot`
- Produces: RunSession `private failureData(extra?)`, `private diagnosticHandOff(reason, extra?): RunResult`, `private handOff(reason, extra?): RunResult`, `private timedOut(reason): RunResult`

- [ ] **Step 1: baseline 확인** — `node --test tests/orchestrator.test.mjs` → pass 18

- [ ] **Step 2: 헬퍼 추가** — `finishStopped` 아래

```ts
private failureData(extra?: RunEvent["data"]): RunEvent["data"] {
  let snapshot: StageSnapshot | null = null;
  try {
    snapshot = this.deps.captureSnapshot?.() ?? null;   // 캡처 예외가 실패 처리를 덮지 않게 guard
  } catch {
    snapshot = null;
  }
  return {
    ...stageSnapshotData(snapshot),
    snapshotRunState: this.machine.state,   // transition 전 = 실패한 단계
    ...extra,
  };
}

private diagnosticHandOff(reason: string, extra?: RunEvent["data"]): RunResult {
  const data = this.failureData(extra);     // machine.state 읽기 → 그 다음 transition
  this.transition("HANDED_OFF", reason, { data });
  return this.finish();
}

private handOff(reason: string, extra?: RunEvent["data"]): RunResult {   // 정상 인계, 스냅샷 X
  this.transition("HANDED_OFF", reason, extra ? { data: extra } : {});
  return this.finish();
}

private timedOut(reason: string): RunResult {
  const data = this.failureData();
  this.transition("TIMED_OUT", reason, { data });
  return this.finish();
}
```

- [ ] **Step 3: 사이트 교체**

메시지 문자열은 **현행 그대로 유지(변경 금지)**. **STOPPED·SLOT_SELECTED·DRY_RUN_COMPLETED는 안 건드린다.**

- `stopOrTimeout`의 timed_out 분기 → `if (result === "timed_out") return this.timedOut("감시 종료 시각에 도달했습니다.");`
- `prepareEntry`/`prepareDate`/`preparePerson`/`confirmPageReady`의 HANDED_OFF·TIMED_OUT: 실패/포기이므로 각각 `return this.diagnosticHandOff(MSG);` / `return this.timedOut(MSG);` (waitingOnly HANDED_OFF 포함 = diagnostic).
- `runToggleCycle` 터미널: `return { kind: "terminal", result: this.diagnosticHandOff(MSG) };` / TIMED_OUT은 `this.timedOut(MSG)`. traceCycle 호출은 전이 앞에 그대로.
- `advanceFromSlot`:
  - TIMED_OUT("클릭 직전…") → `return this.timedOut("클릭 직전 감시 종료 시각에 도달했습니다.");`
  - **postSlotEnabled=false HANDED_OFF는 정상 인계 → `return this.handOff("후속 선택 자동 진행이 꺼져 있어 슬롯 선택까지만 완료했습니다.");`** (스냅샷 없음)
- `advancePostSlot`:
  - **폼 도착 = 정상 인계 → plain `handOff`(스냅샷 없음), post-slot 진단은 유지**:
    `return this.handOff("예약 폼에 도착했습니다. 약관 확인과 최종 예약은 직접 진행하세요.", { ...postSlotEventData(inspection), openDeltaMs: Math.round(formSeenAtMs - config.openAtMs), timingServerAtMs: formSeenAtMs });`
  - unknown = 실패 → `return this.diagnosticHandOff(`${inspection.label} 화면은 자동 진행하지 않습니다.`, postSlotEventData(inspection));`
  - blocked = 실패 → `return this.diagnosticHandOff(action.message, postSlotEventData(inspection));` (기존은 진단 미첨부였음. 기존 테스트가 blocked data를 단언하면 유지 우선 — 확인 후 적용.)
  - 5초 미확인 = 실패 → `return this.diagnosticHandOff("후속 예약 화면을 5초 안에 확인하지 못했습니다.", lastInspection ? postSlotEventData(lastInspection) : undefined);`

- [ ] **Step 4: 예외 경로 — 캡처 1회** — `execute()` catch

```ts
} catch (error) {
  if (!TERMINAL.has(this.machine.state)) {
    const message = error instanceof Error ? error.message : "알 수 없는 실행 오류";
    const failure = this.failureData();   // 캡처 1회 (내부 guard 포함)
    this.deps.trace?.("RUN_FAILED", "error", message, {
      serverAt: this.serverClockReady ? this.serverClock.now() : null,
      state: "FAILED",
      attributes: failure as TraceAttributes,
      error,
    });
    this.transition("FAILED", message, { data: failure });
  }
  return this.finish();
}
```

- [ ] **Step 5: harness에 `captureSnapshot` 주입** — `tests/orchestrator.test.mjs` harness deps(`trace:` 아래)

```ts
    captureSnapshot: () => ({
      urlKind: "shop", headings: [], buttons: ["확인"], disabledButtons: [false],
      disabledButtonCount: 0, dialogLabel: "", dialogTitle: "", textSnippet: "", fingerprint: "ss-test",
    }),
```
기존 18개는 이 필드를 검사하지 않으므로 영향 없음.

- [ ] **Step 6: 신규 테스트 3개 추가** — `tests/orchestrator.test.mjs` 맨 끝

```js
test("attaches a diagnostic snapshot on a waiting-only hand-off", async () => {
  const h = harness({
    entry: { inspect: () => ({ reservationOpen: false, ctaAvailable: false, waitingOnly: true }), openReservation: () => false },
  });
  const result = await h.orchestrator.start(config({ entryMode: "auto" }));
  assert.equal(result.state, "HANDED_OFF");
  const handoff = h.events.find((e) => e.data?.state === "HANDED_OFF");
  assert.equal(handoff?.data?.snapshotFingerprint, "ss-test");
  assert.equal(handoff?.data?.snapshotRunState, "ENTERING_RESERVATION");
});

test("normal form-arrival hand-off carries no snapshot", async () => {
  const h = harness({ slotAfterCycles: 1, postSlot: { inspect: () => ({ kind: "form" }), advance: () => ({ status: "blocked", message: "unused" }) } });
  const result = await h.orchestrator.start(config({ dryRun: false }));   // dryRun off → 슬롯 클릭 → 폼 도착
  assert.equal(result.state, "HANDED_OFF");
  const handoff = h.events.find((e) => e.data?.state === "HANDED_OFF");
  assert.equal(handoff?.data?.snapshotFingerprint, undefined);   // 정상 인계 → 스냅샷 없음
  assert.equal(handoff?.data?.postSlotStage, "form");            // post-slot 진단은 유지
});

test("a throwing captureSnapshot does not mask the give-up", async () => {
  const h = harness({
    entry: { inspect: () => ({ reservationOpen: false, ctaAvailable: false, waitingOnly: true }), openReservation: () => false },
    captureSnapshot: () => { throw new Error("boom"); },
  });
  const result = await h.orchestrator.start(config({ entryMode: "auto" }));
  assert.equal(result.state, "HANDED_OFF");   // 원래 포기가 정상 진행
  const handoff = h.events.find((e) => e.data?.state === "HANDED_OFF");
  assert.equal(handoff?.data?.snapshotFingerprint, undefined);   // 캡처 실패 → 스냅샷 키 없음, snapshotRunState는 있음
  assert.equal(handoff?.data?.snapshotRunState, "ENTERING_RESERVATION");
});
```
`harness`가 `captureSnapshot` override를 받도록 시그니처에 `captureSnapshot` 파라미터를 추가한다(기본값 = Step 5의 목). 폼 도착 케이스는 config `entryMode` 기본 "prepared"라 entry 단계를 건너뛰고 바로 슬롯→폼으로 간다.

- [ ] **Step 7: 게이트** — `npm run check` → pass(기존 18 + 신규 3) + `git diff --check`. 기존 케이스가 깨지면 스냅샷 키가 기존 단언과 충돌하는지 확인(신규 키뿐이라 없어야 정상).

- [ ] **Step 8: Commit** — `feat: capture a diagnostic snapshot on failure give-ups and exceptions`

---

### Task 4: 사이드패널 스냅샷 표시

**Files:**
- Modify: `src/sidepanel/event-format.ts`
- Test: `tests/event-format.test.mjs`

**Interfaces:**
- Consumes: 이벤트 data의 `snapshot*` 키
- Produces: `formatEventDetail`에 스냅샷 라인 추가

- [ ] **Step 1: 실패 테스트 작성** — `tests/event-format.test.mjs`에 추가

```js
test("renders a stage snapshot line", () => {
  const line = formatEventDetail({
    at: 0, serverAt: null, runId: "r", kind: "state", message: "인계",
    data: { state: "HANDED_OFF", snapshotFingerprint: "ss-1", snapshotDialogTitle: "",
      snapshotButtons: "확인 | 취소", snapshotTextSnippet: "추가 확인이 필요합니다 어쩌구 저쩌구" },
  });
  assert.match(line, /스냅샷/);
  assert.match(line, /확인 \| 취소/);
  assert.match(line, /추가 확인이 필요합니다/);
});
```
(파일 상단 import에 `formatEventDetail`이 이미 있는지 확인, 없으면 추가.)

- [ ] **Step 2: 실패 확인** — `node --test tests/event-format.test.mjs` → FAIL

- [ ] **Step 3: 구현** — `formatEventDetail`의 `return lines.join("\n")` 앞에 추가

```ts
if (typeof data?.snapshotFingerprint === "string") {
  const title = data.snapshotDialogTitle || data.snapshotDialogLabel || "제목 없음";
  const buttons = data.snapshotButtons || "없음";
  const snippet = typeof data.snapshotTextSnippet === "string" && data.snapshotTextSnippet
    ? ` · "${String(data.snapshotTextSnippet).slice(0, 40)}"`
    : "";
  lines.push(`스냅샷: ${title} · 버튼 ${buttons}${snippet}`);
}
```

- [ ] **Step 4: 통과 확인** — PASS

- [ ] **Step 5: 게이트** — `npm run check` + `git diff --check`

- [ ] **Step 6: Commit** — `feat: show the failure snapshot in the sidepanel event detail`

---

### Task 5: content/index.ts 배선 + 최종 게이트·문서

**Files:**
- Modify: `src/content/index.ts`
- Create: `docs/worklog/2026-07-12-06-failure-snapshot.md`
- Modify: `docs/worklog/HANDOFF.md`

- [ ] **Step 1: 포트 주입** — `src/content/index.ts`

import 추가:
```ts
import { captureStageSnapshot } from "./adapter/snapshot.js";
```
`OpenRunOrchestrator` 생성 deps에 추가(`trace:`/`flushTrace:` 근처):
```ts
    captureSnapshot: () => {
      try { return captureStageSnapshot(document); } catch { return null; }
    },
```

- [ ] **Step 2: 최종 전체 게이트**

Run: `wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check"` + `git diff --check`
Expected: 전체 pass(기존 166 + 신규 snapshot-adapter 4 + snapshot-data 2 + orchestrator 신규 + event-format 신규), 모든 validation 통과.

- [ ] **Step 3: 워크로그 작성** — `2026-07-12-06-failure-snapshot.md`: 동기(unknown 로그), 수행(captureStageSnapshot·포트·handOff/timedOut 중앙집중·예외 캡처·사이드패널 표시), 검증(게이트·기존 18 무수정), 수동 확인(확장 재로드 후 unknown 유발 화면에서 스냅샷이 이벤트 로그에 textSnippet과 함께 남는지).

- [ ] **Step 4: HANDOFF 갱신** — 현재 상태를 실패 스냅샷 완료로. 다음: postslot→A→이 브랜치 병합 순서, 남은 D(어댑터 중복 제거).

- [ ] **Step 5: Commit** — `docs: record the failure snapshot worklog and handoff`

---

## Self-Review

**Spec coverage:** captureStageSnapshot+StageSnapshot=Task1, flatten+포트=Task2, handOff/timedOut 중앙집중+예외=Task3, 사이드패널=Task4, 배선+문서=Task5. 설계의 컴포넌트·포트·RunSession 배선·출력·표시·테스트 전략 전부 커버.

**Placeholder scan:** 코드 스텝 전부 실제 코드. 사이트 교체는 "현행 메시지 유지" 명시.

**Type consistency:** `StageSnapshot` 필드(Task1)와 `stageSnapshotData` 키(Task2)·이벤트 data 키(Task3)·사이드패널 참조(Task4) 이름 일치(`snapshot*`). `captureSnapshot?(): StageSnapshot | null` 계약 Task2 정의·Task3/5 사용 일치. fingerprint 접두사 `ss-` 일관.

**주의 지점:** Task3에서 blocked 경로에 postSlotEventData 첨부는 기존 테스트가 blocked data를 단언하지 않을 때만 적용(단언 시 유지 우선). 신규 orchestrator 테스트의 waitingOnly HANDED_OFF 케이스가 entryMode auto에서 entry.inspect가 waitingOnly=true를 반환하므로 즉시 인계됨을 이용한다.
