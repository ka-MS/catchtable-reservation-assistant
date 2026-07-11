# HANDOFF

**갱신:** 2026-07-11  
**브랜치:** `main`
**작업 로그:** `docs/worklog/2026-07-11-13-monotonic-server-clock.md`

## 현재 상태

서버 epoch를 `performance.now()`에 앵커링해 실행 중 Windows 시계 변경이 예약 스케줄로 유입되지 않게 했다. 대기, deadline, 날짜 토글과 서버 상세 로그가 단조 서버 시계를 사용하고, 로컬 실행 기록 시각은 기존 wall epoch를 유지한다. 서버 HEAD RTT도 monotonic 시간으로 측정한다.

## 다음 작업

1. `chrome://extensions`에서 확장 카드를 새로고침한다.
2. 동일 조건에서 인접·목표·감지·선택 로그를 반복 측정한다.
3. 로컬 로그 시각과 서버 상세 시각이 분리돼 표시되는지 확인한다.
4. 목표 날짜의 `계획 ±Nms`와 슬롯 선택의 `오픈 ±Nms`를 비교한다.

## 검증

```bash
npm run check
git status --short --branch
```

현재 구현 기준 단위·fixture 테스트 116개와 전체 자동 게이트가 통과했다. 실제 확장 로그 확인은 새 `dist`를 재로드한 뒤 수행한다.
