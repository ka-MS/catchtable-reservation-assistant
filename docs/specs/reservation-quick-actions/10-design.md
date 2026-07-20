# 예약 설정 빠른 동작 — 현재 탭에서 가져오기 / 식당으로 이동하기

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Side Panel "01 언제 예약할까요?" 섹션에 두 버튼을 추가한다. "현재 탭에서 가져오기"는 현재 활성 탭이 캐치테이블 매장 페이지면 URL·(열려 있으면) 선택된 날짜·(선택돼 있으면) 인원을 폼에 반영한다. "식당으로 이동하기"는 폼에 입력된 정보로 준비단계(URL 이동 → 예약창 오픈 → 날짜 클릭 → 인원 선택)를 실제로 수행하고 결과를 보여준다.

**Architecture:** 기존 계층을 그대로 재사용한다. "가져오기"는 새 상태 없는 1회성 조회 메시지 쌍(`FETCH_SHOP_SNAPSHOT`/`READ_SHOP_SNAPSHOT`)만 추가한다 — `RunSupervisor`/`LogicalRun`을 전혀 건드리지 않는다. "이동하기"는 **기존 `PANEL_START`/`PANEL_STOP`를 그대로 사용**한다(RunSupervisor·orchestrator·coordinator·adapter 코드 변경 없음). sidepanel이 기존 `runEvents` 구독으로 준비 완료 시점을 감지해 즉시 `PANEL_STOP`을 보낸다.

**Tech Stack:** 기존과 동일 — TypeScript strict, node:test + jsdom fixture.

## Global Constraints

- `dryRun`은 "식당으로 이동하기"에서 **항상 강제로 `true`**로 보낸다(사용자가 메인 폼에 설정한 값과 무관). `entryMode`도 항상 `"auto"`로 강제한다. 이 두 값은 협상 대상이 아니다 — `orchestrator.ts`의 `dryRun` 체크가 `clickSlot()` 호출보다 먼저 걸리는 유일한 실클릭 방지 지점이기 때문.
- 자동화 경계 불변: 이 기능은 로그인·CAPTCHA·결제·최종 확정을 전혀 건드리지 않는다. "이동하기"가 도달하는 최대 지점은 예약창 진입 확인(`PREPARING_PAGE`)이며, 그 이후로 진행되더라도(감시 실패 시) dry-run이라 슬롯 클릭 없이 자연 종료된다.
- adapter 외 모듈은 `querySelector`를 호출하지 않는다. 새 메서드도 기존 `readCalendarCells()`/`choices()` 파싱을 재사용하고 새 셀렉터를 추가하지 않는다.
- "가져오기"는 **있는 만큼만** 가져온다 — URL은 매장 페이지면 항상 채우고, 날짜/인원은 값이 없으면(달력 미오픈, 인원 미선택) 해당 폼 필드를 건드리지 않는다.
- 각 Task 완료 시 `npm run check` 통과 후 커밋.

---

## 파일 구조

```text
src/background/navigation.ts             # isShopUrl() 추가
src/background/index.ts                  # pageRuntimePort를 공유 변수로 추출, FETCH_SHOP_SNAPSHOT 핸들러 추가
src/content/adapter/calendar.ts          # readSelectedDate() 추가
src/content/adapter/person.ts            # readSelectedCount() 추가
src/content/index.ts                     # READ_SHOP_SNAPSHOT 핸들러 추가
src/shared/types.ts                      # ShopSnapshot, FETCH_SHOP_SNAPSHOT, READ_SHOP_SNAPSHOT 타입 추가
src/sidepanel/form-model.ts              # quickPrepConfig() 추가
src/sidepanel/index.ts                   # 버튼 2개 핸들러, 상태 표시줄
src/sidepanel/sidepanel.html             # 버튼 마크업(URL 필드 아래)
src/sidepanel/sidepanel.css              # .secondary.compact, .field-quick-actions, .quick-status[data-tone]
tests/background-navigation.test.mjs     # isShopUrl 테스트
tests/calendar-adapter.test.mjs          # readSelectedDate 테스트
tests/person-adapter.test.mjs            # readSelectedCount 테스트
tests/form-model.test.mjs                # quickPrepConfig 테스트
```

