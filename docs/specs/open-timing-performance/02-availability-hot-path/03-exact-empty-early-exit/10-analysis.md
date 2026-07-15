# RT-14 분석 - EXACT EMPTY cycle 조기 종료

## 1. 질문

현재 cycle의 `EXACT EMPTY` body를 받았을 때 남은 슬롯 대기를 조기 종료하면 다음 목표 날짜 클릭을 의미 있게 앞당길 수 있는가?

## 2. 재현 방법

```bash
npm run analyze:rt14 > /tmp/rt14-analysis.json
```

분석기는 `docs/evidence/live-runs`의 26개 `run.csv`를 읽고 현재 코드의 `nextTogglePlan()`을 사용한다.

수용 표본:

- body phase
- `classification=EMPTY`
- `correlationQuality=EXACT`
- 과거 실행에서 `wakeDiscardReason=no_matching_slot`

마지막 조건은 당시 `AvailabilityDomWake`의 active cycle·non-stale·non-duplicate 검사를 통과했지만 선택 가능한 분이 없어 거부됐다는 뜻이다.

## 3. 제외 기준

### 문서상 환경 제외

- 누와 `run-5881d898`: 최소화
- 누와 `run-8984299b`: 최소화·큰 cycle 공백
- 누와 `run-b413a0d5`: 신규 PC 4분할·진입 실패

4분할 실행에는 유효 EMPTY가 없어 수치에는 영향이 없다.

### timing-clean

문서상 환경 제외 후 다음을 모두 만족한다.

- body 도착부터 cycle 종료까지 `0..700ms`
- 다음 target click의 schedule drift 절댓값 `<=100ms`

700ms는 현재 `QUIESCE_TIMEOUT_MS`, 100ms는 정상적인 토글 계획 이탈과 명백한 scheduling stall을 분리하는 보수적 분석 한계다. 2026-07-15 표본에는 visibility·viewport가 없으므로 timing-clean을 전면 창의 증명으로 해석하지 않는다.

## 4. 결과

| 지표 | 결과 |
|---|---:|
| 전체 실행 | 26 |
| `EXACT EMPTY` | 94 |
| active cycle 수용 가능 EMPTY | 53 |
| inactive 또는 기타 | 41 |
| timing-clean EMPTY | 28 / 13개 실행 |
| target click → EMPTY p50 | 약 125ms |
| target click → EMPTY p95 | 약 281ms |
| EMPTY → 실제 cycle 종료 p50 | 약 241ms |
| EMPTY → 실제 cycle 종료 p95 | 약 248ms |
| 다음 target click 이론 선행 p50 | 약 281ms |
| 다음 target click 이론 선행 p95 | 약 311ms |

분석기는 다음 target의 schedule drift를 확인할 수 없는 행도 timing-clean에서 제외한다. 따라서 앞선 수동 예비 집계보다 표본 수와 tail 값이 작다.

## 5. 해석

사전 gate였던 이론 절감 중앙값 100ms를 넘는다. 최소화·명백한 stall·schedule drift 미확인 행을 제외해도 p50 약 281ms이므로 RT-14는 구현 가치가 있다.

다만 이 값은 실제 성능 향상 보장이 아니다.

- 과거 응답 시각을 그대로 재사용한 counterfactual이다.
- 요청 cadence가 바뀐 뒤 Catchtable 응답 순서와 서버 부하는 예측하지 못한다.
- 한 cycle을 앞당기면 이후 모든 cycle의 요청/응답 위상이 달라진다.
- 7월 15일 환경에는 visibility·viewport 증거가 없다.

## 6. 설계 요구사항

1. `EXACT`만 허용하고 `STRONG`은 허용하지 않는다.
2. current active cycle, non-stale, 최신 sequence를 요구한다.
3. EMPTY 신호 수신 직후 DOM을 마지막으로 검사해 이미 렌더된 슬롯을 우선한다.
4. 목표 날짜 선택 상태가 유효할 때만 조기 종료한다.
5. 조기 종료 후 즉시 무제한 클릭하지 않고 `nextTogglePlan()`을 재사용한다.
6. probe off, observe-only, malformed/inactive/stale body는 기존 경로와 동일해야 한다.
7. 운영 기본값은 실오픈 검증 전까지 off다.

## 7. 판정

**GO - 설계 단계로 진행한다.**

3신호/MutationObserver는 범위에서 제외하고, XHR 모드는 `off | observe | empty_exit`의 단일 설정으로 설계한다.
