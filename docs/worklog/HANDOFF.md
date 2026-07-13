# HANDOFF

**갱신:** 2026-07-14
**브랜치:** `main` (실제 오픈 검증 병합 완료)
**작업 로그:** `docs/worklog/2026-07-14-01-actual-open-verification.md`

## 현재 상태 — Tier 1·Tier 2-1 실제 오픈 검증 완료

`docs/specs/open-timing-performance/01-reference-clock-reliability/` 6단계 전부 완료. Tier 2-1은 XHR shadow probe, strict classifier, ISOLATED bridge, body/DOM 비교 trace를 구현했고 **228 테스트 green**이다.

- 버스트 시계동기화 → 상시 ReferenceClock(구간 최대피복 estimator + 히스테리시스 + rolling 샘플러 + uncertainty 기반 armLead + 3-프레임 텔레메트리).
- **dry-run E2E 통과**(40-verification): 카운트다운 표시 버그("+20647일") 포함 총 4건의 버그를 검증 과정에서 잡아 수정.
- **개선 2건 추가 반영**(이번 세션 마지막):
  1. SLOT_DETECTED/SLOT_SELECTED에 감지 시점 시계 스냅샷(`clockUncertaintyMs`·`clockOffsetMs`) 추가 — armed metric이 표본 1개로 얼어붙는 문제 보완(`4666a60`).
  2. `dispatch.ts`로 무효 컨텍스트 sendMessage 동기 throw 삼킴 — 콘솔 "Extension context invalidated" 제거(`f812a5d`).
- Tier 2-1 live dry-run에서 body/DOM이 같은 18:30 슬롯을 골랐고 body가 79.4ms 선행했다. 종료 뒤 XHR 원복, trace seq 연속, dropped 0을 확인했다.
- 2026-07-14 조광201 실제 오픈에서 `EMPTY → POPULATED`, body/DOM 20:00 일치와 body 47.7ms 선행을 확인했다. 슬롯 클릭은 +1011ms, 예약 폼 최초 도착은 +1835ms였다.
- 실제 run `run-c5463a0b-ffe0-447b-a619-f9c545181ac0`은 34/34 events, seq 연속, dropped 0, 최종 `HANDED_OFF`다.
- Tier 2-2 판정은 **REDUCE** 유지다. 안전한 pre-DOM actuator가 없어 응답 기반 직접 클릭으로 승격하지 않는다.

## 현재 체크포인트 — 실오픈 판독 후 정확성 안정화

실오픈 기준선 판독은 완료했다. 날짜 불문 `lastArrivalAt`이 canceled 인접 요청에도 갱신될 수 있음을 확인했으므로 Tier 2-2는 target 날짜·인원이 검증된 body 이벤트만 상관 신호 후보로 사용해야 한다.

## Tier 2-2 진입 Blocking Backlog

실오픈 기준선 판독이 끝난 뒤 다음 항목을 처리하고 검증하기 전에는 Tier 2-2 구현으로 진행하지 않는다.

- `RT-01`: 슬롯 클릭 dispatch와 화면 전환 확인 분리
- `RT-03`: SlotAdapter 조상 가시성 검사

참조: `docs/backlog/post-tier2-1-stabilization.md`

`Blocks`가 `없음`인 다른 backlog 항목은 남아 있어도 Tier 2-2 진입을 자동으로 막지 않는다.

## 다음 작업 1 — 정확성 안정화

- RT-01: 슬롯 클릭 dispatch와 후속 화면 전환 확인 분리
- RT-03: SlotAdapter 조상 가시성 검사
- 두 항목을 분석→설계→구현→검증→적대적 리뷰로 완료하기 전 Tier 2-2 구현에 진입하지 않는다.

## 다음 작업 2 — Tier 2-2 축소 설계

Tier 2-1의 `40-verification.md`와 `50-adversarial-review.md`를 먼저 읽는다.

- 실제 오픈 근거는 `01-observation-safety/40-verification.md` §7과 최신 worklog를 사용한다.
- 날짜·인원이 검증된 target body 이벤트로만 좁은 MutationObserver 또는 즉시 DOM 스캔을 깨운다.
- body 신호만으로 직접 클릭하지 않고 기존 클릭 직전 DOM 재검증을 유지한다.
- body 이벤트가 없으면 기존 bounded DOM 경로로 폴백한다.
- 이후 Tier 3(`03-runtime-resilience`) — 개요 스텁만 있음.

## 검증

```bash
npm run check   # WSL: wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check"
git status --short --branch
```

단위·fixture 테스트 228개와 전체 자동 게이트 통과. live match/no-match dry-run도 통과했다.
