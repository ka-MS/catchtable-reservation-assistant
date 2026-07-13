# HANDOFF

**갱신:** 2026-07-13
**브랜치:** `main` (Tier 1 병합 완료, 워킹트리 clean)
**작업 로그:** `docs/worklog/2026-07-13-03-tier1-improvements.md`

## 현재 상태 — Tier 1(기준시계 신뢰성) main 병합 완료 + dry-run E2E 통과

`docs/specs/open-timing-performance/01-reference-clock-reliability/` 6단계 전부 완료, main 병합(merge commit `9f5d816`). 이후 개선 3커밋 추가. **216 테스트 green**.

- 버스트 시계동기화 → 상시 ReferenceClock(구간 최대피복 estimator + 히스테리시스 + rolling 샘플러 + uncertainty 기반 armLead + 3-프레임 텔레메트리).
- **dry-run E2E 통과**(40-verification): 카운트다운 표시 버그("+20647일") 포함 총 4건의 버그를 검증 과정에서 잡아 수정.
- **개선 2건 추가 반영**(이번 세션 마지막):
  1. SLOT_DETECTED/SLOT_SELECTED에 감지 시점 시계 스냅샷(`clockUncertaintyMs`·`clockOffsetMs`) 추가 — armed metric이 표본 1개로 얼어붙는 문제 보완(`4666a60`).
  2. `dispatch.ts`로 무효 컨텍스트 sendMessage 동기 throw 삼킴 — 콘솔 "Extension context invalidated" 제거(`f812a5d`).

## 다음 작업 1 — 실오픈 스큐 검증 (자정 이후, 코드 무변경)

**cho__kwang 잡 오픈 7/14 00:00**이 실행되면 IndexedDB 로그로 Tier 1의 진짜 검증(서버 풀 스큐 방어)을 마친다. **판독 레시피·성공 기준은 `01-reference-clock-reliability/40-verification.md`의 "미완료: 실제 오픈런 스큐 검증" 절에 상세히 있음.** 통과 시 그 문서를 "실오픈 통과"로 갱신 + site-behavior §8에 스큐 폭 기록.

## 다음 작업 2 — Tier 2 (새 세션에서 착수)

`docs/specs/open-timing-performance/02-availability-hot-path/10-analysis.md`. MAIN-world fetch 후킹으로 응답 body의 빈→채워짐 전이를 직접 판정(현재는 도착 신호+DOM 스캔) + 원자적 claim guard.

- **그 문서의 "현재 코드 기준선"·"프로세스" 절을 먼저 읽을 것** — Tier 1이 남긴 감지 파이프라인·기준시계·계측 프레임을 정리해뒀다.
- Tier 2는 신규 창작이므로 **brainstorming 스킬로 시작**(구현 전 설계 승인). 착수 전 실오픈 3-프레임 로그로 지연 구간(body 완료→파싱→전이→클릭) 계측해 MAIN-world 승격 필요성 확정.
- 이후 Tier 3(`03-runtime-resilience`) — 개요 스텁만 있음.

## 검증

```bash
npm run check   # WSL: wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check"
git status --short --branch
```

단위·fixture 테스트 216개와 전체 자동 게이트 통과.
