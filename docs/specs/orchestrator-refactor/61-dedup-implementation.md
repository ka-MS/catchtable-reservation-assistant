# D. 어댑터 DOM 쿼리 중복 제거 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 어댑터 5개+snapshot에 흩어진 DOM 조회·텍스트·해시 인라인 중복을 `dom.ts` 리프 헬퍼로 모으고, dialog/sheet 파인더를 신규 `dialog.ts`로 이관해 어댑터 간 교차 의존을 없앤다. 동작 무변경.

**Architecture:** `dom.ts`(리프, import 없음)에 `visibleAll`/`isDisabled`/`safeText`/`fnvHash` 추가 → `dialog.ts`(dom만 import)에 파인더 4개 이관 → 소비자(어댑터들)가 로컬 중복 정의를 지우고 import. 파일 단위로 교체하며 각 단계 그린 유지.

**Tech Stack:** TypeScript(MV3 content script), node:test, jsdom.

## Global Constraints

- 설계: `docs/specs/orchestrator-refactor/60-dedup-design.md`
- **behavior-neutral**: 기존 어댑터 테스트(entry/calendar/person/slot/post-slot/snapshot-adapter) **무수정 통과**. fingerprint·판정 결과 바이트 동일.
- 게이트: `wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check"` + `git diff --check`
- import 방향: `dom.ts`(리프) ← `dialog.ts` ← 어댑터. **어댑터→어댑터 의존 금지.**
- `slots.ts`의 `main button[data-busy]` 조회는 커스텀 필터라 **손대지 않는다**(YAGNI).
- 판정 결과·선택자·관측 로직 변경 없음. 순수 추출/이동만.
- baseline: 착수 시 전체 181개 green (2026-07-12 병합 후).

## FNV 해시 잠금값 (현행 알고리즘, 리팩터 전 계산)

`fnvHash(v)` = `(FNV-1a(v) >>> 0).toString(16).padStart(8,"0")` (prefix·숫자정규화 없음):
- `fnvHash("catchtable-reserve")` → `4ad76c61`
- `fnvHash(JSON.stringify({}))` → `5465b825`
- `fnvHash("50,000원".replace(/\d+/g,"#"))` → `bb9a1cf1`

이 값이 리팩터 후에도 동일해야 한다(알고리즘 보존 증거).

---

### Task 1: `dom.ts` 리프 헬퍼 + 잠금/단위 테스트

**Files:**
- Modify: `src/content/adapter/dom.ts`
- Create: `tests/dom-helpers.test.mjs`
- Test fixture: `tests/fixtures/dom-helpers.html`

**Interfaces:**
- Produces: `visibleAll<T extends Element>(root: ParentNode, selector: string): T[]`, `isDisabled(element: Element): boolean`, `safeText(value: string | null | undefined, max?: number): string`, `fnvHash(value: string): string` (hex 8자, prefix 없음). 기존 `cleanText`/`normalizedText`/`isElementHidden` 유지.

- [ ] **Step 1: baseline 확인**

Run: `wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && node --test tests/*.test.mjs 2>&1 | tail -4"`
Expected: `# pass 181` / `# fail 0` (빌드 후 실행 시)

- [ ] **Step 2: fixture 작성** — `tests/fixtures/dom-helpers.html`

```html
<!doctype html><html><body>
<div id="root">
  <button id="b1">보임</button>
  <button id="b2" disabled>비활성</button>
  <button id="b3" aria-disabled="true">aria 비활성</button>
  <button id="b4" hidden>숨김</button>
  <div id="d1" role="button" aria-disabled="true">div 비활성</div>
  <div id="d2" role="button">div 활성</div>
</div>
</body></html>
```

- [ ] **Step 3: 실패 테스트 작성** — `tests/dom-helpers.test.mjs`