---

### Task 1: `isShopUrl` — 매장 페이지 판정 (순수 함수)

**Files:**
- Modify: `src/background/navigation.ts`
- Test: `tests/background-navigation.test.mjs`

**Interfaces:**
- Produces: `isShopUrl(url: string | undefined): boolean` — Task 5(background 핸들러)가 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// tests/background-navigation.test.mjs 에 추가
test("isShopUrl accepts only catchtable shop pages", () => {
  assert.equal(isShopUrl("https://app.catchtable.co.kr/ct/shop/mokran"), true);
  assert.equal(isShopUrl("https://app.catchtable.co.kr/ct/shop/mokran?date=260730"), true);
  assert.equal(isShopUrl("https://app.catchtable.co.kr/ct/reservation/form"), false);
  assert.equal(isShopUrl("https://example.com/ct/shop/mokran"), false);
  assert.equal(isShopUrl(undefined), false);
  assert.equal(isShopUrl("not a url"), false);
});
```

(import 문에 `isShopUrl` 추가: `import { navigateTab, sameRestaurant, leftReservationFlow, isShopUrl } from "../dist/background/navigation.js";`)

- [ ] **Step 2: 실패 확인** — Run: `npm run build && node --test tests/background-navigation.test.mjs` / Expected: FAIL(함수 없음).

- [ ] **Step 3: 구현**

```ts
// src/background/navigation.ts에 추가 — validateReservationConfig의 URL 판정(config.ts:47)과 동일 규칙
export function isShopUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.origin === "https://app.catchtable.co.kr" && /^\/ct\/shop\/[^/]+\/?$/.test(parsed.pathname);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm run build && node --test tests/background-navigation.test.mjs` / Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/background/navigation.ts tests/background-navigation.test.mjs && git commit -m "feat: add shop url predicate for quick actions"`

---

### Task 2: Adapter 사실 조회 메서드 — "지금 뭐가 선택돼 있나"

**Files:**
- Modify: `src/content/adapter/calendar.ts`
- Modify: `src/content/adapter/person.ts`
- Test: `tests/calendar-adapter.test.mjs`, `tests/person-adapter.test.mjs`

**Interfaces:**
- Produces: `CalendarAdapter.readSelectedDate(): string | null`, `PersonAdapter.readSelectedCount(): number | null` — Task 4(content 핸들러)가 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// tests/calendar-adapter.test.mjs 에 추가
test("readSelectedDate는 현재 선택된 날짜 셀을 반환한다", async () => {
  const dom = await loadFixture("calendar.html");
  const adapter = new CalendarAdapter(dom.window.document);
  assert.equal(adapter.readSelectedDate(), "2026-07-30"); // fixture의 기존 선택 셀
});

