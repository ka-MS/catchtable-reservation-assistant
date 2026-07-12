# D. 어댑터 DOM 쿼리 중복 제거 설계

**기준일:** 2026-07-12 (개정)
**선행:** `10-scope.md`(D 범위). A·B/C·post-slot·nav-guard가 모두 main에 병합된 상태에서 진행.
**범위:** D만. 동작 무변경(behavior-neutral) 순수 구조 리팩터.
**브랜치:** `codex/refactor-adapter-dom` (main 기준).

## 목표

5개 어댑터(entry/calendar/person/slots/post-slot/post-slot-inspection)와 snapshot에 흩어진 DOM 조회·텍스트·해시 인라인 중복을 `dom.ts` 리프 헬퍼로 모으고, dialog/sheet 파인더를 중립 모듈로 분리해 어댑터 간 교차 의존을 없앤다.

## 성공 기준

- 기존 어댑터 테스트(entry/calendar/person/slot/post-slot-adapter, snapshot-adapter) **무수정 통과**.
- `npm run check` + `git diff --check` 통과.
- entry·snapshot이 더 이상 `post-slot-inspection`을 import하지 않는다(교차 의존 제거).

## 비목표

- 어댑터의 관측 로직·판정 규칙·선택자 변경 없음(순수 추출/이동).
- Port 인터페이스·오케스트레이터 무변경.
- 새 기능 없음.

## 현재 중복 실태 (실측)

| 패턴 | 중복 위치 |
|---|---|
| `Array.from(root.querySelectorAll(sel)).filter(el => !isElementHidden(el))` | post-slot-inspection `visibleElements`, snapshot `visible`(동일 함수 2벌), entry(dock), calendar(cells/month/control), person(choices), post-slot(6곳+) |
| `el.disabled \|\| el.getAttribute("aria-disabled") === "true"` | entry `isDisabled`, person(인라인 2), snapshot(인라인), post-slot-inspection(인라인), calendar(인라인), post-slot `isDisabled`(제네릭 변형) |
| `cleanText(value).slice(0, 80)` = `safeText` | post-slot-inspection, snapshot (동일 2벌) |
| FNV 해시 `0x811c9dc5 … Math.imul(…, 0x01000193)` | post-slot-inspection `fingerprint`(prefix `ps-`), snapshot `hash`(prefix `ss-`, 숫자 정규화 추가) |
| `cleanText(v).toLocaleLowerCase("ko-KR")` | dom `normalizedText`, post-slot-inspection `normalized`(동일) |
| dialog/sheet 파인더 | `findActiveDialog`·`findRequestSheet`·`findPromoDismissButton`(post-slot-inspection), `findVisiblePresentationSheet`(snapshot) — entry·snapshot·post-slot이 post-slot-inspection에서 import(교차 의존) |

## 설계

### 1. `dom.ts` 리프 헬퍼 확장

기존(`isElementHidden`/`cleanText`/`normalizedText`)에 추가:

```ts
// 보이는 요소만
export function visibleAll<T extends Element>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector)).filter((el) => !isElementHidden(el));
}

// disabled 판정 (제네릭 — post-slot 버전이 표준: 임의 Element 허용)
// 기존 변형들과 결과 동일: OR이므로 검사 순서는 무관.
export function isDisabled(element: Element): boolean {
  return element.getAttribute("aria-disabled") === "true"
    || ("disabled" in element && (element as HTMLButtonElement | HTMLInputElement).disabled);
}

// 안전 텍스트 (정규화 + 길이 제한)
export function safeText(value: string | null | undefined, max = 80): string {
  return cleanText(value).slice(0, max);
}

// FNV-1a 해시 (hex만 반환; prefix·숫자정규화는 호출부 책임)
export function fnvHash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
```

**해시 호환성 주의(동작 보존 핵심):**
- post-slot `fingerprint(value)` → `` `ps-${fnvHash(value)}` `` (기존과 동일 산출).
- snapshot 해시 → `` `ss-${fnvHash(value.replace(/\d+/g, "#"))}` `` (숫자 정규화를 호출부에서 적용, 기존과 동일).
- prefix·정규화 위치를 바꾸면 fingerprint 값이 달라지므로 위 형태를 정확히 지킨다.

### 2. 신규 `dialog.ts` (파인더 중립 모듈)

`findActiveDialog`·`findRequestSheet`·`findVisiblePresentationSheet`·`findPromoDismissButton`를 이 파일로 이관한다. dom.ts의 `visibleAll`·`normalizedText`·`isDisabled`를 사용한다. 실측 주석(§7.2 등)은 함께 옮긴다.