```js
import assert from "node:assert/strict";
import test from "node:test";
import { loadFixture } from "./fixture-helper.mjs";
import { visibleAll, isDisabled, safeText, fnvHash } from "../dist/content/adapter/dom.js";

test("fnvHash locks the current algorithm", () => {
  assert.equal(fnvHash("catchtable-reserve"), "4ad76c61");
  assert.equal(fnvHash(JSON.stringify({})), "5465b825");
  assert.equal(fnvHash("50,000원".replace(/\d+/g, "#")), "bb9a1cf1");
  assert.match(fnvHash("x"), /^[0-9a-f]{8}$/);
});

test("visibleAll returns only rendered elements", async () => {
  const dom = await loadFixture("dom-helpers.html");
  const root = dom.window.document.getElementById("root");
  const ids = visibleAll(root, "button").map((b) => b.id);
  assert.deepEqual(ids, ["b1", "b2", "b3"]);   // b4(hidden) 제외
});

test("isDisabled covers form disabled and aria-disabled on any element", async () => {
  const dom = await loadFixture("dom-helpers.html");
  const doc = dom.window.document;
  assert.equal(isDisabled(doc.getElementById("b1")), false);
  assert.equal(isDisabled(doc.getElementById("b2")), true);
  assert.equal(isDisabled(doc.getElementById("b3")), true);
  assert.equal(isDisabled(doc.getElementById("d1")), true);   // div + aria-disabled
  assert.equal(isDisabled(doc.getElementById("d2")), false);  // div, disabled 속성 없음
});

test("safeText normalizes whitespace and caps length", () => {
  assert.equal(safeText("  가  나  "), "가 나");
  assert.equal(safeText("a".repeat(100)).length, 80);
  assert.equal(safeText("a".repeat(100), 10).length, 10);
  assert.equal(safeText(null), "");
});
```

- [ ] **Step 4: 실행해 실패 확인**

Run: `wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run build >/dev/null 2>&1; node --test tests/dom-helpers.test.mjs 2>&1 | tail -4"`
Expected: FAIL (export 없음)

- [ ] **Step 5: `dom.ts`에 헬퍼 추가**

기존 `isElementHidden` 아래에 추가:
```ts
export function visibleAll<T extends Element>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector)).filter((el) => !isElementHidden(el));
}

export function isDisabled(element: Element): boolean {
  return element.getAttribute("aria-disabled") === "true"
    || ("disabled" in element && (element as HTMLButtonElement | HTMLInputElement).disabled);
}

export function safeText(value: string | null | undefined, max = 80): string {
  return cleanText(value).slice(0, max);
}

export function fnvHash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
```

- [ ] **Step 6: 통과 확인** — 같은 명령, Expected: PASS (4 테스트)

- [ ] **Step 7: 커밋** — `feat: add shared dom leaf helpers (visibleAll/isDisabled/safeText/fnvHash)`

---

### Task 2: 신규 `dialog.ts` (파인더 중립 모듈)

**Files:**
- Create: `src/content/adapter/dialog.ts`
- Modify: `src/content/adapter/post-slot-inspection.ts` (파인더 정의 제거 → 재export)
- Modify: `src/content/adapter/snapshot.ts` (로컬 `findVisiblePresentationSheet` 제거 → import)

**Interfaces:**
- Consumes: `dom.ts`의 `isElementHidden`/`normalizedText`/`visibleAll`
- Produces (`dialog.ts` export): `findActiveDialog(document): HTMLElement | null`, `findRequestSheet(document): HTMLElement | null`, `findVisiblePresentationSheet(document): HTMLElement | null`, `findPromoDismissButton(document): HTMLButtonElement | null`

- [ ] **Step 1: baseline** — `node --test tests/*.test.mjs` → pass (Task1 포함 185)

- [ ] **Step 2: `dialog.ts` 작성**

