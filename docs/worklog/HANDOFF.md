# HANDOFF

**갱신:** 2026-07-12
**브랜치:** `codex/fix-postslot-timeout-diagnostics`
**작업 로그:** `docs/worklog/2026-07-12-04-request-sheet-promo.md`

## 현재 상태

이시즈에 실전 런의 5초 시간초과 원인을 라이브 재현으로 특정했다: 승인제 안내 바텀시트가 `role="dialog"` 없이 떠서 판정에 잡히지 않았다 (site-behavior §7.2). ① 시간초과 인계에 마지막 inspection 진단을 싣는 수정, ② `request_notice`(`예약 신청` 자동 클릭)·`promo_interstitial`(`다음에 볼게요` 자동 닫기, 진입 단계 포함) 자동 진행을 이 브랜치에 담았다.

## 다음 작업

1. `chrome://extensions`에서 확장 카드를 새로고침한다.
2. 이시즈에(승인제, 슬롯 살아 있음)로 실전/테스트 런: 승인제 시트 자동 진행과 `예약 신청` 이후 화면이 로그에 남는지 확인한다.
3. 수동 확인이 끝나면 `main`에 병합하고 브랜치를 삭제한다.
4. 이후 후보: trace 상세 뷰에서 unknown 이벤트의 dialogTitle·dialogButtons 우선 표시, `draftStopAtDirty` 잔존 키 정리, JSONL 내보내기, XHR 응답 감시.

## 검증

```bash
npm run check
git status --short --branch
```

단위·fixture 테스트 162개와 전체 자동 게이트가 통과했다. 실제 확장 확인은 새 `dist` 재로드 후 수동으로 수행한다.
