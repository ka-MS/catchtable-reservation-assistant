# 20 설계 — 판정 계약과 관측 계약

## 1. 원칙

- 어댑터는 DOM fact와 원자 action만 소유한다(부모 20-design §3.1). 이
  변경은 어댑터의 **비교 기준**과 **근거 노출**만 바꾸고 정책·상태
  전이는 건드리지 않는다.
- 판정을 느슨하게 만드는 곳마다 **유일성 또는 대체 방어선**을 명시한다.
- 미실측 값에 의존하는 비교는 만들지 않는다.

## 2. 시각 비교 제거

### 결정

폼 intent 검증과 방문예정 목록 확인 **양쪽 모두**에서 시각 비교를
제거한다.

### 근거

`selectedMinutes`는 사용자가 지정한 값이 아니라 설정된 시간 구간
(`timeRange.startMinutes`~`endMinutes`) 안에서 실행 중 잡힌 슬롯이다.
"기대한 시각"이라는 기준 자체가 사용자 의도가 아니라 실행 결과이므로
검증 대상으로서 근거가 약하다. 여기에 사이트가 같은 시각을 세 가지
표기로 렌더한다는 실측(§12.21)이 겹친다.

목록 확인까지 함께 제거하는 이유는 입구와 출구의 기준을 일치시키기
위해서다. 폼만 통과시키고 목록에서 막으면 **실예약이 생성된 뒤**
결과 불명 인계로 끝난다.

### 계약

```
ReservationFormExpectation    { shopDisplayName, dateText, personText }
ReservationSuccessExpectation { shopDisplayName, listingDateText, personText }
```

- `timeText` 필드와 `formTime()` 헬퍼를 제거한다(내 변경으로 생긴 고아).
- `reservationSummaryElements()`의 `/오전|오후/` 조건은 **유지한다.**
  이것은 비교 기준이 아니라 "이 요소가 예약 요약 블록"임을 식별하는
  구조 조건이다. 제거하면 후보 집합이 넓어져 오탐이 는다.
- `listingMatches()`도 같은 이유로 `li` 후보 판정 자체는 유지하고
  `timeText` 비교만 뺀다.

### 남는 방어선

| 대상 | 남는 검증 |
|---|---|
| 폼 intent | 매장 표시명(header 단일 h1 정확일치) · 날짜 · 인원 · 금액 상한 · fresh fingerprint |
| 성공 목록 | 매장 표시명 · `YYYY.MM.DD (요일)` · 인원 · 성공 path · 완료 문구 정확일치 |

### 받아들이는 위험

같은 매장·같은 날짜·같은 인원인데 **시간대만 다른** 예약을 구분하지
못한다. 슬롯 경합으로 클릭한 슬롯과 다른 시각의 폼이 열리는 경우가
여기 해당한다. 사용자가 시간 구간을 지정해 그 안의 아무 슬롯이나
잡는 것이 제품 의도이므로, 구간 안의 다른 시각은 의도 위반이 아니다.
구간 **밖** 슬롯은 애초에 후보로 선택되지 않는다.

## 3. 최종 버튼 판정

### 결정

```
FINAL_BUTTON_LABEL = "자동결제로 예약하기"   (정확일치)
  ↓
FINAL_BUTTON_PATTERN = /예약하기$/            (정규화 텍스트 suffix)
```

`findFinalButtons()`가 반환하는 개수가 **정확히 1개**여야 한다는 기존
조건은 그대로 둔다. `submitOuter()`도 동일 조건을 다시 확인한다.

### 근거

- 실측된 두 라벨 `자동결제로 예약하기`(§12.3/12.4/12.6)와
  `예약하기`(§12.21)를 하나의 규칙으로 덮는다.
- suffix 앵커라 `예약하기 전에 확인하세요` 류 안내 문구 버튼을 배제한다.
- 측정된 유일성: 대상 폼의 문서 전체 button 6개 중 매칭 1개, body
  텍스트 내 `예약하기` 등장 1회.

### 안전망

매칭이 2개 이상이면 기존과 동일하게 `ambiguous_final_button`으로
안전 인계한다. 느슨해진 매칭의 대가를 이 조건이 받는다.

알려진 유일한 충돌 후보는 비로그인 변형의 `로그인하고 예약하기`
문구(§12.3)다. 이 경로는 `hasLoginGate()`가 `login_required`로 먼저
끊으므로 최종 버튼 판정에 도달하지 않는다. 도달하더라도 2개 매칭 →
안전 인계다.

## 4. 실패 근거 관측

### 4.1 어댑터

`ReservationFormInspection`의 `unknown` variant에 `evidence`를 추가한다.

```ts
| { kind: "unknown"; code: ReservationFormUnknownCode;
    evidence: TraceAttributes; fingerprint: string }
```

