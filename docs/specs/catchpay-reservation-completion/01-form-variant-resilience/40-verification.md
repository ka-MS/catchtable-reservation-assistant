# 40 검증

## 자동 검증 — 완료

```
npm run check     538/538 통과 (typecheck, dist validation,
                  MAIN/ISOLATED independence 포함)
git diff --check  통과
```

착수 기준 518 → 1차 534 → 완료 문구 수정 뒤 538.

## 1차 실사이트 E2E — 사용자 실행, 2026-08-06

`run-fd532ce8-01e6-4c8c-a5ad-0744d0329c6b`, 스시 호시카이 2026-09-08
오후 6:30, 2명, 예약금 230,000원 → 0원.

| # | 항목 | 기대 | 결과 |
|---|---|---|---|
| 1 | 확장 재로드 | 정상 | 통과 |
| 2 | 시각이 갈리는 슬롯에서 폼 도착 | `intent_mismatch` 없이 통과 | **통과** — `form_ready` 도달 |
| 3 | 최종 버튼 판정 | `예약하기` 1개 매칭 | **통과** — `outer_dispatch` dispatched=true |
| 4 | `form_ready` telemetry | 금액·CatchPay·필수 약관 기록 | 통과 |
| 5 | 인계 근거 | 실패 시 근거가 실림 | **부분** — 폼 판정 evidence는 구현됐으나 이 실행은 성공 판정 단계에서 실패했고 그 경로에는 근거가 없었다 |
| 6 | Side Panel 로그 | 매장명 표시 | **부분** — 성공 화면은 여전히 `제목 없음`(`main` 스코핑이 예약 폼에만 적용됨) |
| 7 | 진단 ZIP | 판정 근거 포함 | **부분** — fragment가 fixed/sticky만 담아 방문예정 `li` 부재 |
| 8 | 비저장 확인 | 카드 라벨 없음 | 통과 |

### 결과

**실제 예약은 생성됐다.** 종료 상태는 `COMPLETED`가 아니라
`HANDED_OFF`(결과 불명, `completionClaimed=true`)였다. 자동 재제출은
없었다 — 중복 제출 금지 규칙은 지켜졌다.

원인은 완료 문구 하나였다. path와 방문예정 목록은 일치했다
(10-analysis §7, site-behavior §12.22).

### 1차에서 드러난 수정

5·6·7의 `부분` 항목과 완료 문구를 30-implementation §6에서 수정했다.

## 2차 실사이트 E2E — 사용자 실행, 2026-08-06 `[사용자 확인]`

수정 dist로 **다른 매장 3곳**을 실행해 모두 최종 완주에 성공했다고
사용자가 확인했다.

| # | 항목 | 기대 | 결과 |
|---|---|---|---|
| 1 | 완주 종료 상태 | `COMPLETED` | 통과 — 3곳 모두 |
| 2 | 제출 횟수 | outer dispatch 1회, 재제출 0회 | 통과 (재제출 관측 없음) |

이로써 §12.21·§12.22 변형 대응이 스시 호시카이 단일 표본이 아니라
**서로 다른 4개 매장에서 성립**함이 확인됐다. suffix 판정
(`/예약하기$/`, `/예약을 완료했습니다$/`)은 구·신 라벨을 모두 받으므로
개별 매장이 어느 문구를 쓰든 완주한다.

## 성공 실행 진단 번들 대조 — 2026-08-06 `[실측]`

`run-c6782244-6b2f-4989-af50-a64c4c51d563` (mangam, 2026-09-03, 2명,
0원, `finalState: COMPLETED`, `eventCount 43`, `droppedCount 0`,
`seq 1..43` 연속).

### 완주 telemetry

```
form_ready        currentAmountKrw=0 · catchPaySelected=true
                  generalPaymentSelected=false
                  requiredAgreementCount=7 · uncheckedRequiredAgreementCount=7
                  emptyRequiredMultilineCount=1 · optionalAgreementCount=0
outer_claim       claimGranted=true
outer_dispatch    dispatched=true
success_observed  successPathMatched=true
                  successMessageMatched=true
                  successListingMatched=true
RUN_TERMINATED    COMPLETED
```

