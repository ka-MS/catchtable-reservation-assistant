# B+C. 실패 스냅샷 · 스냅샷 일반화 설계

**기준일:** 2026-07-12
**선행:** `10-scope.md`(B/C 범위), `20-design.md`(A RunSession 구조). A 완료 브랜치 위에 스택됨.
**범위:** B(실패 스냅샷) + C(스냅샷 일반화). 한 몸이라 함께 설계.

## 동기 (실사용 근거)

2026-07-12 실전 런에서 `RUN_TERMINATED · 알 수 없는 단계 화면은 자동 진행하지 않습니다 · postSlotCertainty=unknown · dialogUrlKind=shop`가 발생했다. post-slot은 스냅샷을 찍었지만 그 다이얼로그의 `label`·`title`이 비어 "무슨 화면인지" 식별이 어려웠다. 그리고 entry/calendar/person 단계가 포기하면 DOM 증거가 전혀 없다.

## 목표

실패·포기·예외 순간의 DOM 증거를 구조적으로 남긴다. 전 단계(entry/calendar/person/waitForOpen/toggle/post-slot)와 예외 경로를 커버한다.

## 확정된 결정

1. **범위: 전 단계 일반화** — post-slot뿐 아니라 모든 포기 전이 + throw 예외.
2. **캡처 모델: 단일 범용 캡처** — 새 `captureSnapshot()` 포트 하나를 실패/포기/catch 지점에서만 호출. 어댑터 `inspect()` 시그니처·테스트는 안 건드린다.
3. **출력: 터미널 전이 `data`(RunEvent)에 flatten 첨부** — post-slot 선례와 동일. 사이드패널 이벤트 로그 + trace(`RUN_TERMINATED`/`RUN_FAILED`)에 자동 표시. 새 trace code 없음.
4. **성능: 실패 시에만** — 성공 경로에는 캡처 분기 자체가 없다.

## 컴포넌트

### `StageSnapshot` + `captureStageSnapshot(document)` (신규 `src/content/adapter/snapshot.ts`)

단계 무관 순수 리더. 기존 `dom.ts`(`isElementHidden`·`cleanText`)와 `post-slot-inspection.ts`(`findActiveDialog`·`findRequestSheet`·`normalized`)를 재사용한다.

```ts
export interface StageSnapshot {
  urlKind: "shop" | "reservation_form" | "other";
  headings: string[];        // 보이는 h1/h2/[role="heading"] 텍스트 (각 safeText 80자)
  buttons: string[];         // 보이는 button 텍스트
  disabledButtonCount: number;
  dialogLabel: string;       // 활성 dialog 또는 presentation sheet의 aria-label
  dialogTitle: string;       // 활성 dialog/sheet의 첫 heading 텍스트
  textSnippet: string;       // ★ 활성 dialog/sheet(없으면 main)의 가시 텍스트 앞 160자
  fingerprint: string;       // 위 필드 정규화 해시 (post-slot fingerprint와 동일 알고리즘)
}

export function captureStageSnapshot(document: Document): StageSnapshot;
```

- 활성 컨테이너 선택: `findActiveDialog` → 없으면 `findRequestSheet` → 없으면 `document.querySelector("main")` → 없으면 `document.body`.
- `textSnippet`은 컨테이너 `textContent`를 `cleanText` 후 160자 절단. 개인정보 최소화를 위해 입력값(input value)은 포함하지 않는다(textContent는 폼 입력값을 포함하지 않음).
- `headings`/`buttons`는 최대 각 8개로 제한(로그 비대 방지).
- `fingerprint`는 urlKind+headings+buttons+dialogLabel+dialogTitle 구조 해시(textSnippet 제외 — 내용 변동에 안정적).

### `stageSnapshotData(snapshot)` flatten 빌더 (orchestrator.ts, `postSlotEventData` 옆)

```ts
function stageSnapshotData(s: StageSnapshot): NonNullable<RunEvent["data"]> {
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

## 포트 · 배선

`Dependencies`에 옵셔널 추가(`trace?`와 동일 패턴 — 미주입 시 무동작):

```ts
captureSnapshot?(): StageSnapshot | null;
```

`content/index.ts`가 주입:
```ts
captureSnapshot: () => { try { return captureStageSnapshot(document); } catch { return null; } },
```
캡처 실패가 실행을 막지 않도록 주입부에서 try/catch. 옵셔널이라 기존 orchestrator 테스트(미주입)는 무영향.

## RunSession 배선 — 헬퍼 중앙집중

포기 전이가 25곳에 흩어져 있으므로 헬퍼로 중앙화한다. `finish`/`finishStopped` 옆에 추가:

```ts
private snapshotData(extra?: RunEvent["data"]): RunEvent["data"] {
  const snapshot = this.deps.captureSnapshot?.() ?? null;
  const base = snapshot ? stageSnapshotData(snapshot) : {};
  return { ...base, ...extra };   // stage-specific(extra)가 generic 위에 보강
}