`post-slot-inspection.ts`의 `findActiveDialog`·`findRequestSheet`·`findPromoDismissButton` 본문과 실측 주석을 그대로 옮기고, `snapshot.ts`의 `findVisiblePresentationSheet` 본문을 옮긴다. `normalized` 대신 `normalizedText`, 로컬 visible 필터 대신 `visibleAll` 사용:

```ts
import { isElementHidden, normalizedText, visibleAll } from "./dom.js";

export function findActiveDialog(document: Document): HTMLElement | null {
  const candidates = visibleAll<HTMLElement>(document, '[role="dialog"]');
  const rendered = candidates.filter((dialog) => dialog.getClientRects().length > 0);
  return (rendered.length > 0 ? rendered : candidates).at(-1) ?? null;
}

// 실측 2026-07-12 이시즈에 (site-behavior §7.2): 승인제 안내는 role="dialog" 없이
// role="presentation" 바텀시트로 뜬다. 제목 h2가 유일한 안정 앵커다.
export function findRequestSheet(document: Document): HTMLElement | null {
  return visibleAll<HTMLElement>(document, 'div[role="presentation"]')
    .find((sheet) => visibleAll<HTMLElement>(sheet, 'h1, h2, [role="heading"]')
      .some((heading) => normalizedText(heading.textContent).includes("레스토랑 확인이 필요한 예약"))) ?? null;
}

// 알려진 승인제 시트뿐 아니라 임의의 보이는 presentation 바텀시트(제목 또는 버튼 보유)를 잡는다.
export function findVisiblePresentationSheet(document: Document): HTMLElement | null {
  return visibleAll<HTMLElement>(document, 'div[role="presentation"]')
    .filter((sheet) => visibleAll<HTMLElement>(sheet, 'h1, h2, [role="heading"]').length > 0
      || visibleAll<HTMLButtonElement>(sheet, "button").length > 0)
    .at(-1) ?? null;
}

// 실측 2026-07-12 이시즈에 (site-behavior §7.2): 홍보 인터스티셜은 role 계열 속성이 전혀 없어
// 닫기 버튼 텍스트만 안정 앵커다.
export function findPromoDismissButton(document: Document): HTMLButtonElement | null {
  return visibleAll<HTMLButtonElement>(document, "button")
    .find((button) => normalizedText(button.textContent) === "다음에 볼게요" && !isDisabled(button)) ?? null;
}
```
주의: `findPromoDismissButton`은 기존이 `!button.disabled && aria-disabled !== "true"`였으므로 `isDisabled`를 import해 `!isDisabled(button)`으로 맞춘다(동일 결과). import에 `isDisabled` 추가.

- [ ] **Step 3: `post-slot-inspection.ts`에서 파인더 제거 → dialog.ts 재export**

로컬 `findActiveDialog`/`findRequestSheet`/`findPromoDismissButton` 정의를 삭제하고 상단에 추가:
```ts
export { findActiveDialog, findRequestSheet, findPromoDismissButton } from "./dialog.js";
```
(post-slot.ts·entry.ts가 여전히 post-slot-inspection에서 import 중이므로 재export로 하위호환 유지. Task 4에서 소비자를 dialog.ts 직접 import로 바꾼 뒤 이 재export는 남겨도 무방하나, 교차 의존 제거 목표상 소비자 전환 후 재export도 정리한다.)

- [ ] **Step 4: `snapshot.ts` 로컬 파인더 제거 → import**

`findVisiblePresentationSheet` 로컬 정의 삭제. import를:
```ts
import { findActiveDialog, findVisiblePresentationSheet } from "./dialog.js";
```
(기존 `import { findActiveDialog } from "./post-slot-inspection.js";` 교체 → 교차 의존 제거)

- [ ] **Step 5: 게이트** — `npm run check` → pass 185, `git diff --check`. snapshot-adapter의 presentation-sheet·fingerprint 테스트가 그대로 통과하는지 확인.

- [ ] **Step 6: 커밋** — `refactor: move dialog/sheet finders into a neutral dialog module`

---

