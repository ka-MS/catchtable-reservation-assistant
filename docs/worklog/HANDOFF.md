# HANDOFF

**갱신:** 2026-07-12
**브랜치:** `main`
**작업 로그:** `docs/worklog/2026-07-12-06-failure-snapshot.md`

## 현재 상태

다음 4개 작업을 main에 병합했다(181개 테스트 green):

1. **post-slot 승인제/홍보 자동 진행** — `role="dialog"` 없는 승인제 시트(`request-sheet-v1`)와 홍보 인터스티셜을 인식해 자동 진행. 이시즈에 실런으로 검증 완료(승인제 시트 → 예약 신청 → 예약금 확인 → 예약 폼 도착).
2. **네비게이션 가드 수정** — 성공 경로의 `/ct/reservation/form` 이동을 "식당 이탈"로 오판해 스퓨리어스 STOPPED를 내던 버그를 `leftReservationFlow()`로 수정(실런에서 드러남).
3. **오케스트레이터 구조 리팩터(A)** — 626줄 `start()`를 per-run `RunSession` 메서드 객체로 분해. 동작 무변경.
4. **실패 스냅샷(B+C)** — 실패·포기·예외 시 `captureStageSnapshot`으로 DOM 증거(텍스트 스니펫·fingerprint·실패 단계) 캡처. 정상 인계는 스냅샷 없음, PII 마스킹, 사이드패널·영속 trace 상세에 표시.

## 다음 작업

- **D. 어댑터 DOM 쿼리 중복 제거** — 설계 초안 `docs/specs/orchestrator-refactor/60-dedup-design.md` 있음. main에서 `codex/refactor-adapter-dom` 따서 진행. 5개 어댑터의 `querySelectorAll→isElementHidden→파싱` 중복을 `dom.ts`로 모으고 어댑터 교차 의존(entry→post-slot-inspection) 제거. 동작 무변경.
- 기타 후보: XHR 응답 감시(감지 지연 제거), JSONL 내보내기.

## 검증

```bash
npm run check   # WSL: wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check"
git status --short --branch
```

단위·fixture 테스트 181개와 전체 자동 게이트가 통과했다. 병합 전 브랜치(postslot·A·B/C)는 삭제됐다.
