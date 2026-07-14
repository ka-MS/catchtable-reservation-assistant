# 04 실제 예약 폼 E2E 검증

상태: 완료

| 매장 | 조건 | 최종 URL | Trace | 결과 |
|---|---|---|---|---|
| 비스트로 꼬꼬뜨 | 2026-07-31, 2명, 18:00, 홀 | `/ct/reservation/form?isDepositFree=1&openRegisterCard=0` | 34 events, dropped 0 | `HANDED_OFF` |
| 야키토리묵 | 2026-07-23, 2명, 17:00, 아무거나/첫 메뉴 | `/ct/reservation/form?isDepositFree=1` | 31 events, seq 1~31, dropped 0 | `HANDED_OFF` |

야키토리묵 폼 접근성 트리에서 `07월 23일 (목) · 오후 5시 · 2명 · 테이블`을 확인했다. 비스트로 꼬꼬뜨 런 ID는 `run-1f1179a2-1487-472e-bf28-d1ac15b23ce6`, 야키토리묵 런 ID는 `run-93c563dc-9134-4835-aa25-6de2e283c31a`다.

전체 `npm run check`는 274/274 테스트, dist 검증, 모듈 독립성 검증을 통과했고 `git diff --check`도 통과했다.
