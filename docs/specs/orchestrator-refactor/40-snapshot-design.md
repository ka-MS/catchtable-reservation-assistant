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
2. **캡처 모델: 단일 범용 캡처** — `captureSnapshot?()` 옵셔널 포트(`trace?`·`flushTrace?`와 동일 패턴) 하나를 실패/포기/catch 지점에서만 호출. 어댑터 `inspect()` 시그니처·테스트는 안 건드린다.
3. **출력: 터미널 전이 `data`(RunEvent)에 flatten 첨부** — post-slot 선례와 동일. 사이드패널 이벤트 로그 + trace(`RUN_TERMINATED`/`RUN_FAILED`)에 실린다. 단 사이드패널 렌더는 자동이 아니므로 `event-format.ts`를 명시적으로 고친다(§사이드패널 표시). 새 trace code 없음.
4. **성능: 실패 시에만** — 성공 경로에는 캡처 분기 자체가 없다.
5. **정상 인계 vs 실패 인계 구분** — 스냅샷은 **실패/포기**에만. 정상 종료 HANDED_OFF 2곳(postSlotEnabled=false로 슬롯까지만, 예약 폼 정상 도착)에는 스냅샷을 붙이지 않는다. waitingOnly는 diagnostic(우리 판독 검증에 도움)로 분류.
6. **PII 최소화** — snippet은 활성 dialog/sheet에서만. main/body 폴백은 heading·button 구조만(snippet 없음). `reservation_form` URL에서는 snippet 금지. 수집한 snippet은 전화·이메일 패턴 마스킹.
7. **실패 단계 식별** — 터미널 전이 **직전** `this.machine.state`를 `snapshotRunState`로 함께 남긴다(별도 상태 관리 불필요).

## 컴포넌트

### `StageSnapshot` + `captureStageSnapshot(document)` (신규 `src/content/adapter/snapshot.ts`)

단계 무관 순수 리더. 기존 `dom.ts`(`isElementHidden`·`cleanText`)와 `post-slot-inspection.ts`(`findActiveDialog`·`findRequestSheet`·`normalized`)를 재사용한다.

```ts
export interface StageSnapshot {
  urlKind: "shop" | "reservation_form" | "other";
  headings: string[];        // 보이는 h1/h2/[role="heading"] 텍스트 (각 safeText 80자, 최대 8)
  buttons: string[];         // 보이는 button 텍스트 (최대 8)
  disabledButtons: boolean[];// 버튼별 disabled 상태 (fingerprint용)
  disabledButtonCount: number;
  dialogLabel: string;       // 활성 dialog 또는 presentation sheet의 aria-label
  dialogTitle: string;       // 활성 dialog/sheet의 첫 heading 텍스트
  textSnippet: string;       // 활성 dialog/sheet에서만 (마스킹·160자). main/body·form이면 ""
  fingerprint: string;       // 구조 해시 (숫자 정규화, textSnippet 제외)
}

export function captureStageSnapshot(document: Document): StageSnapshot;
```

- 활성 컨테이너 선택: `findActiveDialog` → 없으면 `findRequestSheet` → 없으면 `document.querySelector("main")` → 없으면 `document.body`.
- **`textSnippet`은 활성 dialog/sheet가 있을 때만** 채운다. main/body 폴백이거나 `urlKind === "reservation_form"`이면 `""`(빈 문자열). dialog/sheet의 `textContent`를 `cleanText` → 전화(`010-…`, `\d{2,3}-\d{3,4}-\d{4}`)·이메일 마스킹 → 160자 절단.
- `headings`/`buttons`는 최대 각 8개로 제한(로그 비대 방지).
- `disabledButtons`: 보이는 버튼별 disabled 불리언 배열(fingerprint용, 표시 안 함). `disabledButtonCount`는 그 합.
- `fingerprint`는 urlKind+headings+buttons+**disabledButtons**+dialogLabel+dialogTitle 구조 해시. **숫자 정규화**: 해시 입력의 모든 `\d+`를 `#`로 치환한 뒤 계산(금액·인원·날짜가 달라도 구조 동일 화면은 같은 fingerprint). textSnippet은 해시에서 제외.

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