`reservationIntentShape()`가 이미 계산하는 값을 fingerprint 해시에만
넣고 버리지 않고 여기에 함께 싣는다. 각 early return은 **그 시점에
실제로 알고 있는 값만** 담는다(`hold_countdown_unknown`은 hold 상태와
경로만, 금액 판정 이후 코드는 전체 shape).

### 4.2 필드

| 키 | 값 |
|---|---|
| `formInspectionKind` / `formUnknownCode` | 판정 결과 |
| `formShopNameMatch` / `formDateMatch` / `formPersonMatch` | **불리언 분해** — 어느 비교가 깨졌는지 |
| `formShopDisplayName` / `formExpectedShopDisplayName` | 읽은 값과 기대값 |
| `formSummaryTexts` | 요약 후보 정규화 텍스트, `" | "` 조인 |
| `formExpectedDateText` / `formExpectedPersonText` | 기대값 |
| `formButtonTexts` / `formFinalButtonCount` | 문서 전체 button 텍스트와 매칭 수 |
| `formAmounts` / `formAmountLimit` | 수집된 금액과 상한 |
| `formCatchPayChecked` / `formGeneralPaymentSelected` / `formPaymentRadioCount` | 결제 수단 판정 결과 |
| `formRequiredAgreementCount` / `formUncheckedRequiredAgreementCount` / `formEmptyRequiredMultilineCount` / `formOptionalAgreementCount` | 입력 스캔 |
| `formHoldState` | `active` / `expired` / `unknown` |

### 4.3 비저장 경계

**결제 수단 행의 텍스트는 담지 않는다.** 그 행에는 등록 카드 라벨이
렌더된다(§12.21). radio는 개수·`checked`·`disabled`·`일반결제` 라벨
식별 결과만 불리언과 정수로 기록한다.

요약 텍스트에는 `maskPii()`를 적용한다. 현재 표본에 개인정보는 없으나
`다른 사람이 방문해요` 같은 방문자 관련 문구가 붙는 블록이라 마스킹을
기본값으로 둔다. 이를 위해 `maskPii`를 `adapter/snapshot.ts`에서
`adapter/dom.ts`로 옮겨 두 소비자가 공유한다.

`automation-boundary.md`의 PIN·개인정보 비저장 원칙은 그대로다.

### 4.4 전달 경로

```
ReservationFormAdapter.inspect()      → unknown.evidence
CompletionCoordinator.run()           → CompletionResult.handed_off.evidence
Orchestrator.advancePostSlot()        → diagnosticHandOff(message, {...evidence})
failureData()                         → terminal 이벤트 attributes + 진단 스냅샷
```

`CompletionResult`의 `handed_off`에 `evidence?: TraceAttributes`를
추가한다. 선택 필드라 근거가 없는 인계 경로는 그대로 둔다.

### 4.5 스냅샷 스코핑

`adapter/snapshot.ts` 두 곳을 고친다.

1. `container`가 `main`이라 `header > h1`(매장명)과 fixed CTA가
   빠진다. `reservation_form`이고 열린 dialog가 없으면 **문서 전체**를
   범위로 한다.
2. `textSnippet`이 `reservation_form`에서 무조건 빈 문자열이다. 통째
   텍스트 대신 **요약 후보 + 금액 라벨** 화이트리스트로 만든 문자열에
   `maskPii()`를 적용한다.

이 두 가지가 사이드패널의 `제목 없음 · 버튼 취소 · 노쇼…` 착시를
만든 원인이다.

## 5. 회귀 고정

| 테스트 | 고정 대상 |
|---|---|
| 24시간제 요약 fixture(`오후 18:30`) | 시각 표기가 달라도 `ready` 도달 |
| 12시간제 `N시 M분` 단독 fixture | 상단 요약만 있는 변형도 통과 |
| 날짜 불일치 fixture | `intent_mismatch` 유지 — 완화가 날짜까지 번지지 않음 |
| 인원 불일치 fixture | `intent_mismatch` 유지 |
| `예약하기` CTA fixture | `ready` 도달과 `submitOuter` dispatch |
| `자동결제로 예약하기` 기존 fixture | 회귀 없음 |
| `예약하기` 2개 fixture | `ambiguous_final_button` |
| `intent_mismatch` evidence | 불리언 분해 3개가 실제 값으로 실림 |
| 결제 행 텍스트 비저장 | evidence에 카드 라벨 문자열 부재 |

## 6. 범위 밖 재확인

`COMPLETION_MESSAGE`는 바꾸지 않는다. 폼에서 `자동결제` 문구가 사라진
변형이 확인됐으므로 완료 문구도 바뀌었을 개연성이 있으나 성공 화면은
미실측이다. 실측 없이 성공 판정을 완화하면 **오성공**이 되므로,
안전한 실패(결과 불명 인계) 쪽에 남겨 둔다.

## 7. 검증 분담

자동 검증은 이 패키지가, **실사이트 E2E는 사용자가** 수행한다
(2026-08-06 합의). `40-verification.md`는 사용자 실행 결과로 채운다.
