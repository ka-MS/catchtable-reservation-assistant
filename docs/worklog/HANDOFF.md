# HANDOFF

**갱신:** 2026-07-12
**브랜치:** `main`
**작업 로그:** `docs/worklog/2026-07-12-08-clock-sample-detail.md`

## 현재 상태

D(어댑터 DOM 중복 제거)까지 main에 병합했고(185개 테스트 green), 병합 후 실런 1회로 전 파이프라인을 검증했다(진입 → 날짜 → 슬롯 감지 +293ms → 승인제 시트 → 예약금 → 폼 도착 +999ms).

1. **post-slot 승인제/홍보 자동 진행** — `role="dialog"` 없는 승인제 시트(`request-sheet-v1`)와 홍보 인터스티셜을 인식해 자동 진행. 이시즈에 실런으로 검증 완료(승인제 시트 → 예약 신청 → 예약금 확인 → 예약 폼 도착).
2. **네비게이션 가드 수정** — 성공 경로의 `/ct/reservation/form` 이동을 "식당 이탈"로 오판해 스퓨리어스 STOPPED를 내던 버그를 `leftReservationFlow()`로 수정(실런에서 드러남).
3. **오케스트레이터 구조 리팩터(A)** — 626줄 `start()`를 per-run `RunSession` 메서드 객체로 분해. 동작 무변경.
4. **실패 스냅샷(B+C)** — 실패·포기·예외 시 `captureStageSnapshot`으로 DOM 증거(텍스트 스니펫·fingerprint·실패 단계) 캡처. 정상 인계는 스냅샷 없음, PII 마스킹, 사이드패널·영속 trace 상세에 표시.
5. **어댑터 DOM 중복 제거(D)** — `dom.ts`에 보이는 요소·disabled·safeText·FNV 헬퍼를 모으고, `dialog.ts`로 화면 파인더를 분리했다. entry·snapshot의 post-slot 교차 의존을 제거하면서 기존 판정 동작과 fingerprint를 유지했다.

## 다음 작업

- **타이밍 병목 진단(계측 배포됨)** — 시계 metric에 `clockSampleDetail`(샘플별 오프셋·지연·Date 틱 델타)이 추가됐다(worklog 08). 다음 실런 로그에서 초기/최종 보정 1,234ms 불일치의 원인(고지연 비대칭 vs 백엔드 시계 편차)을 판별한다.
- **XHR 응답 감시(감지 지연 제거)** — 토글 사이클 구조상 감지 창이 사이클당 수십 ms뿐이라 감지가 오픈 후 2~3사이클(+200~300ms)로 양자화된다. 슬롯 XHR 응답을 직접 감시하면 이 양자화가 사라진다.
- 기타 후보: JSONL 내보내기.

## 검증

```bash
npm run check   # WSL: wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check"
git status --short --branch
```

단위·fixture 테스트 185개와 전체 자동 게이트가 통과했다. content bundle은 86.6KB에서 84.8KB로 감소했다.
