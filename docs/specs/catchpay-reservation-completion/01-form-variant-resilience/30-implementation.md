# 30 구현

**브랜치:** `codex/fix-form-intent-and-final-button`
**기준:** `npm run check` 538/538 통과, `git diff --check` 통과

## 변경 파일

| 파일 | 변경 |
|---|---|
| `src/content/adapter/dom.ts` | `maskPii`를 이곳으로 옮겨 두 소비자가 공유 |
| `src/content/adapter/reservation-form.ts` | 시각 비교 제거, 최종 버튼 suffix 판정, `unknown.evidence` |
| `src/content/completion-coordinator.ts` | `formTime()`·`timeText` 제거, `handed_off.evidence` |
| `src/content/orchestrator.ts` | 완주 인계 시 evidence를 terminal 이벤트로 전달 |
| `src/content/adapter/snapshot.ts` | 예약 폼 스냅샷 스코핑·화이트리스트 snippet |
| `src/sidepanel/event-format.ts` | heading fallback 제목, 폼 판정 분해 줄 |

## 1. 시각 비교 제거

- `ReservationFormExpectation.timeText`, `ReservationSuccessExpectation.timeText`
  필드 삭제. 두 필드의 유일한 생산자였던 `formTime()`도 삭제(고아 정리).
- `dateTimePersonMatches()` → `datePersonMatches()`. 날짜·인원만 비교한다.
- `listingMatches()`에서 `timeText` 비교 제거.
- `reservationSummaryElements()`의 `/오전|오후/` 조건은 그대로 뒀다.
  후보 식별용 구조 조건이지 비교 기준이 아니다.
- `ReservationCompletionIntent.selectedMinutes`는 남긴다.
  `dispatchFingerprint()`가 계속 쓴다 — 고아가 아니다.

## 2. 최종 버튼

```ts
const FINAL_BUTTON_PATTERN = /예약하기$/;
findFinalButtons = visibleAll(document, "button")
  .filter((b) => FINAL_BUTTON_PATTERN.test(normalizedText(b.textContent)));
```

호출부 두 곳(`inspectReservationForm`의 `!== 1` 판정,
`submitOuter`의 `!== 1` 거절)은 그대로다.

## 3. 실패 근거

`ReservationFormInspection`의 `unknown` variant에 `evidence: TraceAttributes`
추가. `inspectReservationForm`은 금액·스캔·결제수단·버튼을 이미 계산한
뒤이므로 지역 헬퍼 `unknown(code)`로 6개 return 경로가 같은 근거를
공유한다. 그보다 앞서 반환하는 `hold_countdown_unknown`과
`pin_keypad_unsupported`는 그 시점에 아는 값만 담는다.

전달 경로는 설계 §4.4 그대로 구현했다. `handed_off.evidence`는 폼
baseline 실패와 루프 중 폼 변경 인계 두 곳에서 채운다.

### 비저장 확인

- 결제 수단 행 텍스트는 담지 않는다. radio는 개수·checked·
  generalSelected 불리언만 기록한다.
- 요약 텍스트와 버튼 텍스트에 `maskPii()`를 적용한다.
- 회귀 테스트가 카드 라벨·전화번호·이메일 문자열의 부재를 고정한다.

## 4. 스냅샷과 Side Panel

- `container`: `reservation_form`이고 dialog가 없으면 문서 전체.
  `main` 스코핑 때문에 매장명 `h1`과 fixed CTA가 빠지던 문제를 없앤다.
- `textSnippet`: `reservation_form`에서 무조건 빈 문자열이던 규칙을
  요약 후보 + 금액 라벨 화이트리스트로 대체.
- Side Panel 스냅샷 줄은 dialog 제목이 없으면 첫 heading으로 대체하고,
  `formUnknownCode`가 있으면 `폼 판정(...): 매장 일치 · 날짜 불일치 …`
  줄을 덧붙인다.

## 5. 테스트

기존 526 → 534. 신규 8개, 수정 3개.

### 신규

| 테스트 | 고정 대상 |
|---|---|
| 12시간제·24시간제 혼재 요약 → `ready` | §12.21 변형 회귀 |
| 24시간제 단독 / 12시간제 단독 → `ready` | 표기 한 벌만 있어도 통과 |
| 두 실측 라벨 모두 `ready` + `submitOuter` 1회 dispatch | suffix 판정 |
| `예약하기` 2개 → `ambiguous_final_button`, 클릭 0회 | 느슨한 매칭의 안전망 |
| `예약하기 전에 확인하세요` → 최종 버튼 아님 | suffix 앵커 |
| `intent_mismatch` evidence 불리언 분해 | 진단 가능성 |
| evidence의 카드 라벨·전화·이메일 부재 | 비저장 경계 |
| Side Panel heading fallback + 폼 판정 줄 | 표시 회귀 |

### 수정

- `날짜·시간·인원 불일치는 ready가 아니다` → `날짜·인원 불일치…`.
  시각 케이스를 빼고 매장명 케이스를 넣었다.
- PIN 아래 stable context 테스트: 요약이 두 벌이고 하나만 맞아도
  통과하므로 두 벌 모두 바꿔야 stale intent가 된다.
- `build-regression`: 번들에 `자동결제로 예약하기` 대신 `예약하기$`
  존재를 확인한다.

### 새 fixture

`tests/fixtures/catchpay-zero-form-24h-cta.html` — §12.21 실측 재현.
카드 식별 문자열은 넣지 않았다.

## 6. 1차 E2E 뒤 추가 구현

사용자 E2E(`run-fd532ce8`)에서 1~5가 동작해 실제 예약이 생성됐으나
완료 문구 불일치로 `COMPLETED`에 도달하지 못했다(10-analysis §7).
그 자리에서 성공 화면을 실측(§12.22)해 다음을 추가했다.

| 파일 | 변경 |
|---|---|
| `src/content/adapter/reservation-form.ts` | `COMPLETION_MESSAGE` 정확일치 → `/예약을 완료했습니다$/` suffix, `hasExactMessageText` → `hasCompletionMessage` |
| `src/content/completion-coordinator.ts` | `observeSuccess` 인계에 path·문구·목록 evidence, `SUCCESS_PATH` 상수화 |
| `src/content/adapter/snapshot.ts` | whole-document 스코핑을 성공 경로에도 적용 |

`successful()`의 세 조건 AND는 그대로다. 완화는 문구 표기 범위에만
적용했고 조건 수는 줄이지 않았다.

### 추가 테스트 (534 → 538)

| 테스트 | 고정 대상 |
|---|---|
| `예약을 완료했습니다` 변형의 세 조건 모두 만족 | §12.22 회귀 |
| 후속 안내를 삼킨 부모 텍스트는 문구로 받지 않음 | suffix 완화의 경계 |
| `예약하기` CTA + 짧은 완료 문구로 `COMPLETED` 종료 | 완주 경로 통합 |
| 결과 불명 인계의 세 조건 분해 evidence | 진단 가능성 |

새 fixture `tests/fixtures/catchpay-success-short-message.html` — §12.22 재현.

## 7. 남은 작업

수정 dist로 재실행하는 실사이트 E2E는 사용자가 진행한다.
`40-verification.md` 참조.