### Task 3: `post-slot-inspection.ts`·`post-slot.ts` 내부 중복 제거

**Files:**
- Modify: `src/content/adapter/post-slot-inspection.ts`
- Modify: `src/content/adapter/post-slot.ts`

**Interfaces:**
- Consumes: `dom.ts`의 `visibleAll`/`safeText`/`fnvHash`/`normalizedText`/`isDisabled`

- [ ] **Step 1: baseline** — pass 185

- [ ] **Step 2: `post-slot-inspection.ts` 로컬 헬퍼 → dom 사용**

- 로컬 `visibleElements` 삭제 → 모든 사용처를 `visibleAll`로 (import 추가).
- 로컬 `safeText` 삭제 → `dom.safeText`.
- 로컬 `normalized` 삭제 → `dom.normalizedText`. `isZeroDepositControl`도 `normalizedText` 사용. **주의:** `normalized`를 다른 파일(post-slot.ts)이 import하므로, 제거 대신 `export { normalizedText as normalized } from "./dom.js";` 재export로 하위호환 유지(Task 4에서 소비자 전환 후 정리).
- 로컬 `fingerprint(value)` 삭제 → `createFingerprint`가 `` `ps-${fnvHash(JSON.stringify({ ...diagnostics, disabledButtons }))}` ``를 직접 반환. (기존 `fingerprint`가 `ps-` prefix를 붙였으므로 동일.)

```ts
import { cleanText, fnvHash, isElementHidden, isDisabled, normalizedText, safeText, visibleAll } from "./dom.js";
// ...
function createFingerprint(diagnostics: PostSlotDiagnostics, disabledButtons: boolean[]): string {
  return `ps-${fnvHash(JSON.stringify({ ...diagnostics, disabledButtons }))}`;
}
```

- [ ] **Step 3: `post-slot.ts` 로컬 isDisabled → dom.isDisabled**

로컬 `isDisabled` 정의(28–31행) 삭제. import에 `isDisabled` 추가(`dom.js`에서). `normalized`는 당분간 post-slot-inspection 재export로 유지되므로 기존 import 그대로 둔다(Task 4에서 정리).

- [ ] **Step 4: 게이트** — `npm run check` → pass 185, `git diff --check`. **post-slot-adapter 테스트의 fingerprint(`/^ps-/`)가 통과 + Task1 잠금 테스트로 해시 동일성 보증.**

- [ ] **Step 5: 커밋** — `refactor: use shared dom helpers in post-slot inspection`

---

### Task 4: `entry.ts`·`person.ts`·`calendar.ts`·`snapshot.ts` 소비자 전환 + 교차 의존 정리

**Files:**
- Modify: `src/content/adapter/entry.ts`, `person.ts`, `calendar.ts`, `snapshot.ts`, `post-slot.ts`, `post-slot-inspection.ts`

**Interfaces:**
- Consumes: `dom.ts`, `dialog.ts`

- [ ] **Step 1: baseline** — pass 185

- [ ] **Step 2: `entry.ts`**

- 로컬 `isDisabled` 삭제 → `dom.isDisabled`.
- dock 버튼 조회를 `visibleAll`로.
- `findPromoDismissButton`을 `post-slot-inspection` 대신 `dialog.js`에서 import (교차 의존 제거).

- [ ] **Step 3: `person.ts`**

- radio 조회 `visibleAll<HTMLInputElement>('input[type="radio"][name="personCount"]')`, 인라인 disabled → `dom.isDisabled`.

- [ ] **Step 4: `calendar.ts`**

- 월 이동 버튼 disabled 검사 → `dom.isDisabled`. 버튼·셀 조회 → `visibleAll`.
- **셀 `available`(`aria-disabled !== "true"`)·`selected`(`aria-pressed`)는 그대로 유지**(가용성·선택 의미, isDisabled로 치환 금지).

- [ ] **Step 5: `snapshot.ts`**

