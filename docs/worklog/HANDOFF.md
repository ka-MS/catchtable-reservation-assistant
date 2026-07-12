# HANDOFF

**갱신:** 2026-07-12
**브랜치:** `codex/feat-failure-snapshot`
**작업 로그:** `docs/worklog/2026-07-12-06-failure-snapshot.md`

## 현재 상태

오케스트레이터 리팩터(A) 위에 실패 스냅샷(B+C)을 구현했다. 실패·포기·예외 순간에 단일 범용 `captureStageSnapshot`으로 DOM 증거(url·headings·buttons·textSnippet·fingerprint·실패 단계)를 남긴다. 정상 인계 2곳(폼 도착·postSlotEnabled=false)은 스냅샷 없이, 나머지 포기/예외는 `diagnosticHandOff`/`timedOut`로 중앙집중해 첨부한다. PII(전화·이메일) 마스킹, snippet은 dialog/sheet에서만. 사이드패널 이벤트 로그에 스냅샷 라인 표시.

## 브랜치 스택 (병합 순서)

1. `codex/fix-postslot-timeout-diagnostics` (승인제 시트·홍보 인터스티셜, 수동 검증 대기)
2. `codex/refactor-orchestrator-session` (A 구조 리팩터, 동작 무변경)
3. `codex/feat-failure-snapshot` (B+C, 현재)

## 다음 작업

1. `chrome://extensions` 재로드 후 실사용 확인: unknown 유발 화면에서 이벤트 로그에 `스냅샷:` 라인·textSnippet이 남는지, 정상 폼 도착엔 스냅샷 없는지.
2. 위 순서대로 병합(각 하위 브랜치 수동 검증 후).
3. 남은 후보: D(어댑터 DOM 쿼리 중복 제거), XHR 응답 감시, JSONL 내보내기.

## 검증

```bash
npm run check   # WSL: wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check"
git status --short --branch
```

단위·fixture 테스트 177개와 전체 자동 게이트가 통과했다. 기존 orchestrator 18개는 무수정 통과.