test("readSelectedDate는 선택된 셀이 없으면 null을 반환한다", async () => {
  const dom = await loadFixture("calendar-navigation.html");
  const adapter = new CalendarAdapter(dom.window.document);
  assert.equal(adapter.readSelectedDate(), null);
});
```

```js
// tests/person-adapter.test.mjs 에 추가
test("readSelectedCount는 현재 체크된 라디오 값을 반환한다", async () => {
  // 기존 테스트의 fixture/DOM 구성 방식을 그대로 따른다(파일 상단 helper 참고).
  // 인원 라디오 중 하나에 checked를 설정한 DOM에서 해당 숫자를 반환하는지,
  // 아무것도 checked가 아니면 null을 반환하는지 두 케이스를 검증한다.
});
```

(정확한 fixture/DOM 구성 방식은 각 테스트 파일 상단의 기존 헬퍼를 그대로 따른다 — 새 fixture를 만들지 않는다.)

- [ ] **Step 2: 실패 확인** — Run: `npm run build && node --test tests/calendar-adapter.test.mjs tests/person-adapter.test.mjs` / Expected: FAIL(메서드 없음).

- [ ] **Step 3: 구현**

```ts
// calendar.ts — readCells()가 이미 date+selected를 반환하므로 필터만 추가
readSelectedDate(): string | null {
  return this.readCells().find((cell) => cell.selected)?.date ?? null;
}
```

```ts
// person.ts — choices()가 이미 HTMLInputElement(checked 포함)를 반환하므로 필터만 추가
readSelectedCount(): number | null {
  for (const [value, input] of this.choices()) {
    if (input.checked) return Number(value);
  }
  return null;
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm run build && node --test tests/calendar-adapter.test.mjs tests/person-adapter.test.mjs` / Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/content/adapter/calendar.ts src/content/adapter/person.ts tests/calendar-adapter.test.mjs tests/person-adapter.test.mjs && git commit -m "feat: add current-selection readers to calendar and person adapters"`

---

### Task 3: 메시지 타입 추가

**Files:**
- Modify: `src/shared/types.ts`

**Interfaces:**
- Produces: `ShopSnapshot`, `PanelCommand`에 `FETCH_SHOP_SNAPSHOT`, `ContentCommand`에 `READ_SHOP_SNAPSHOT` — Task 4·5가 사용.

- [ ] **Step 1: 구현** (타입 전용 — 실패하는 테스트 대신 이후 Task의 typecheck가 검증)

```ts
export interface ShopSnapshot {
  url: string;
  selectedDate: string | null;
  selectedPersonCount: number | null;
}
```
`ContentCommand` union에 추가:
```ts
| { type: "READ_SHOP_SNAPSHOT" }
```
`PanelCommand` union에 추가:
```ts
| { type: "FETCH_SHOP_SNAPSHOT" }
```

- [ ] **Step 2: 통과 확인** — Run: `npm run typecheck` / Expected: PASS(다른 Task 구현 전이라 아직 소비처 없음 — 컴파일만 통과하면 됨).
- [ ] **Step 3: Commit** — `git add src/shared/types.ts && git commit -m "feat: add shop snapshot message types"`

---

### Task 4: content — READ_SHOP_SNAPSHOT 핸들러

**Files:**
- Modify: `src/content/index.ts`

**Interfaces:**
- Consumes: Task 2 어댑터 메서드, Task 3 타입.

- [ ] **Step 1: 구현** — `chrome.runtime.onMessage` 리스너에 분기 추가(PING 처리 근처):

```ts
if (message.type === "READ_SHOP_SNAPSHOT") {
  const snapshot: ShopSnapshot = {
    url: location.href,
    selectedDate: new CalendarAdapter(document).readSelectedDate(),
    selectedPersonCount: new PersonAdapter(document).readSelectedCount(),
  };
  sendResponse({ ok: true, data: snapshot });
  return;
}
```
(`CalendarAdapter`/`PersonAdapter`는 이미 파일 상단에 import돼 있다. 새 인스턴스 생성은 상태가 없으므로 orchestrator에 주입된 인스턴스와 공유할 필요가 없다.)

- [ ] **Step 2: 게이트** — Run: `npm run check` / Expected: PASS(이 파일은 기존 관례상 전용 단위 테스트가 없다 — `build-regression.test.mjs`와 전체 게이트로 검증). content 번들에 import 잔존이 없는지는 `check:dist`가 확인한다.
- [ ] **Step 3: Commit** — `git add src/content/index.ts && git commit -m "feat: respond to shop snapshot reads in content script"`

---

### Task 5: background — FETCH_SHOP_SNAPSHOT 핸들러

**Files:**
- Modify: `src/background/index.ts`

**Interfaces:**
- Consumes: Task 1 `isShopUrl`, 기존 `pageRuntimePort`(현재 `RunSupervisor` 생성자에 인라인으로 전달됨 — 공유 변수로 추출 필요).

- [ ] **Step 1: `pageRuntimePort`를 공유 변수로 추출** — `const supervisor = new RunSupervisor({ port: createPageRuntimePort({...}), ... })`를:
```ts
const pageRuntimePort = createPageRuntimePort({ ... }); // 기존 인라인 인자 그대로 이동
const supervisor = new RunSupervisor({ port: pageRuntimePort, ... });
```
(동작 변화 없음 — 변수 추출만.)

- [ ] **Step 2: 핸들러 추가** — `chrome.runtime.onMessage` 리스너에 분기 추가:

```ts
if (message.type === "FETCH_SHOP_SNAPSHOT") {
  void (async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!isShopUrl(tab?.url) || tab.id === undefined) {
      sendResponse({ ok: false, error: "현재 탭이 캐치테이블 매장 페이지가 아닙니다." });
      return;
    }
    try {
      await pageRuntimePort.inject(tab.id);
      const response = await chrome.tabs.sendMessage(tab.id, { type: "READ_SHOP_SNAPSHOT" } satisfies ContentCommand);
      sendResponse({ ok: true, data: response.data as ShopSnapshot });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "현재 탭 정보를 가져올 수 없습니다." });
    }
  })();
  return true;
}
```

- [ ] **Step 3: 게이트 + Commit** — Run: `npm run check` / Expected: PASS. `git commit -am "feat: fetch shop snapshot from the active tab"`

---

### Task 6: sidepanel — 버튼 2개 + 폼 반영 + 준비단계 실행

**Files:**
- Modify: `src/sidepanel/form-model.ts` (`quickPrepConfig` 추가)
- Modify: `src/sidepanel/index.ts` (핸들러 2개, 상태 표시)
- Modify: `src/sidepanel/sidepanel.html` (버튼 마크업)
- Modify: `src/sidepanel/sidepanel.css` (스타일)
- Test: `tests/form-model.test.mjs`

**Interfaces:**
- Consumes: Task 3 `ShopSnapshot`/`FETCH_SHOP_SNAPSHOT`, 기존 `PANEL_START`/`PANEL_STOP`, 기존 `readValues`/`applyValues`/`configFromFormValues`, 기존 `runEvents` storage 구독.

#### 6-1. `quickPrepConfig` (순수 함수, form-model.ts)

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// tests/form-model.test.mjs 에 추가
test("quickPrepConfig는 dryRun과 entryMode를 강제하고 오픈·종료 시각을 현재로 재계산한다", () => {
  const values = { /* 기존 테스트의 유효한 FormValues 샘플 재사용, dryRun:false, entryMode:"prepared"로 설정 */ };
  const config = quickPrepConfig(values, 1_700_000_000_000);
  assert.equal(config.dryRun, true);
  assert.equal(config.entryMode, "auto");
  assert.equal(config.openAtMs, 1_700_000_000_000);
  assert.equal(config.stopAtMs, 1_700_000_000_000 + 300_000);
});
```

- [ ] **Step 2: 실패 확인** — Run: `npm run build && node --test tests/form-model.test.mjs` / Expected: FAIL.

- [ ] **Step 3: 구현**

```ts
// form-model.ts에 추가
const QUICK_PREP_WINDOW_MS = 300_000; // 5분 — 자동 정지 실패 시의 안전망 상한일 뿐, 정상 경로는 수 초 내 종료된다.

export function quickPrepConfig(values: FormValues, nowMs: number): ReservationConfig {
  const config = configFromFormValues(values, nowMs);
  return { ...config, entryMode: "auto", dryRun: true, openAtMs: nowMs, stopAtMs: nowMs + QUICK_PREP_WINDOW_MS };
}
```

- [ ] **Step 4: 통과 확인** — Run: `npm run build && node --test tests/form-model.test.mjs` / Expected: PASS.
- [ ] **Step 5: Commit** — `git add src/sidepanel/form-model.ts tests/form-model.test.mjs && git commit -m "feat: add quick-prep config override for the go-to-shop action"`

#### 6-2. HTML — 버튼 마크업

- [ ] **Step 1: 구현** — `sidepanel.html`의 URL 필드 블록에 버튼 행 삽입(URL input과 grid 사이):

```html
<label class="field wide">
  <span>식당 예약 URL</span>
  <input id="target-url" type="url" required placeholder="https://app.catchtable.co.kr/ct/shop/..." />
</label>
<div class="field-quick-actions" aria-label="식당 URL 빠른 동작">
  <button id="fetch-shop-snapshot" class="primary compact" type="button">
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="4" width="18" height="14" rx="2"></rect>
      <path d="M8 22h8"></path>
      <path d="M12 8v6"></path>
      <path d="m9.5 11.5 2.5 2.5 2.5-2.5"></path>
    </svg>
    현재 탭에서 가져오기
  </button>
  <button id="go-to-shop" class="secondary compact" type="button"
    title="입력한 정보로 예약창 진입까지만 실제로 확인합니다. 슬롯 클릭·결제는 하지 않습니다.">
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round">
      <path d="M14 3h7v7"></path>
      <path d="M10 14 21 3"></path>
      <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"></path>
    </svg>
    식당으로 이동하기
  </button>
</div>
<p id="quick-action-status" class="quick-status" aria-live="polite" hidden></p>
```
(SVG 2종은 참고 mockup의 아이콘을 그대로 재사용 — 범용 모노라인 아이콘으로 브랜드 요소 없음.)

- [ ] **Step 2: Commit** — `git add src/sidepanel/sidepanel.html && git commit -m "feat: add quick action button markup"`

#### 6-3. CSS — 기존 색상 토큰 재사용

- [ ] **Step 1: 구현** — `sidepanel.css`에 추가(기존 `.primary`/`.secondary`의 색을 그대로 쓰고 mockup 자체 색상 `--accent` 등은 도입하지 않는다 — 이 앱은 다크모드가 없는 라이트 전용이라 기존 하드코딩 색과 100% 통일):

```css
.secondary.compact {
  width: auto;
  padding: 8px 14px;
  font-size: 13px;
}

.field-quick-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 8px;
}

