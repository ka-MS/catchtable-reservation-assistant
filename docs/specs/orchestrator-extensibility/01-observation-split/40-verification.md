# 01. 관측 분리 검증

**상태:** 자동 검증 완료 / Chrome 수동 확인 대기
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
| 7 | Chrome 수동 로드 dry-run | ⏳ **대기** — 아래 참조 |
| 8 | 주장 대조 | ✅ 아래 참조 |

## 자동 검증

```
npm run check
  version validation passed: 1.1.2
  typecheck                  통과
  tests 573 / pass 573 / fail 0
  dist validation passed
  independence validation passed  (MAIN/ISOLATED 격리)

git diff --check              통과
```

### 테스트 구성

| 파일 | 개수 | 성격 |
|---|---|---|
| 기존 스위트 | 540 | **무수정** |
| `orchestrator-observation.test.mjs` | 21 | 특성화(baseline 고정) |
| `observation-payloads.test.mjs` | 12 | 순수 함수 golden |
| **합계** | **573** | |

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
  src/content/orchestrator.ts              1,630 → 1,194
  src/content/observation/payloads.ts        신규   205
  src/content/observation/run-observer.ts    신규   447
  tests/orchestrator-observation.test.mjs    신규   462
  tests/observation-payloads.test.mjs        신규   281

변경하지 않은 파일
  src/content/index.ts       Dependencies 계약 불변
  tests/ 기존 파일           0건
  그 외 80개 파일            0건
```

`stageSnapshotData`를 `payloads.ts`로 옮긴 뒤 `orchestrator.ts`에서
re-export했다. `tests/snapshot-data.test.mjs`가 `orchestrator.js`에서 직접
import하고 있어, 이 조치로 해당 테스트가 무수정으로 남았다.

## Chrome 수동 확인 (성공 기준 7) — 대기

자동 검증으로 payload·격리·순서를 고정했으나, 확장을 실제로 로드해
오픈런 dry-run이 정상 종료하는지는 확인하지 않았다.

확인 절차는 다음과 같다.

1. `npm run build` 후 `dist/`를 Chrome에 로드
2. Side Panel에서 임의 매장·미래 날짜로 dry-run 실행
3. `DRY_RUN_COMPLETED` 종료 확인
4. 실행 로그에 이벤트가 정상 표시되는지 확인
5. 진단 ZIP 내보내기로 trace가 기록됐는지 확인

동작 무변경 리팩터이고 573개 테스트가 payload를 바이트 단위로 고정하고
있어 위험은 낮다. 다만 **테스트가 덮지 못하는 것**이 하나 있다.

`RunObserver`는 `chrome.runtime` 경계 너머의 실제 `TraceLogger`·
`DiagnosticRecorder`와 결합된 적이 없다. fake로만 검증했다. 실제 배선에서
스탬핑(`serverAt`·`state`)이 의도대로 붙는지는 로드해 봐야 확정된다.

## 남긴 것

격리 통일은 이 단계에서 하지 않았다.
[#20](https://github.com/ka-MS/catchtable-reservation-assistant/issues/20)에서
판단한다. 01의 결과로 어느 관측이 실행을 죽일 수 있는지가 `send`/`sendSafe`
호출로 코드에 드러났으므로, 그 판단의 입력은 갖춰졌다.