- 로컬 `visible`·`safeText` 삭제 → `dom.visibleAll`·`dom.safeText`. 해시는 `` `ss-${fnvHash(JSON.stringify({...}).replace(/\d+/g, "#"))}` ``로 (로컬 `hash` 삭제, `fnvHash` import). maskPii·MAX_ITEMS·SNIPPET_LEN·textSnippet 로직은 유지.

- [ ] **Step 6: 교차 의존 재export 정리**

- `post-slot.ts`: `normalized`를 `dom.normalizedText`로 직접 import(재export 의존 끊기). 파인더도 `dialog.js`에서 import.
- `post-slot-inspection.ts`: Task2/3에서 넣은 재export(`findActiveDialog`... , `normalized`)가 이제 소비자 없으면 삭제. **단 `inspectPostSlot`·`isZeroDepositControl`·타입은 계속 export.** 소비자 여부를 `grep`으로 확인 후 미사용 재export만 제거.

- [ ] **Step 7: 게이트** — `npm run check` → pass 185, `git diff --check`. 그리고 교차 의존 제거 확인:

Run: `wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && grep -n 'post-slot-inspection' src/content/adapter/entry.ts src/content/adapter/snapshot.ts"`
Expected: 출력 없음(entry·snapshot이 post-slot-inspection을 import하지 않음).

- [ ] **Step 8: 커밋** — `refactor: point adapters at shared dom/dialog modules and drop cross-adapter deps`

---

### Task 5: 최종 게이트·문서

**Files:**
- Create: `docs/worklog/2026-07-12-07-adapter-dedup.md`
- Modify: `docs/worklog/HANDOFF.md`

- [ ] **Step 1: 최종 전체 게이트**

Run: `wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check"` + `git diff --check`
Expected: 185 pass, dist·독립성 통과.

- [ ] **Step 2: 중복 제거 확인(근거)**

Run: `wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && grep -rn '0x811c9dc5\|function isDisabled\|slice(0, 80)' src/content/adapter/ | grep -v dom.ts"`
Expected: 출력 없음(해시·isDisabled·safeText 인라인 중복이 dom.ts 외엔 남지 않음).

- [ ] **Step 3: 워크로그 작성** — `2026-07-12-07-adapter-dedup.md`: 수행(dom 헬퍼·dialog 모듈·소비자 전환·교차 의존 제거), 검증(185 green 무수정 + 해시 잠금), 동작 보존 근거.

- [ ] **Step 4: HANDOFF 갱신** — D 완료 반영, 다음 후보(XHR 감시 등).

- [ ] **Step 5: 커밋** — `docs: record the adapter dedup worklog and handoff`

---

## Self-Review

**Spec coverage:** dom 헬퍼 4종=Task1, dialog.ts 파인더 이관=Task2, post-slot 내부 중복=Task3, 나머지 소비자+교차 의존 제거=Task4, 해시 잠금 테스트=Task1(필수), slots 제외=Global Constraints, isZeroDepositControl normalizedText 전환=Task3, calendar 셀 스코핑=Task4 Step4. 설계 전 항목 커버.

**Placeholder scan:** 코드 스텝 실제 코드. fnvHash 기대값은 실제 계산값(4ad76c61 등). "본문 그대로 옮긴다"는 원본 파일·함수명 명시로 실행 가능.

**Type consistency:** `fnvHash`(hex, prefix 없음) → post-slot `ps-${...}`·snapshot `ss-${...}` 호출부 접두사 부여 일관. `isDisabled(Element)` 시그니처 Task1 정의·Task3/4 사용 일치. `visibleAll<T>` 제네릭 일관. 파인더 시그니처 dialog.ts 정의·소비자 import 일치.

**주의:** pass 개수(185)는 Task1이 dom-helpers 테스트 4개를 더한 값(181+4). 실제 수치는 실행으로 확인하고 다르면 그 값 기준으로 판단한다.