.field-quick-actions button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}

.field-quick-actions svg {
  width: 15px;
  height: 15px;
  flex: 0 0 auto;
}

.quick-status {
  margin: 6px 2px 0;
  font-size: 12px;
  line-height: 1.5;
  color: #6d7872;
}

.quick-status[data-tone="success"] { color: #166c4d; }
.quick-status[data-tone="error"] { color: #b42318; }
.quick-status[hidden] { display: none; }
```

- [ ] **Step 2: Commit** — `git add src/sidepanel/sidepanel.css && git commit -m "feat: style quick action buttons with existing palette"`

#### 6-4. TS — 핸들러

**"현재 탭에서 가져오기"**: 있는 만큼만 반영 — URL은 항상, 날짜·인원은 `null`이 아닐 때만.

```ts
const fetchButton = byId<HTMLButtonElement>("fetch-shop-snapshot");
const goButton = byId<HTMLButtonElement>("go-to-shop");
const quickStatus = byId<HTMLElement>("quick-action-status");

function setQuickStatus(message: string, tone?: "success" | "error"): void {
  quickStatus.textContent = message;
  quickStatus.hidden = false;
  if (tone) quickStatus.dataset.tone = tone; else delete quickStatus.dataset.tone;
}

fetchButton.addEventListener("click", async () => {
  const response = await send({ type: "FETCH_SHOP_SNAPSHOT" });
  if (!response.ok) {
    setQuickStatus(response.error ?? "현재 탭 정보를 가져올 수 없습니다.", "error");
    return;
  }
  const snapshot = response.data as ShopSnapshot;
  fields.targetUrl.value = snapshot.url;
  const filled: string[] = ["URL"];
  if (snapshot.selectedDate) { fields.reservationDate.value = snapshot.selectedDate; filled.push("날짜"); }
  if (snapshot.selectedPersonCount !== null) { fields.personCount.value = String(snapshot.selectedPersonCount); filled.push("인원"); }
  renderSummary();
  saveDraft();
  setQuickStatus(`${filled.join("·")}을(를) 가져왔습니다.`, "success");
});
```

**"식당으로 이동하기"**: 기존 `readValues`/`quickPrepConfig`/`PANEL_START`/`PANEL_STOP`만 재사용. 상태 전이 감시는 이미 있는 `chrome.storage.onChanged`의 `runEvents` 분기에 **한 번만 반응하는 조건**을 추가한다(별도 폴링 없음).

```ts
const PREP_STOP_STATES = new Set(["PREPARING_PAGE", "HANDED_OFF", "TIMED_OUT", "FAILED", "STOPPED"]);
let watchingPrepTest = false;

goButton.addEventListener("click", async () => {
  goButton.disabled = true;
  setQuickStatus("예약창 진입을 확인하는 중…");
  const config = quickPrepConfig(readValues(), Date.now());
  const response = await send({ type: "PANEL_START", config });
  if (!response.ok) {
    setQuickStatus(response.error ?? "실행을 시작할 수 없습니다.", "error");
    goButton.disabled = false;
    return;
  }
  watchingPrepTest = true;
});

// 기존 storage.onChanged의 runEvents 처리부(renderRuntime 호출 직후)에 추가:
if (watchingPrepTest) {
  const last = latestEvents.at(-1);
  const state = last?.data?.state;
  if (typeof state === "string" && PREP_STOP_STATES.has(state)) {
    watchingPrepTest = false;
    void send({ type: "PANEL_STOP" });
    const tone = state === "PREPARING_PAGE" ? "success" : "error";
    setQuickStatus(last!.message, tone);
    goButton.disabled = false;
  }
}
```

(정확한 삽입 위치는 기존 `chrome.storage.onChanged` 리스너 안의 `renderRuntime(...)` 호출 다음 줄 — `latestEvents`는 이미 `renderRuntime`이 갱신해둔 모듈 스코프 변수를 그대로 읽는다.)

**버튼 비활성화 상태 재사용**: 이미 있는 `running` 계산(`renderRuntime` 안)을 참조해 `fetchButton.disabled = running`, `goButton.disabled = running || watchingPrepTest`로 기존 실행 중 가드에 합류시킨다.

- [ ] **Step 2: 게이트 + Commit** — Run: `npm run check` / Expected: PASS. `git add src/sidepanel/index.ts && git commit -m "feat: wire quick action buttons to shop snapshot and prep-only run"`

---

### Task 7: 수동/E2E 확인 + 문서

- [ ] **Step 1: Chrome DevTools 수동 확인** (`use-chrome-devtools` 스킬) — ① 매장 페이지 탭에서 "현재 탭에서 가져오기" 클릭 → URL만 채워짐(달력 미오픈) 확인 → 달력 열고 날짜 선택 후 다시 클릭 → 날짜까지 채워짐 확인 → 인원 선택 후 다시 클릭 → 인원까지 채워짐 확인. ② 매장 아닌 탭에서 클릭 → 에러 문구 확인. ③ "식당으로 이동하기" 클릭 → 실제 준비단계 진행 관측 → `PREPARING_PAGE` 도달 즉시 자동 정지 확인 → IndexedDB에서 해당 run이 `dryRun:true`로 기록됐는지 확인. ④ 정체 상황(날짜 클릭 차단)에서 클릭 → `HANDED_OFF` 메시지가 상태 표시줄에 그대로 뜨는지 확인.
- [ ] **Step 2: 문서** — `docs/specs/README.md`에 패키지 추가, worklog 작성.
- [ ] **Step 3: 최종 게이트** — Run: `npm run check && git diff --check`.

---

## Self-Review

- 자동화 경계: 이 기능이 만지는 상태 전이는 `CONFIGURED`~`PREPARING_PAGE`뿐이며, 그 이후 진행되더라도 `dryRun:true`가 실클릭을 원천 차단한다(§Global Constraints).
- 재사용 범위: `RunSupervisor`/`PageRuntimePort`(inject 제외)/`orchestrator`/coordinator 3종/`state-machine.ts` 전부 무변경. 새 코드는 순수 조회(어댑터 2메서드, `isShopUrl`, `quickPrepConfig`)와 기존 메시지 재사용(`PANEL_START`/`PANEL_STOP`) 배선뿐이다.
- "있는 만큼만 가져오기"는 Task 6-4의 `if (snapshot.selectedDate)`/`if (snapshot.selectedPersonCount !== null)` 개별 조건으로 보장된다.
