# HANDOFF

**갱신:** 2026-07-12
**브랜치:** `codex/feat-xhr-slot-watch`
**작업 로그:** `docs/worklog/2026-07-12-13-xhr-watch.md`

## 현재 상태

XHR 슬롯 응답 감시(콰이어스 + 도착 버스트)를 구현했다(203개 테스트 green). 스펙 `docs/specs/xhr-slot-watch/`(10-analysis-design, 20-implementation).

1. **정찰(worklog 12)** — R1·R2·R3·R5 실측(site-behavior §8.1). 실오픈런 판독으로 병목 확정: 클릭→XHR 발사 SPA 지연 217~379ms + 토글 연타의 비행 중 렌더 파괴 → 실오픈 감지 +1303ms.
2. **`slot-refresh-watch.ts` 어댑터** — PerformanceObserver로 `/dining/time-slots` 도착 신호.
3. **오케스트레이터 3-모드 감지** — 신호 없으면 현행 그리드(폴백, 기존 테스트 무수정 통과가 가드) / live+도착 전 콰이어스(클릭+700ms) / 도착 후 버스트(도착+250ms). 계측: SLOT_DETECTED `xhrArrivalServerAtMs`·`arrivalToDetectMs`, DATE_TOGGLE_CYCLE `watch`·`arrivalAt`.
4. 시계 노이즈는 표본 9로 해소 확인(worklog 11, 초기/최종 78ms 수렴).

## 다음 작업

- **E2E(R4 확정) 재개** — 확장은 dist 재로드까지 완료. Chrome 원격 디버깅 재연결 후: 이시즈에 실런 1회 → IndexedDB의 DATE_TOGGLE_CYCLE `watch:"live"` 확인(=R4 확정, site-behavior §8.1 갱신) + `xhrArrivalServerAtMs` 기록 확인. idle만 보이면 방식 C(webRequest) 재평가.
- E2E 통과 후 main 병합. 실오픈런에서 감지 ≤ +500ms 검증(현행 +1303ms).
- 2단계 후보(별도 스펙): 목표 클릭 openAt−250ms 선발사 — 게이트 시점 계측 후 판단.
- 기타 후보: JSONL 내보내기.

## 검증

```bash
npm run check   # WSL: wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check"
git status --short --branch
```

단위·fixture 테스트 203개와 전체 자동 게이트가 통과했다.