`form_ready` +4.476s → `outer_claim` +6.000s → `outer_dispatch` +6.011s
→ `success_observed` +6.705s.

| # | 항목 | 결과 |
|---|---|---|
| 2 | `success_observed` 세 boolean | **통과** — 셋 모두 true |
| 3 | 제출 횟수 | **통과** — `outer_claim` 1회, `outer_dispatch` 1회, PIN phase 0회 |
| 6 | 비저장 경계 | **통과** — 아래 스캔 |

### 비저장 스캔

번들 전체(93,775 bytes, 모든 파일 연결)에 다음 패턴이 없다.

| 패턴 | 결과 |
|---|---|
| 카드 브랜드·마스킹 라벨 (`체크하나`/`외환`/`(\d{3}\*)` 등) | 없음 |
| PIN 관련 키 (`pin`/`rawPin`/`paymentPin`) | 없음 |
| 이메일 | 없음 |
| 예약번호 (`예약번호`/`reservationNo`/`bookingNo`) | 없음 |
| 전화번호 | 없음 — 정규식 hit 6건은 모두 `localAt` epoch-ms 타임스탬프 오탐 |

### 이 번들로 채울 수 없는 항목

| # | 항목 | 사유 |
|---|---|---|
| 4 | 성공 화면 스냅샷 제목 | 성공 실행은 실패 스냅샷을 남기지 않는다(`snapshotCount 0`). 인계가 발생한 실행에서만 관측된다 |
| 5 | 실패 경로 evidence | 같은 이유 |

4·5는 자동 테스트로 고정돼 있으나 실사이트 관측 근거는 아직 없다.
다음에 인계로 끝난 실행의 번들을 받으면 채운다.

### 필수 multiline 카운트 — 오독 정정

`form_ready`가 `emptyRequiredMultilineCount=1`을 기록했는데 번들의
`requiredFormDefaultAnswer`가 빈 문자열이라, 코드 경로상 인계돼야 하는
조합인데 완주했다고 처음 판단했다. **오독이었다.**

`requiredFormDefaultAnswer`는 사용자 자유 입력이므로 telemetry에
저장할 때 의도적으로 비운다(`trace-logger.ts` `cleanConfig`,
`trace-ingestor.ts`). 같은 값이 `sensitiveValues`로 등록돼 이벤트
문자열에서도 `[REDACTED]`로 치환된다. 즉 번들의 `""`는 **비저장 처리
결과이지 런타임 값이 아니다.**

실행은 설계대로 동작했다.

```
baseline    empty=1
루프 1회차   empty=1 → 설정된 답변으로 채움 → continue
루프 2회차   empty=0 → 필수 약관 7개 동의(250ms settle)
            → 제출 → COMPLETED
```

`form_ready`(+4.476s) → `outer_claim`(+6.000s)의 1.524초 간격이 이
흐름과 맞는다. 판정 비결정성도, `[필수]` 오판도 아니다.

재발 방지로 `form_ready`에 `requiredFormDefaultAnswerSet` boolean을
추가했다. 답변 본문은 계속 저장하지 않으면서 설정 여부만 남겨,
`emptyRequiredMultilineCount > 0`인 실행의 완주를 모순 없이 읽게 한다.

## 남은 미실측

- 개별 매장이 `예약하기`와 `자동결제로 예약하기` 중 어느 라벨을
  쓰는지의 분포. 완주 성공만으로는 구분되지 않는다. 판정에는 영향이
  없다.
- 완료 오버레이가 떠 있는 동안 방문예정 `li`가 항상 렌더되는지.
  1차에서 목록 일치가 관측됐으나 오버레이 표시 시점의 타이밍
  의존성은 별도로 계측하지 않았다.
