# 관측 실패 정책 — 검증

**상태:** 완료
**검증일:** 2026-08-07
**브랜치:** `codex/fix-observation-failure-policy`
**부모 문서:** [20-design.md](20-design.md)

## 성공 기준 대조

| # | 기준 | 결과 |
|---|---|---|
| 1 | 예고한 테스트를 새 계약으로 뒤집어 통과, 그 외 무수정 | ✅ 10건 뒤집음 (예고 9 + 1) |
| 2 | 모든 공개 메서드가 `serverAt`·`state`·`trace`·`emit` 실패에서 안 던짐 | ✅ 12개 × 3조합 |
| 3 | `observationFailureCount`가 실패 0이면 없고 있으면 terminal에 실림 | ✅ 단위 + 실사이트 |
| 4 | `availabilityBody` trace 실패 후에도 late DOM 비교 실행 | ✅ **직접 검증** |
| 5 | `npm run check` | ✅ 622/622 |
| 6 | `git diff --check` | ✅ |
| 7 | 주장 대조 (a)(b)(c) | ✅ |

## 자동 검증

```
npm run check
  tests 622 / pass 622 / fail 0
  typecheck · dist · independence 통과

git diff --check    통과
문서 링크           56/56
```

### 주장 대조 (기준 7)

```
(a) 제어 복원력 catch          11/11 유지
    orchestrator.ts 빈 catch   13개 (불변)
(b) onAvailabilityBody catch   1개 유지
    correlateDomCandidate catch 1개 유지
(c) 스캔 루프 매 반복 카운터 참조  0건
```

(b)가 중요하다. 두 catch는 **제어 보호** 목적(비신뢰 bridge payload로부터
`correlateBody`·`wake.offer` 보호)이므로 관측을 격리했다고 해서 제거하면
안 된다.

## Chrome 실사이트 확인

워크트리 빌드를 Chrome에 로드해 dry-run 1회. 2026-08-07, 매장 `mangam`,
예약일 `2026-09-03`, 2명.

```
run-3bec38f4  v1.1.2  DRY_RUN_COMPLETED  62 이벤트  dropped 0
entryMode auto — 진입·날짜·인원 준비 단계 전부 통과
```

### ★ 핵심 확인: 실제 환경의 관측 실패 횟수

```
attr.observationFailureCount   열 자체가 없음 → 관측 실패 0건
```

**이 확인은 이 변경으로 처음 가능해졌다.** 이전에는 답할 수 없었다.

- 격리돼 있던 6곳: 조용히 삼켜 아무 흔적이 없었다
- 전파하던 4곳: 실패했다면 실행이 `FAILED`로 죽었을 텐데 그런 사례가
  관측된 적 없다

즉 "관측이 실제로 실패하고 있는가"는 측정 수단이 없어 미지였다. 이제
0으로 확인됐다. 동시에 **실패 0일 때 attribute가 붙지 않는다**는 설계
(§B)도 실환경에서 확인됐다 — 기존 payload가 그대로다.

### 회귀 없음

| 확인 | 결과 |
|---|---|
| `seq` 연속 (1..62), `droppedCount` 0 | ✅ |
| `CLOCK_SAMPLE`의 `state` 비어 있음 (13건) | ✅ `state: null` 보존 |
| `DATE_TOGGLE_CYCLE`의 `state` = `REFRESHING_SLOTS` | ✅ 명시값 보존 |
| 시계 보정 전 `serverAt` 빈칸 4건 / 후 채워짐 45건 | ✅ |
| payload 계약 밖 키 | ✅ **0건** |
| `RUN_TERMINATED` 뒤 `CLOCK_SAMPLE` | ✅ `finally` 순서 보존 |

`PREPARATION_OBSERVED` 25건, `AVAILABILITY_SHADOW` 6건, `CLOCK_SAMPLE` 13건으로
`preparation`·`availabilityBody`·`wakeResult`·`availabilityDom`·`toggleCycle`·
`clockSamples`·`event` 경로가 실제 배선에서 동작했다.

### E2E가 확인할 수 없는 것

**이 변경의 핵심인 격리 동작은 실사이트로 검증할 수 없다.** 예외를 주입해야
하는데 실행 중에는 불가능하다. 격리는 618개 테스트가 덮는다.

E2E의 역할은 두 가지였다 — (1) 정상 경로에서 payload가 안 바뀌었는지,
(2) 새 계기가 실환경에서 무엇을 가리키는지.

## 기준 4 — 직접 검증으로 전환

초안 검증에서는 구조적 추론으로 대체했으나 리뷰 지적에 따라 시나리오
테스트를 만들었다. **이 PR의 핵심 부수 효과를 추론으로 완료 처리하지
않는다.**

`lateDomCorrelation`은 DOM 상관관계가 먼저 잡힌 뒤 같은 cycle의 body가
도착해야 생성된다(`availability-correlation.ts:134`). 그 순서를 하네스에서
만들었다.

1. non-dry-run으로 cycle 1에서 슬롯 감지 → `correlateDomCandidate` 실행
2. 후속 화면 대기(`postSlot.inspect()`) 중에 shadow body 도착
3. `phase: "body"` trace만 실패시킴

```
기준선                 dom_compare + dom_compare_late 모두 기록
body trace 실패 시     body 없음, dom_compare_late 기록됨, 실행은 FAILED 아님
```

이전 동작에서는 `onAvailabilityBody`의 catch가 body trace 실패를 흡수하며
late 비교까지 건너뛰었다. 이제 두 관측이 서로를 막지 않는다.

테스트: `tests/orchestrator-observation.test.mjs` §5

## 리뷰 반영

PR #22 리뷰에서 세 건이 지적됐고 전부 사실이었다.

| 지적 | 조치 |
|---|---|
| `failureData()`의 `ctx.state()`가 경계 밖 — 계약 위반 | 메서드 전체를 `safeCall`로 감쌌다. 전부 실패하면 호출자의 `extra`만 반환 |
| 기준 4를 구조적 추론으로 완료 처리 | 시나리오 테스트로 직접 검증 (위) |
| 주석·인덱스가 새 계약과 충돌 | `event()` JSDoc, `onAvailabilityBody` 주석, `00-index`의 blocking 표시 갱신 |

첫 번째가 중요하다. `failureData()`는 handoff·timeout·`execute()` catch에서
불리므로 여기서 던지면 terminal 처리 자체가 깨진다. `ctx.state()` 실패를
주입하면 `state boom`이 그대로 나갔고 `observationFailures()`도 0이었다.

SP-025/01의 `sendSafe` 인자 평가 문제와 **같은 유형**이다 — 한 축
(`serverAt`)만 확인하고 다른 축(`state`)을 안 봤다.

## 남은 한계

[20-design §한계](20-design.md#한계--해결하지-않는다)에 적은 것이 그대로 유효하다.

1. `finally` 단계(`clockSamples`)의 실패는 집계 범위 밖
2. `emit`이 지속 실패하면 카운트도 전달되지 않음 (단 예약은 정상 종결)
3. 실패의 원인·지점은 남기지 않음 (카운트만)

## 원본 보관

CSV는 저장소에 커밋하지 않았다. 회귀 근거가 아니라 계기 판독이 목적이었고,
결과(실패 0건)는 이 문서에 기록했다.
