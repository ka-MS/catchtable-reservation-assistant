# HANDOFF

**갱신:** 2026-07-13
**브랜치:** `main` (Tier 2-1 병합 완료)
**작업 로그:** `docs/worklog/2026-07-13-05-tier2-1-shadow-observation.md`

## 현재 상태 — Tier 1 완료 + Tier 2-1 구현·검증 완료

`docs/specs/open-timing-performance/01-reference-clock-reliability/` 6단계 전부 완료. Tier 2-1은 XHR shadow probe, strict classifier, ISOLATED bridge, body/DOM 비교 trace를 구현했고 **228 테스트 green**이다.

- 버스트 시계동기화 → 상시 ReferenceClock(구간 최대피복 estimator + 히스테리시스 + rolling 샘플러 + uncertainty 기반 armLead + 3-프레임 텔레메트리).
- **dry-run E2E 통과**(40-verification): 카운트다운 표시 버그("+20647일") 포함 총 4건의 버그를 검증 과정에서 잡아 수정.
- **개선 2건 추가 반영**(이번 세션 마지막):
  1. SLOT_DETECTED/SLOT_SELECTED에 감지 시점 시계 스냅샷(`clockUncertaintyMs`·`clockOffsetMs`) 추가 — armed metric이 표본 1개로 얼어붙는 문제 보완(`4666a60`).
  2. `dispatch.ts`로 무효 컨텍스트 sendMessage 동기 throw 삼킴 — 콘솔 "Extension context invalidated" 제거(`f812a5d`).
- Tier 2-1 live dry-run에서 body/DOM이 같은 18:30 슬롯을 골랐고 body가 79.4ms 선행했다. 종료 뒤 XHR 원복, trace seq 연속, dropped 0을 확인했다.
- Tier 2-2 판정은 **REDUCE**다. 안전한 pre-DOM actuator가 없어 응답 기반 클릭으로 승격하지 않고, 실제 오픈 표본 뒤 MutationObserver 기반 DOM claim 가속만 검토한다.

## 다음 작업 1 — 실오픈 스큐 검증 (자정 이후, 코드 무변경)

**cho__kwang 잡 오픈 7/14 00:00**이 실행되면 IndexedDB 로그로 Tier 1의 진짜 검증(서버 풀 스큐 방어)을 마친다. **판독 레시피·성공 기준은 `01-reference-clock-reliability/40-verification.md`의 "미완료: 실제 오픈런 스큐 검증" 절에 상세히 있음.** 통과 시 그 문서를 "실오픈 통과"로 갱신 + site-behavior §8에 스큐 폭 기록.

## 다음 작업 2 — Tier 2-2 축소 검토

Tier 2-1의 `40-verification.md`와 `50-adversarial-review.md`를 먼저 읽는다.

- 실제 오픈 empty→populated 실행에서 shadow agreement, body lead, status 0/응답 역전을 추가 수집한다.
- 그 전에는 body 신호를 실제 클릭·토글 중단에 연결하지 않는다.
- 다음 구현 후보는 MutationObserver 기반 DOM 후보 감지이며, 기존 클릭 직전 DOM 재검증을 유지한다.
- 이후 Tier 3(`03-runtime-resilience`) — 개요 스텁만 있음.

## 검증

```bash
npm run check   # WSL: wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check"
git status --short --branch
```

단위·fixture 테스트 228개와 전체 자동 게이트 통과. live match/no-match dry-run도 통과했다.
