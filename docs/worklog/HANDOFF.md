# HANDOFF

**갱신:** 2026-07-10  
**브랜치:** `rebuild/open-run-mvp`  
**작업 로그:** `docs/worklog/2026-07-10-01-rebuild.md`

## 현재 상태

재구축 전 상태 보존, 공식 기준, MV3 스캐폴드와 공유 코어(설정·시간·시계 계산·상태 머신)까지 구현했다. Site Adapter, 오케스트레이터, Background, UI는 아직 구현하지 않았다.

## 다음 작업

1. 실측 fixture를 바탕으로 CalendarAdapter와 SlotAdapter를 구현한다.
2. 서버 HEAD 측정 adapter와 중단 가능한 Scheduler를 구현한다.
3. 오픈런 오케스트레이터, Background, UI를 연결한다.

## 검증

```bash
npm test
git status --short --branch
```

현재 공유 코어 기준 `npm test`: 14 pass.
