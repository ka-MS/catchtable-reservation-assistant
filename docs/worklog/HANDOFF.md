# HANDOFF

**갱신:** 2026-07-12
**브랜치:** `main`
**작업 로그:** `docs/worklog/2026-07-12-13-xhr-watch.md`

## 현재 상태

XHR 슬롯 응답 감시(콰이어스 + 도착 버스트)를 구현했다(203개 테스트 green). 스펙 `docs/specs/xhr-slot-watch/`(10-analysis-design, 20-implementation).

1. **정찰(worklog 12)** — R1·R2·R3·R5 실측(site-behavior §8.1). 실오픈런 판독으로 병목 확정: 클릭→XHR 발사 SPA 지연 217~379ms + 토글 연타의 비행 중 렌더 파괴 → 실오픈 감지 +1303ms.
2. **`slot-refresh-watch.ts` 어댑터** — PerformanceObserver로 `/dining/time-slots` 도착 신호.
3. **오케스트레이터 3-모드 감지** — 신호 없으면 현행 그리드(폴백, 기존 테스트 무수정 통과가 가드) / live+도착 전 콰이어스(클릭+700ms) / 도착 후 버스트(도착+250ms). 계측: SLOT_DETECTED `xhrArrivalServerAtMs`·`arrivalToDetectMs`, DATE_TOGGLE_CYCLE `watch`·`arrivalAt`.
4. 시계 노이즈는 표본 9로 해소 확인(worklog 11, 초기/최종 78ms 수렴).

## 다음 작업

- **실오픈런 성능 검증** — E2E(안전 점검)는 통과: `watch:"live"`(R4 확정), 도착 +102ms → 감지 +150ms, 시계 초기/최종 3.7ms 일치. 다음 실제 오픈런(예: 7/13 10:50 예정 잡)에서 감지 ≤ +500ms(기존 +1303ms) 확인. `xhrArrivalServerAtMs`로 ct-api 게이트 시점도 판별.
- 2단계 후보(별도 스펙): 목표 클릭 openAt−250ms 선발사 — 게이트 시점 계측 후 판단.
- 기타 후보: JSONL 내보내기.

## 검증

```bash
npm run check   # WSL: wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check"
git status --short --branch
```

단위·fixture 테스트 203개와 전체 자동 게이트가 통과했다.
