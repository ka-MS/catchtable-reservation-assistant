# HANDOFF

**갱신:** 2026-07-10  
**브랜치:** `rebuild/open-run-mvp`  
**작업 로그:** `docs/worklog/2026-07-10-01-rebuild.md`

## 현재 상태

재구축 전 상태 보존, 공식 기준, MV3 스캐폴드, 공유 코어와 실측 Calendar/Slot Adapter까지 구현했다. 오케스트레이터, Background, UI는 아직 구현하지 않았다.

## 다음 작업

1. 서버 HEAD 측정 adapter와 중단 가능한 Scheduler를 구현한다.
2. 오픈런 오케스트레이터를 통합 테스트로 구현한다.
3. Content/Background 메시지와 Side Panel UI를 연결한다.

## 검증

```bash
npm test
git status --short --branch
```

현재 Site Adapter 포함 `npm test`: 20 pass.