- `findActiveDialog(document)`: `[role="dialog"]` 중 보이는 것, 렌더된 것 우선(getClientRects), 마지막.
- `findRequestSheet(document)`: 보이는 `div[role="presentation"]` 중 "레스토랑 확인이 필요한 예약" 제목 보유.
- `findVisiblePresentationSheet(document)`: 보이는 presentation 중 제목/버튼 보유(범용).
- `findPromoDismissButton(document)`: "다음에 볼게요" 버튼.

`isZeroDepositControl`은 post-slot 전용 판정이므로 post-slot-inspection에 남긴다(파인더 아님). 단 내부에서 쓰던 로컬 `normalized`가 제거되므로 `dom.normalizedText`를 import해 쓴다.

### 3. 소비자 갱신

- **post-slot-inspection.ts**: 로컬 `visibleElements`/`safeText`/`fingerprint`/`normalized`/파인더 정의 삭제 → `dom.ts`·`dialog.ts`에서 import. `createFingerprint`는 `` `ps-${fnvHash(...)}` ``로.
- **snapshot.ts**: 로컬 `visible`/`safeText`/`hash`/`findVisiblePresentationSheet` 삭제 → import. 해시는 `` `ss-${fnvHash(normalized)}` `` 형태 유지.
- **entry.ts**: 로컬 `isDisabled` 삭제 → `dom.isDisabled`. dock 조회 `visibleAll`. `findPromoDismissButton`은 `dialog.ts`에서 import(post-slot-inspection 의존 제거).
- **person.ts**: 인라인 disabled(radio) → `dom.isDisabled`, `input[type="radio"]` 조회 → `visibleAll`.
- **calendar.ts**: 월 이동 버튼의 `control.disabled || aria-disabled` → `dom.isDisabled`. **셀의 `available`(`aria-disabled !== "true"`)·`selected`(`aria-pressed`)는 그대로 둔다** — div의 가용성·선택 의미이지 "버튼 disabled"가 아니다. `!isDisabled(div)`와 산출은 같으나 의도가 흐려지므로 치환하지 않는다(과도한 일반화 금지). 셀·컨트롤 조회는 `visibleAll` 적용.
- **post-slot.ts**: 로컬 `isDisabled` 삭제 → `dom.isDisabled`. visible 조회 `visibleAll`. 파인더는 `dialog.ts`에서 import.
- **slots.ts**: `main button[data-busy]` 조회는 `busy/hidden/disabled` 커스텀 필터라 `visibleAll`과 규칙이 다르다 → **그대로 둔다**(억지 통합 금지, YAGNI).

### 4. import 방향

```
dom.ts (리프)  ←  dialog.ts (파인더)
   ↑                 ↑
   └──── 어댑터들 (entry/calendar/person/post-slot/post-slot-inspection/snapshot)
```
어댑터 → 어댑터 의존은 사라진다. dom.ts는 아무것도 import 안 함(리프). dialog.ts는 dom.ts만.

## 검증 전략

- 순수 이동/추출이므로 **기존 어댑터 테스트가 회귀 가드**(entry/calendar/person/slot/post-slot/snapshot-adapter 무수정 통과).
- **해시 잠금 테스트 필수(빈틈 보완).** 현재 post-slot-adapter·snapshot-adapter는 fingerprint의 **접두사만**(`/^ps-/`, `startsWith("ss-")`) 단언하고 정확한 해시 값은 검증하지 않는다. 따라서 `fnvHash` 추출이 알고리즘을 미세하게 바꿔도 기존 테스트로는 안 걸린다. 신규 `tests/dom-helpers.test.mjs`에서:
  - `fnvHash("test-input")`가 **고정 hex 값**과 일치(알고리즘 잠금).
  - 대표 문자열에 대해 `ps-${fnvHash(v)}`와 리팩터 전 산출이 같은지 확인(문서에 리팩터 직전 값 1개 핀).
  - `visibleAll`/`isDisabled`/`safeText` 단위 테스트(jsdom fixture).
- 단계별 커밋: dom 헬퍼 추가(+잠금 테스트) → dialog.ts 이관 → 소비자별 교체(파일 단위) → 각 단계 green.
- 각 단계 후 `npm run check`로 전체 그린 유지. dedup은 되돌리기 쉬우므로 한 파일씩 교체·검증한다.

## 조정 의존성 (해소됨)

postslot·A·B/C·nav-guard가 2026-07-12 모두 main에 병합됐다(181 테스트 green). D가 리팩터할 `snapshot.ts`·`post-slot-inspection.ts` 등이 이제 안정 상태이므로 **D는 main에서 바로 착수 가능**하다. 다른 세션과 같은 파일을 동시에 만지지 않도록만 조율한다.

## 브랜치

`codex/refactor-adapter-dom`(main 기준). 완료 후 검증하고 main에 병합한다.