포기 전이가 흩어져 있으므로 헬퍼로 중앙화하되, **정상 인계와 실패 인계를 분리**한다. `finish`/`finishStopped` 옆에 추가:

```ts
// 실패 시점 data: generic 스냅샷 + 전이 직전 단계(snapshotRunState) + stage-specific extra
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
  const data = this.failureData(extra);       // machine.state 읽기 → 그 다음 transition
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

교체 규칙:
- **정상 종료 2곳만 plain `handOff`(스냅샷 없음)**:
  - postSlotEnabled=false → `return this.handOff("후속 선택 자동 진행이 꺼져 있어 슬롯 선택까지만 완료했습니다.");`
  - 폼 도착 → `return this.handOff("예약 폼에 도착했습니다. …", { ...postSlotEventData(inspection), openDeltaMs, timingServerAtMs });` (post-slot 진단 유지, generic 스냅샷 미첨부)
- **나머지 HANDED_OFF 전부 `diagnosticHandOff`** (waitingOnly·데드라인·toggle 실패·unknown·blocked·5초 타임아웃). post-slot 진단 있으면 병합: `return this.diagnosticHandOff(msg, postSlotEventData(inspection));`
- **모든 TIMED_OUT은 `timedOut`** (`stopOrTimeout` timed_out 분기 포함).
- **STOPPED·DRY_RUN_COMPLETED·SLOT_SELECTED에는 스냅샷 없음** — 기존 그대로.

예외 경로 — `execute()` catch. **캡처 1회**만 실행해 trace·transition에 동일 데이터 전달:
```ts
} catch (error) {
  if (!TERMINAL.has(this.machine.state)) {
    const message = error instanceof Error ? error.message : "알 수 없는 실행 오류";
    const failure = this.failureData();   // 캡처 1회
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
`failureData` 산출은 string|number만이라 `TraceAttributes`(string|number|boolean|null) 안전 대입. 캡처 함수 예외는 포트 주입부(content/index.ts) try/catch가 삼켜 `null`을 반환 → 원래 실패를 덮지 않는다.

## 사이드패널 표시

[event-format.ts](../../../src/sidepanel/event-format.ts) `formatEventMessage`에 unknown post-slot 진단 표시가 이미 있다. generic 스냅샷용으로 `formatEventDetail`에 한 줄 추가:

```
스냅샷: <dialogTitle||dialogLabel||"제목 없음"> · 버튼 <snapshotButtons||"없음"> · "<snapshotTextSnippet 앞 40자>…"
```
`snapshotFingerprint`가 있을 때만 렌더. 기존 post-slot 진단 라인과 중복되지 않게, post-slot 전용 키(dialogButtons 등)와 generic 키(snapshotButtons)를 구분.

## 테스트 전략

- `tests/snapshot-adapter.test.mjs`(신규): jsdom fixture로 `captureStageSnapshot` — (1) 활성 dialog에서 label/title/buttons/textSnippet 추출, (2) label·title 빈 dialog에서 textSnippet으로 식별 정보 확보(실사용 unknown 재현), (3) dialog 없을 때 main 폴백, (4) headings/buttons 8개 상한, (5) fingerprint 안정성(textSnippet 변해도 불변).
- `stageSnapshotData`/`snapshotAttributes` flatten: 순수 단위 테스트.
- `tests/orchestrator.test.mjs`: `captureSnapshot` 목을 주입한 **새 케이스** 추가 —
  - 포기 전이(waitingOnly HANDED_OFF) 시 이벤트 data에 `snapshotFingerprint`·`snapshotRunState`가 실리는지.
  - **정상 폼 도착 인계에는 `snapshotFingerprint`가 없는지**(정상/실패 구분 검증).
  - **`captureSnapshot`이 throw해도** 실패 처리가 정상 진행되는지(원래 실패를 안 덮음) — 목이 throw하는 harness 변형. (실운영은 index.ts try/catch가 삼키지만, RunSession이 옵셔널 호출을 안전히 다루는지 확인.)
  - 기존 18개는 미주입이라 그대로 통과.
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
