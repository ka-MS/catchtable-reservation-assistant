# 오픈 타이밍 성능 패키지 — 사후 레드팀 리뷰

**리뷰일:** 2026-07-15
**대상:** open-timing-performance 우산 패키지 전체. 특히 [70-live-run-analysis](70-live-run-analysis.md)와 [80-probe-final-decision](80-probe-final-decision.md)의 분석·결정 근거
**성격:** 구현 완료·결정 확정 후의 독립 재검증. 코드 결함이 아니라 증거의 범위와 다음 측정의 설계를 공격한다.

## 1. 결론

**RT-05 결정(probe 진단 전용·기본 비활성·fallback 보존)은 데이터가 지지하며 뒤집을 근거가 없다.** 다만 결정의 근거 체계에 아래 7건의 구멍이 있고, 그중 F2가 해소되지 않으면 후속 실오픈 표본도 전부 재평가 gate 판정에 사용할 수 없다.

## 2. 재검증 방법

- `node scripts/analyze-live-runs.mjs`를 재실행해 70-doc의 모든 표와 대조 — **전량 재현 일치** (전체 26건 무결성, byDate n=17 지연 분포, wake 수락 7건, inactive_cycle 12건, traceOutcome 분포)
- "설정 범위 일치 body 19건"과 "슬롯 클릭 19건"의 집합 동일성 확인 — 동일
- 26건 `run.csv`에서 `configJson.availabilityProbeEnabled`, 동결 시점 `clockConfidence`/`clockUncertaintyMs`를 실행별 추출
- working tree의 evidence 수정분을 정규화 후 바이트 비교 — BOM/CRLF 차이뿐, 내용 동일
- `src/`에서 `baselineNextScanAt`/`wakeAdvanceMs` 계측 존재 여부 grep — 0건

방어가 확인된 항목: `attr.matchesTarget` 함정 회피, nearest-rank p95=max 인지, wake 수락군 대 inactive_cycle군 단순 비교 금지, `FORM_REACHED`와 최종 성공 구분.

## 3. Finding

### F1. 운영 기본 구성(probe off)의 실오픈 표본 0건 — P1

26건 전부 `configJson`에 `availabilityProbeEnabled` 필드가 없다. 즉 전량 RT-05 이전의 probe 상시 주입 빌드에서 수집됐고, 사용자 확인 성공 3건을 포함한 모든 actual-open 증거가 MAIN wrapper 설치 상태의 기록이다. RT-05가 운영 기본으로 채택한 wrapper 미설치 구성은 dry-run과 자동 테스트로만 검증됐다.

fallback 코드 경로는 동일하므로 결정을 바꿀 사유는 아니다. **조치:** 80-doc에 이 한계를 명기하고, 다음 실오픈 1건을 probe off로 실행해 확인 표본을 남긴다.

### F2. 재평가 gate가 요구하는 계측 미구현 — P1

80-doc §6과 HANDOFF는 accepted wake마다 `baselineNextScanAt`, `wakeScanAt`, `wakeAdvanceMs` 기록을 요구하지만 현재 코드에 해당 계측이 없다. 이 상태로 표본을 더 모아도 gate는 영원히 판정 불능이다. **조치:** trace 전용 필드로 구현한다. hot path 로직 변경 없음. (2026-07-15 구현 완료 — `wake_result`에 `baselineNextScanAtMonoMs`, `wakeScanAtMonoMs`, `wakeAdvanceMs` 추가)

### F3. openDelta 집계에 시계 불확실성 필터·주석 없음 — P1

Tier 1의 교훈이 "기준시계 프레임 불신"인데, 70-doc §5의 오픈→클릭 분포는 실행별 동결 시점 clock uncertainty를 반영하지 않고 합산했다. 클릭 19건의 동결 uncertainty는 대부분 MEDIUM 12~210ms지만 yojeong 419ms가 포함돼 있고, 70-doc §10과 80-doc §6의 후속 측정 조건 목록에는 시계 신뢰도 조건 자체가 없다.

주된 영향은 측정 오염이지만 운영 영향이 0인 것은 아니다. 클릭 자체는 응답/DOM 주도라 오클릭 위험은 낮으나, 추정 편향이 uncertainty 범위를 벗어나면 토글 시작 지연(경쟁력 저하)과 `stopAt` 판정 오차가 생길 수 있다. uncertainty 기반 armLead 방어는 추정 범위가 정직할 때만 유효하다.

