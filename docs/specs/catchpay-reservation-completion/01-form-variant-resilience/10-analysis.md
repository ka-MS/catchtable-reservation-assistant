# 10 분석 — 실패 경로와 원인 판정

## 1. 관측된 실패

진단 번들 `catchtable-diagnostic-run-45c3327b-6b0d-4d5a-9f23-e3c705671f17`
(확장 1.1.1, 스시 호시카이, 2026-09-08, 2명, 1020~1260분 구간).

```
STATE_CHANGED   COMPLETING_RESERVATION   openDeltaMs 480
RUN_TERMINATED  HANDED_OFF
  "예약 폼의 로그인·예약 내용·CatchPay·금액을 안전하게 확인하지 못했습니다. (intent_mismatch)"
  completionClaimed=false
```

슬롯은 `오후 6:30`(1110분)이 잡혔고 메뉴 2개·예약금 `예약금 0원 결제`
경로를 통과한 뒤 폼에 도착했다. 제출 dispatch는 0회다.

## 2. 실패 지점

`CompletionCoordinator.run()`의 **최초 1회 baseline 검사**다.

- `src/content/completion-coordinator.ts:123` — `adapter.inspect()`
- 결과가 `ready`가 아니면 재시도 없이 즉시 `handed_off`
- `src/content/adapter/reservation-form.ts:559` — `intentMatches()` false → `intent_mismatch`

`inspectReservationForm()`의 판정 순서상 `intent_mismatch`는
`amount_ambiguous`·`amount_over_limit` 다음, `catchpay_not_ready`·
`ambiguous_final_button` **앞**이다. 즉 금액 판정까지는 정상이었고,
뒤쪽 판정은 도달하지 못해 이 시점에는 미확인이었다.

## 3. 실측 재판독

인계된 폼이 탭에 남아 있어 클릭 없이 재판독했다. 원본 사실은
[site-behavior §12.21](../../../analysis/site-behavior.md)에 기록했다.
어댑터 판정을 페이지에서 그대로 재현한 결과:

```
shopNameMatches       true
dateTimePersonMatches false
finalButtons("자동결제로 예약하기")  0
```

`dateTimePersonMatches`의 항목별 분해:

| 기대값 | 출처 | 상단 요약 | 하단 요약 | 결과 |
|---|---|---|---|---|
| `09월 08일` | `completion-coordinator.ts:64` | `09월 08일 (화)` | `09월 08일(화)` | 일치 |
| `2명` | `:66` | `2명` | `2명` | 일치 |
| `오후 6:30` | `:65` `formTime()` | `오후 6시 30분` | `오후 18:30` | **불일치** |

### 원인

`formTime()`(`completion-coordinator.ts:50-56`)은 24시간 분값을
**12시간제 `오전/오후 h:mm`** 로 변환한다. 그런데 사이트의 두 요약은

- 상단: 12시간제 `N시 M분` (구분자가 `:`가 아님)
- 하단: `오전/오후` + **24시간제 `HH:MM`**

이라, 생성된 `오후 6:30`은 **어느 쪽과도 문자열이 일치하지 않는다.**

`dateTimePersonMatches()`는 `String.includes` 3개의 AND이므로
시각 하나만 어긋나도 전체가 false가 되고, 매장명·날짜·인원이 모두
맞았다는 사실은 코드에 남지 않는다.

### 기존 실측이 놓친 이유

| 표본 | 시각 | 12시간제 | 24시간제 |
|---|---|---|---|
| 우블랑 §12.3/12.4 | `오후 12:00` | 12 | 12 |
| 더피제리아마켓 §12.6 | `오전 11:00` | 11 | 11 |

두 표본 모두 **두 규칙의 값이 같은 시각**이었다. `tests/` fixture도
같은 값을 그대로 쓰고 있어 518개 테스트가 전부 통과한다. 값이 갈리는
시각(`18:30`)은 이번이 첫 표본이다.

## 4. 후속 차단 요소

intent를 통과시켜도 같은 실행은 다음에서 다시 막힌다.

**(a) 최종 버튼 — 확정.**
`FINAL_BUTTON_LABEL = "자동결제로 예약하기"`(`reservation-form.ts:95`)
정확일치를 요구하는데 실제 CTA는 `예약하기`다. 폼 문서 전체에
`자동결제` 문자열이 없다. `findFinalButtons()` = 0 →
`ambiguous_final_button`이고 `submitOuter()`도 dispatch하지 않는다.

측정된 유일성:

```
문서 전체 button        6
/예약하기$/ 매칭         1   ["예약하기"]
body 내 "예약하기" 등장   1회
```

**(b) 방문예정 목록 — 미확정, 높은 개연성.**
`listingMatches()`(`reservation-form.ts:461-470`)도 같은
`timeText`(`오후 6:30`)를 쓴다. §12.5·12.16의 목록 표본 역시
`오후 12:00` 하나뿐이라 24시간제 여부를 구분하지 못한다. 목록도
24시간제면 **실예약이 생성된 뒤에도** `COMPLETED`에 도달하지 못하고
결과 불명 인계로 끝난다.

**(c) CatchPay 판정 — 정상.**
`payment-type` radio 2개, 첫 radio checked(label text 없음), 둘째
`일반결제` disabled. §12.13의 판정 규칙이 그대로 성립한다.

## 5. 진단 가능성 결함

원인 특정에 실사이트 재판독이 필요했던 이유는 실패 경로가 근거를
하나도 남기지 않기 때문이다.

| 위치 | 결함 |
|---|---|
| `reservation-form.ts:391-402, 549` | `reservationIntentShape()`가 실제 h1·요약 텍스트를 읽고도 fingerprint 해시에만 넣고 버린다 |
| `completion-coordinator.ts:124-131` | `handed_off`가 코드 문자열만 전달한다. facts를 실을 자리가 없다 |
| `adapter/snapshot.ts:71` | 스냅샷 범위가 `main`이라 `header > h1`(매장명)과 fixed CTA가 제외된다 |
| `adapter/snapshot.ts:82` | `urlKind === "reservation_form"`이면 `textSnippet`을 무조건 빈 문자열로 만든다 |

사이드패널에 표시된 `제목 없음 · 버튼 취소 · 노쇼 시 취소 수수료가
결제됩니다 | 보기`는 실제 화면이 아니라 위 `main` 스코핑이 만든
착시다. 같은 시각의 rich 스냅샷에는 `h1 스시 호시카이`와 CTA
`예약하기`가 모두 들어 있다.

## 6. 불확실성

- 하단 요약의 24시간제 시각이 한 자리 시(예: `오전 9:00` vs
  `오전 09:00`)에서 zero-padding되는지는 **미실측**이다. 이번 설계는
  시각 비교 자체를 없애므로 이 값에 의존하지 않는다.
- 방문예정 목록의 시각 표기 규칙은 **미실측**이다. 4(b) 참조.
- 성공 완료 문구가 `자동결제로 예약을 완료했습니다`에서 바뀌었는지는
  **미실측**이다. 범위 밖.
- `예약하기` CTA가 이 매장 변형 고유인지 사이트 전역 변경인지는
  단일 표본이라 **미확정**이다. suffix 판정은 두 라벨을 모두
  포함하므로 어느 쪽이든 성립한다.
