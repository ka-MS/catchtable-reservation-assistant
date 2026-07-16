# 사후 레드팀 리뷰와 counterfactual 계측

**날짜:** 2026-07-15
**브랜치:** `codex/live-run-analysis-probe-decision`

## 목적

Tier 2-2 종료·RT-05 결정의 분석 근거를 독립 재검증하고, 발견된 구멍 중 즉시 해소 가능한 항목(F2 계측, F3 시계 gating, F6 evidence 복원, F7 문구)을 같은 세션에서 처리한다.

## 레드팀 리뷰

`docs/specs/open-timing-performance/02-availability-hot-path/90-redteam-review.md`에 F1~F7을 기록했다.

- 70-doc의 모든 표가 `analyze-live-runs.mjs` 재실행으로 전량 재현 일치함을 확인했다.
- RT-05 결정 자체는 유지한다. 발견은 증거 범위와 다음 측정 설계에 집중된다.
- F1(probe off 실오픈 표본 0건)은 RT-12, F4(inactive_cycle 기회비용)는 RT-13, F5(EXACT EMPTY cycle 조기 종료)는 RT-14로 backlog 등재했다.

## 문서 정리

- F6: working tree에서 BOM/CRLF 정규화로 수정돼 있던 evidence `run.csv` 26건을 커밋 상태로 복원했다(정규화 전후 내용 동일을 바이트 비교로 확인).
- F7: 70-doc §1의 wake 7건 문구를 wake 경로 6건 / fallback 경로 1건으로 정정했다.
- F1: 80-doc에 `§7 알려진 한계`(전 표본 wrapper-on)를 추가했다.
- F3: 70-doc §10과 80-doc §6 재평가 조건에 동결 ReferenceClock confidence·uncertainty 조건을 추가했다.

## F2 — wakeAdvanceMs 계측

`runToggleCycle`의 wake 소비 지점 2곳에서 counterfactual 시각을 기록한다.

- wake가 in-flight sleep을 해제한 경우: `baselineNextScanAtMonoMs = sleep 시작 + 예정 delay`, `wakeAdvanceMs = baseline − 실제 해제 시각` (최대 25ms)
- 첫 scan 전에 pending으로 소비된 경우: scan 시점이 앞당겨지지 않으므로 `wakeAdvanceMs = 0`

`wake_result` trace에 `baselineNextScanAtMonoMs`, `wakeScanAtMonoMs`, `wakeAdvanceMs`를 추가했다. hot path 로직(scan 간격, 토글 그리드, deadline)은 변경하지 않았다.

## F3 — 집계 스크립트 시계 gating

`scripts/analyze-live-runs.mjs`에 추가:

- 실행별 `frozenClockConfidence`, `frozenClockUncertaintyMs` (clockConfidence를 실은 마지막 이벤트 기준)
- `clockGatedTiming`: MEDIUM|HIGH + uncertainty ≤ 100ms 실행만의 오픈 대비 지연 집계
- `wakeAdvanceMs` 분포 (구 CSV는 컬럼 부재로 n=0)

기존 26건 재집계 결과 클릭 19건 중 13건이 gate를 통과하고, gated 오픈→클릭 p50은 `+1042ms`로 ungated `+1127ms`와 다르다. 시계 오차가 기존 참고값을 실제로 오염시키고 있었다.

## 검증

- `npm run check`: 303/303 tests (신규 2건: wake sleep-skip 전진분 25ms, pre-scan 소비 전진분 0)
- typecheck, dist validation, MAIN/ISOLATED independence 통과
- `node scripts/analyze-live-runs.mjs` 재실행: 기존 무결성 불변식 유지, clockGatedTiming·frozenClock 필드 출력 확인

## 남은 것

- RT-12: 다음 실오픈 1건을 probe off로 실행해 운영 기본 구성 확인 표본 확보
- RT-13/RT-14: 중요 예약 시즌 이후 조사
- RT-11: 이제 계측이 준비됐으므로 다음 probe-on 진단 실오픈부터 wakeAdvanceMs 표본이 쌓인다