private handOff(reason: string, extra?: RunEvent["data"]): RunResult {
  this.transition("HANDED_OFF", reason, { data: this.snapshotData(extra) });
  return this.finish();
}

private timedOut(reason: string): RunResult {
  this.transition("TIMED_OUT", reason, { data: this.snapshotData() });
  return this.finish();
}
```

교체 규칙:
- `this.transition("HANDED_OFF", msg); return this.finish();` → `return this.handOff(msg);`
- post-slot의 stage-specific data 첨부부(`postSlotEventData(...)`)는 `return this.handOff(msg, postSlotEventData(inspection))` 형태로 **generic + 도메인 진단 병합**.
- `this.transition("TIMED_OUT", msg); return this.finish();` → `return this.timedOut(msg);`
- `stopOrTimeout`의 TIMED_OUT/STOPPED 분기도 `timedOut`/`finishStopped` 사용으로 통일(STOPPED는 사용자 중지라 스냅샷 불필요 — 기존대로 finishStopped 유지, 스냅샷 없음).
- **STOPPED(사용자 중지)·성공 종료(SLOT_SELECTED→post-slot 성공, DRY_RUN_COMPLETED)에는 스냅샷을 붙이지 않는다.** 실패/포기만.

예외 경로 — `execute()` catch:
```ts
this.deps.trace?.("RUN_FAILED", "error", message, {
  serverAt: this.serverClockReady ? this.serverClock.now() : null,
  state: "FAILED",
  attributes: snapshotAttributes(this.deps.captureSnapshot?.() ?? null),
  error,
});
this.transition("FAILED", message, { data: this.snapshotData() });
```
`snapshotAttributes`는 `stageSnapshotData`와 동일 필드를 `TraceAttributes`로(둘 다 평면 Record라 사실상 동일 — 한 함수로 공유).

## 사이드패널 표시

[event-format.ts](src/sidepanel/event-format.ts) `formatEventMessage`에 unknown post-slot 진단 표시가 이미 있다. generic 스냅샷용으로 `formatEventDetail`에 한 줄 추가:

```
스냅샷: <dialogTitle||dialogLabel||"제목 없음"> · 버튼 <snapshotButtons||"없음"> · "<snapshotTextSnippet 앞 40자>…"
```
`snapshotFingerprint`가 있을 때만 렌더. 기존 post-slot 진단 라인과 중복되지 않게, post-slot 전용 키(dialogButtons 등)와 generic 키(snapshotButtons)를 구분.

## 테스트 전략

- `tests/snapshot-adapter.test.mjs`(신규): jsdom fixture로 `captureStageSnapshot` — (1) 활성 dialog에서 label/title/buttons/textSnippet 추출, (2) label·title 빈 dialog에서 textSnippet으로 식별 정보 확보(실사용 unknown 재현), (3) dialog 없을 때 main 폴백, (4) headings/buttons 8개 상한, (5) fingerprint 안정성(textSnippet 변해도 불변).
- `stageSnapshotData`/`snapshotAttributes` flatten: 순수 단위 테스트.
- `tests/orchestrator.test.mjs`: `captureSnapshot` 목을 주입한 **새 케이스** 추가 — 포기 전이(예: entry 데드라인 HANDED_OFF, 토글 SETUP_INVALID) 시 이벤트 data에 `snapshotFingerprint`가 실리는지. 기존 18개는 미주입이라 그대로 통과.
- `tests/event-format.test.mjs`: generic 스냅샷 라인 렌더.

## 비목표

- 어댑터 DOM 쿼리 중복 제거(D)는 별도. 단, `captureStageSnapshot`이 `findActiveDialog` 등을 재사용하며 자연스럽게 일부 공통화에 기여한다.
- 스냅샷의 서버 전송·별도 저장 포맷 변경 없음(기존 trace/RunEvent 경로 재사용).
- 캡처 대상 확대(스크린샷·전체 DOM 덤프) 안 함 — 텍스트 요약만.

## 동작 보존

- `captureSnapshot` 옵셔널 → 미주입 시 기존 동작 완전 동일(스냅샷 없음). 기존 orchestrator 18 테스트 무수정 통과가 그 게이트.
- 포기 전이의 **상태·메시지·기존 data 키는 그대로**, generic 스냅샷 키만 추가된다. post-slot의 기존 진단 키도 유지.

## 베이스 브랜치 의존성

`codex/feat-failure-snapshot`은 `codex/refactor-orchestrator-session`(A) 위에 스택되고, 그건 다시 `codex/fix-postslot-timeout-diagnostics` 위에 있다. 병합 순서: postslot → A → 이 브랜치.
