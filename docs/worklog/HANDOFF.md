# HANDOFF

**갱신:** 2026-07-13
**브랜치:** `codex/tier2-split-analysis` (Tier 2 분석 문서 작업)
**작업 로그:** `docs/worklog/2026-07-13-04-tier2-split-analysis.md`

## 현재 상태 — Tier 1 완료 + Tier 2-1/2-2 분석 분할

`docs/specs/open-timing-performance/01-reference-clock-reliability/` 6단계 전부 완료, main 병합(merge commit `9f5d816`). 이후 개선 3커밋 추가. **216 테스트 green**.

- 버스트 시계동기화 → 상시 ReferenceClock(구간 최대피복 estimator + 히스테리시스 + rolling 샘플러 + uncertainty 기반 armLead + 3-프레임 텔레메트리).
- **dry-run E2E 통과**(40-verification): 카운트다운 표시 버그("+20647일") 포함 총 4건의 버그를 검증 과정에서 잡아 수정.
- **개선 2건 추가 반영**(이번 세션 마지막):
  1. SLOT_DETECTED/SLOT_SELECTED에 감지 시점 시계 스냅샷(`clockUncertaintyMs`·`clockOffsetMs`) 추가 — armed metric이 표본 1개로 얼어붙는 문제 보완(`4666a60`).
  2. `dispatch.ts`로 무효 컨텍스트 sendMessage 동기 throw 삼킴 — 콘솔 "Extension context invalidated" 제거(`f812a5d`).
- Tier 2는 **2-1 shadow 관찰·안전 기반**과 **2-2 제어 경로 활성화**로 분리했다. 2-1은 기존 클릭 경로를 바꾸지 않고 즉시 진행할 수 있으며, 2-2는 실측 GO/REDUCE 판정 전 구현하지 않는다.

## 다음 작업 1 — 실오픈 스큐 검증 (자정 이후, 코드 무변경)

**cho__kwang 잡 오픈 7/14 00:00**이 실행되면 IndexedDB 로그로 Tier 1의 진짜 검증(서버 풀 스큐 방어)을 마친다. **판독 레시피·성공 기준은 `01-reference-clock-reliability/40-verification.md`의 "미완료: 실제 오픈런 스큐 검증" 절에 상세히 있음.** 통과 시 그 문서를 "실오픈 통과"로 갱신 + site-behavior §8에 스큐 폭 기록.

## 다음 작업 2 — Tier 2-1 정찰·설계

Tier 2는 관찰과 제어를 분리했다. 부모 문서 `docs/specs/open-timing-performance/02-availability-hot-path/10-analysis.md`와 Tier 2-1 `01-observation-safety/10-analysis.md`를 먼저 읽는다.

- **Tier 2-1은 즉시 가능:** DevTools 읽기 전용 정찰로 실제 transport(fetch/XHR), request header 접근, `timeSlotMap` 변형과 MAIN/ISOLATED monotonic 기준을 확인한다. 이후 `20-design.md` 승인 → shadow probe·계측·fixture·claim 중재기 TDD. 기존 클릭 경로는 바꾸지 않는다.
- **Tier 2-2는 조건부:** 2-1에서 body 분류의 신뢰성·실질 선행 시간·안전한 actuator를 확인한 뒤 GO/REDUCE/NO-GO로 결정한다. body 신호만으로 DOM 렌더 전 버튼 클릭은 불가능하므로, pre-DOM actuator가 없으면 MutationObserver 기반 DOM claim 가속으로 축소하거나 종료한다.
- 이후 Tier 3(`03-runtime-resilience`) — 개요 스텁만 있음.

## 검증

```bash
npm run check   # WSL: wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check"
git status --short --branch
```

단위·fixture 테스트 216개와 전체 자동 게이트 통과.
