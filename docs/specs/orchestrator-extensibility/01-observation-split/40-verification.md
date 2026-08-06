# 01. 관측 분리 검증

**상태:** 완료
**검증일:** 2026-08-07
**브랜치:** `codex/refactor-observation-split`
**부모 패키지:** [오케스트레이터 확장성 기반](../00-index.md)

## 성공 기준 대조

[00-index.md](../00-index.md)와 [20-design.md](20-design.md)가 선언한 기준이다.

| # | 기준 | 결과 |
|---|---|---|
| 1 | 기존 전체 스위트 무수정 통과 | ✅ 540개 무수정, 테스트 파일 변경 0건 |
| 2 | payload golden test 추가 | ✅ 12개 (`observation-payloads.test.mjs`) |
| 3 | 관측 실패 격리 테스트 | ✅ 6개 |
| 4 | 비격리 보존 테스트 | ✅ 4개 |
| 5 | 호출 순서 테스트 | ✅ 4개 |
| 6 | `git diff --check` | ✅ 통과 |
| 7 | Chrome 수동 로드 dry-run | ✅ 실행 2회 — 아래 참조 |
| 8 | 주장 대조 | ✅ 아래 참조 |

## 자동 검증

```
npm run check
  version validation passed: 1.1.2
  typecheck                  통과
  tests 609 / pass 609 / fail 0
  dist validation passed
  independence validation passed  (MAIN/ISOLATED 격리)

git diff --check              통과
```

### 테스트 구성

| 파일 | 개수 | 성격 |
|---|---|---|
| 기존 스위트 | 540 | **무수정** |
| `orchestrator-observation.test.mjs` | 21 | 특성화(baseline 고정) |
| `observation-payloads.test.mjs` | 22 | 순수 함수 golden |
| `observation-run-observer.test.mjs` | 26 | 예외 경계 계약 (리뷰 반영) |
| **합계** | **609** | |

### 왜 기존 테스트만으로는 부족했나

성공 기준 1은 필요조건이지 충분조건이 아니다. 리뷰에서 지적된 대로다.

- `attributes` 객체 **전체**를 고정하는 단언은 기존 스위트 통틀어 하나뿐이었다
  (`CLOCK_SAMPLE`)
- `assert.deepEqual`은 값 비교이지 바이트 비교가 아니며 **키 순서를 보지 않는다**
- `deepStrictEqual`은 사용되지 않았다
- 예외 격리 동작과 호출 순서는 아무도 검증하지 않았다

그래서 추출 **이전에** 특성화 테스트를 먼저 넣었다(커밋 `3142e70`).

### 키 순서까지 고정

```js
function pinPayload(actual, expected) {
  assert.deepStrictEqual(actual, expected);
  assert.deepStrictEqual(Object.keys(actual), Object.keys(expected), "키 순서가 바뀌었습니다");
}
```

`deepEqual`만으로는 객체 리터럴이 재구성돼도 통과한다. "값은 같은데 구조를
바꿨다"를 잡으려면 별도 단언이 필요하다.

### 기대값은 추측하지 않고 덤프해서 확보

특성화 테스트의 기대값을 손으로 쓰면 그 자체가 추측이다. 스크립트로 실행해
모든 이벤트·trace를 JSON으로 덤프한 뒤 그 값을 옮겼다.

이 과정에서 설계 문서의 사실 오류 한 건이 드러났다 —
"trace가 던지면 `start()`가 reject"는 틀렸고 실제로는 `FAILED` 종결이다.

## 성공 기준 8 — 주장 대조

테스트로 고정되지 않는 두 주장을 diff에서 직접 확인했다. 각 커밋마다 수행했다.

### (a) 제어 복원력 `catch` 11개 불변

```
제어 복원력 catch: 11/11 확인
  271  mutationSnapshot 기본값 폴백
  435  availabilityShadow.start
  472  availabilityShadow.stop
  479  slotDomMutationWatch.stop
  725  referenceClockPort.stop
  730  drainSamples
  869  attemptPhase (control plane 신호)
  913  slotDomMutationWatch.start
  1035 markTargetCycle
  1173 availabilityWake.wait → deps.sleep 폴백 (핫패스 제어)
  1377 new URL 파싱
```

`orchestrator.ts`의 빈 `catch`는 22 → 13개가 됐다. 줄어든 9개는 전부 관측
전용이며 관측 계층으로 이동했다. 남은 13개는 **제어 11 + 혼합 2**다.

### (b) 스캔 루프 매 반복 경로에 관측 없음

```
스캔 루프 매 반복 경로 직접 관측 호출: 0건
```

기존 조건부 1회 호출(`applyPendingEmptyExit` 내부의
`traceAvailabilityEmptyExit`, `traceCycle("EMPTY_EARLY_EXIT")`)은 그대로
유지된다. 둘 다 실행 직후 `break` 하거나 `return` 한다.

이 확인 과정에서 설계 문서의 사실 오류 한 건이 드러났다 —
"25ms 루프 안에 관측이 없다"는 틀렸고, 조건부 관측 2개가 루프 안에 있다.
성능 결론은 유지되지만 불변식의 서술이 달라졌다.

## 영향 범위

```
변경한 파일
  src/content/orchestrator.ts              1,630 → 1,190
  src/content/observation/payloads.ts        신규   401
  src/content/observation/run-observer.ts    신규   332
  tests/orchestrator-observation.test.mjs    신규    21개
  tests/observation-payloads.test.mjs        신규    22개
  tests/observation-run-observer.test.mjs    신규    26개

변경하지 않은 파일
  src/content/index.ts       Dependencies 계약 불변
  tests/ 기존 파일           0건
  그 외 80개 파일            0건
```

