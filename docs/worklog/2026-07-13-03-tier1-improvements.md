# 2026-07-13-03 Tier 1 병합 + 개선 2건 + 자정 검증 대기

## 개요

Tier 1(기준시계 신뢰성)을 main에 병합(`9f5d816`)하고, dry-run E2E에서 관찰된 두 개선을 TDD로 추가했다. 실오픈 스큐 검증은 자정(cho__kwang 7/14 00:00) 잡 실행 후로 미룬다.

## 병합

`--no-ff`로 Tier 1 브랜치(`codex/tier1-reference-clock`, 15커밋)를 main에 병합. 브랜치 삭제. 병합 후 main 216 테스트 green(개선 커밋 포함).

## 개선 2건 (dry-run E2E에서 관찰)

1. **감지 시점 시계 스냅샷** (`4666a60`) — armed metric은 WAITING_FOR_OPEN 진입 시점에 (종종 표본 1개로) 얼어붙는데, rolling 샘플러가 대기 중 조용히 개선한다(re-anchor). 그래서 SLOT_DETECTED/SLOT_SELECTED에 감지 순간의 `clockConfidence`·`clockUncertaintyMs`·`clockOffsetMs`(wall 델타)를 실어, 실오픈 분석 시 실제로 활성이던 estimate를 보게 했다. `detectionClockData()` 헬퍼.
2. **emit 견고성** (`f812a5d`) — 확장 리로드 후 남은 stale content script가 무효 컨텍스트에서 `chrome.runtime.sendMessage`를 호출하면 프라미스 거부가 아니라 **동기 throw**가 나 콘솔에 "Extension context invalidated" 미처리 에러로 떴다. `.catch()`로는 못 잡으므로 `dispatch.ts`의 `dispatchRunEvent`로 try/catch + async 거부 삼킴을 일원화.

## 실오픈 관찰 (run-91b6ee44, 이시즈에, 이미 열린 매장)

실제 실행(dryRun=false)에서 openDelta **−493ms**(오픈 493ms 전 클릭)를 관찰. **정상**으로 판정:

- 시계가 초기에 불확실(표본 1, offset 432ms ±529 LOW) → armLead가 `200+529+58=787ms`로 넓어짐(설계대로).
- REFRESHING_SLOTS가 오픈 787ms 전 시작 → **이미 열린 매장**이라 슬롯이 상시 존재 → 첫 사이클에서 즉시 감지·클릭 = 오픈 493ms 전.
- 실제 미개장 매장이라면 오픈 전엔 슬롯이 없어 NO_SLOT만 반복하다 진짜 오픈 직후 클릭 → openDelta 양수. 음수는 "열린 매장 테스트" 특유. 안전 속성(슬롯 실제 존재 시에만 클릭)은 유지.
- offset 432ms는 표본 1개 LOW 추정으로 실제(네이비즘 ~0)와의 오차가 ±529 band 내 — 시계가 "모름"을 정직하게 LOW로 표현하고 armLead를 넓힌 뒤 응답 주도로 클릭한 정상 사례.

## 다음

- **자정 실오픈 스큐 검증** — 판독 레시피는 `01-reference-clock-reliability/40-verification.md`.
- **Tier 2** 새 세션 착수 — 진입점·기준선은 `02-availability-hot-path/10-analysis.md` + HANDOFF.

## 검증

`npm run check` 216 테스트 green, dist·독립성 게이트 통과.