관측 시간과의 상관도 실측됐다: 동결 uncertainty 상위 실행(yojeong 419ms/9.3초, curtaincall 210ms/18.9초, laviok 123ms/20.6초)은 시작→오픈 관측이 짧았고, 최소화 창 실행(누와 5881, 324ms)은 71초를 관측하고도 넓었다. 정상 창에서 55초 이상 관측한 실행은 전부 105ms 이하였다. **조치:** 집계 스크립트에 동결 confidence/uncertainty 컬럼과 gating 집계를 추가하고, 두 문서의 조건 목록에 시계 신뢰도를 명기한다. (2026-07-15 완료 — MEDIUM|HIGH + ≤100ms gate 적용 시 클릭 19건 중 13건 통과, gated 오픈→클릭 p50 `+1042ms` 대 ungated `+1127ms`로 오염이 실측 확인됨)

### F4. inactive_cycle 12/19의 기회비용 미분석 — P2

wake의 실질 가치는 25ms 폴링 단축이 아니라 F1 수정이 준 250ms render window 보존이다. 그런데 body가 다음 cycle 시작 후 도착하는 지배적 패턴(12/19, 성공 3건 전부 포함)은 `inactive_cycle`로 거절되어 이 보호를 받지 못한다. 늦게 렌더된 DOM이 cycle 경계에서 지워지면 한 cycle(~300–400ms)을 잃는다. 거절이 안전한 것은 맞지만, 수락률이 7/19에 그친 원인(응답 지연 대 cycle 위상)과 "이전 cycle body + target 날짜 재확인 통과 시 window 보존만 허용" 완화의 비용·이득이 분석되지 않았다. **조치:** backlog 등재. probe 진단 전용 결정과는 별개다.

### F5. 측정 초점이 상한이 작은 항목에 있음 — P2

오픈→클릭 p50 1127ms의 분해는 오픈→최종 target 클릭 ~914ms(서버 게시 지연 + cycle 양자화), target 클릭→감지 199ms(대부분 서버 응답+렌더), 감지→dispatch 14ms다. body wake가 건드릴 수 있는 항은 구조적으로 "25ms 폴링 잔여 + window 보존"뿐이므로 wake counterfactual 측정의 기댓값은 낮다. 반면 `EXACT EMPTY` body로 bounded 대기를 조기 종료해 cycle 주기 자체를 줄이는 옵션은 검토조차 되지 않았다(클릭 없는 경로라 안전 리스크는 낮으나 재요청 빈도 증가 = 사이트 부하 리스크가 있어 자동화 경계 검토 선행 필요). **조치:** backlog 등재. 최소한 우산 문서 §7 거부 대안 표 수준의 "검토 후 채택/기각" 기록을 남긴다.

### F6. 원본 증거 26개 파일이 working tree에서 수정된 채 방치 — P2

`docs/evidence/live-runs`의 run.csv 26건이 BOM/CRLF 정규화로 수정된 상태였다(내용은 바이트 동일 확인). evidence 원칙상 원본은 export된 그대로 불변이어야 하고 정규화는 reader가 담당한다. **조치:** checkout으로 복원. (2026-07-15 복원 완료)

### F7. 경미한 문구·기록 이슈 — P3

1. 70-doc §1 "wake는 7건에서 수락됐고 모두 DOM 후보를 찾았다" — 482ms 건은 wake window가 아니라 fallback이 찾았다. §6에서 정정되지만 결론 절만 읽으면 과대해석된다. **조치:** 문구 정정.
2. `FORM_REACHED` 11건 중 사용자 최종 결과 라벨은 3건뿐(README 메모 "미분류" 10건). 성공률류 주장을 하려면 기억이 남아 있을 때 라벨을 채운다. **조치:** 사용자 확인 필요, 문서만으로 해소 불가.
3. HANDOFF가 Tier 2-2 종료를 선언했지만 브랜치는 main 미병합 상태다. 병합 전 `npm run check` gate는 브랜치 전략대로 유지한다.

## 4. 우선순위

1. **F2** — counterfactual 계측 구현. 다음 실오픈 전 필수
2. **F3** — 집계 스크립트 gating + 두 결정 문서의 조건 목록 보강
3. **F1** — probe off 실오픈 확인 표본 1건 + 한계 명기
4. **F6** — evidence 복원 (완료)
5. **F4/F5** — 후속 측정 backlog의 초점 재조정

## 5. 명시적 비판정

- 20/40/60ms 상수, cycle 정책, hot path 코드는 이 리뷰에서 결함을 찾지 못했다.
- 26건 자료의 기능·안전 판정(범위 밖 클릭 0건, dropped 0)은 유효하다.
- RT-05 결정 자체의 번복을 요구하지 않는다.