`stageSnapshotData`를 `payloads.ts`로 옮긴 뒤 `orchestrator.ts`에서
re-export했다. `tests/snapshot-data.test.mjs`가 `orchestrator.js`에서 직접
import하고 있어, 이 조치로 해당 테스트가 무수정으로 남았다.

## Chrome 실사이트 확인 (성공 기준 7)

사용자가 워크트리(`codex/refactor-observation-split`)에서 빌드한 `dist/`를
Chrome에 로드해 실행했다. 2026-08-07, 매장 `mangam`, 예약일 `2026-09-03`,
2명, **dry-run**.

| 실행 | 설정 차이 | 결과 |
|---|---|---|
| `run-fbce1b4f` | `toggleIntervalMs` 400, 완주 off | `DRY_RUN_COMPLETED`, 45 이벤트, dropped 0 |
| `run-5cd25ceb` | `toggleIntervalMs` 100, 완주 on, 상한 500,000원 | `DRY_RUN_COMPLETED`, 45 이벤트, dropped 0 |

두 실행 모두 `entryMode: auto`라 진입·날짜·인원 준비 단계를 전부 거쳤다.
`run-5cd25ceb`은 진단 번들도 함께 받았다.

### 스탬핑

관측 계층이 소유하게 된 부분이다. 두 실행 모두 통과했다.

| 확인 | 결과 |
|---|---|
| `CLOCK_SAMPLE`의 `state`가 비어 있음 | ✅ `state: null` 보존. terminal prune 반복 트리거 방지 |
| `DATE_TOGGLE_CYCLE`의 `state` = `REFRESHING_SLOTS` | ✅ 컨텍스트가 아닌 명시값 보존 |
| 시계 보정 **전** `serverAt` 빈칸 (4건) | ✅ `ctx.serverAt()`의 `serverClockReady` 분기 |
| 시계 보정 **후** `serverAt` 채워짐 (39건) | ✅ 빈칸 0 |
| `AVAILABILITY_SHADOW`가 `SELECTING_DATE`로 스탬프됨 | ✅ `ctx.state()`가 동적으로 동작 |
| `seq` 연속, `droppedCount` 0 | ✅ run event 유실 없음 |
| `RUN_TERMINATED` 뒤에 `CLOCK_SAMPLE` 2건 | ✅ `finally` 블록 순서 보존 |

### payload 키 집합

전 trace code에서 **계약 밖 키 0건**이다. 코드가 만들 수 있는 키 집합과
대조했다.

```
CLOCK_SYNCED bootstrap   16 = 15 + eventKind
CLOCK_SYNCED armed       17 = 16 + clockArmLeadMs   ← 마지막에 덧붙는 것까지
CLOCK_SAMPLE             11 = 11
DATE_TOGGLE_CYCLE        20 = 20  전부 존재
SLOT_DETECTED            21 = 19 + eventKind + state
AVAILABILITY_SHADOW      body 28 / wake_result 20 / dom_compare 22
PREPARATION_OBSERVED     19건 전부 계약 내
```

`PREPARATION_OBSERVED`에는 coordinator의 `conditionAttributes`가 뒤에
펼쳐진다(`preparationTarget`, `targetVisible`, `personControlReady` 등).
이들은 `main`에도 있던 키이며 관측 계층이 만들지 않는다.

### 실제 배선에서 확인된 관측 경로

`RunObserver`가 fake가 아니라 실제 `TraceLogger`와 결합된 상태다.

| 메서드 | 확인 |
|---|---|
| `preparation()` | ✅ 19건. `stage_start`·`condition_changed`·`dispatch_before`·`dispatch_after`·`decision` 전부 |
| `availabilityBody()` | ✅ 4건. `POPULATED`·`IRRELEVANT` |
| `wakeResult()` | ✅ |
| `availabilityDom()` | ✅ |
| `toggleCycle()` | ✅ |
| `clockSamples()` | ✅ 2건 |
| `event()` | ✅ `STATE_CHANGED`·`ACTION_PERFORMED`·`SLOT_DETECTED` |

### 실행으로 덮이지 않은 경로

자동 테스트로는 덮여 있으나 이번 실사이트 실행에서는 트리거되지 않았다.

| 메서드 | 이유 |
|---|---|
| `slotClicked()` | dry-run은 슬롯을 클릭하지 않는다 |
| `runFailed()`, `failureData()` | 실패가 발생하지 않았다 |
| `emptyExit()` | `EXACT EMPTY` 응답이 없었다 |
| `stateChanged()` breadcrumb 정책 | 아래 참조 |

`stateChanged()`는 성공한 실행으로는 확인할 수 없다. `DiagnosticRecorder`의
`breadcrumb()`은 메모리 링에만 쌓고(`recorder.ts:38`), `failure()`가
일어나야 전송한다. 그래서 `DRY_RUN_COMPLETED` 실행의 진단 번들은
`dom-snapshots.jsonl`이 비어 있다(`snapshots: []`). **이 자체가 정상이며
리팩터 전과 동일한 동작이다.** breadcrumb 정책 검증은 자동 테스트에
의존한다.

### 원본 보관

CSV와 진단 번들은 저장소에 커밋하지 않았다. 동작 무변경 확인이 목적이고
`docs/evidence/` 규약은 제품 계약의 회귀 근거를 보관하는 용도이기 때문이다.
필요해지면 `docs/evidence/live-runs/2026-08-07/`에 규약대로 넣는다.

## 남긴 것

격리 통일은 이 단계에서 하지 않았다.
[#20](https://github.com/ka-MS/catchtable-reservation-assistant/issues/20)에서
판단한다. 01의 결과로 어느 관측이 실행을 죽일 수 있는지가 `send`/`sendSafe`
호출로 코드에 드러났으므로, 그 판단의 입력은 갖춰졌다.
