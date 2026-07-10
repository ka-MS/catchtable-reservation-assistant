# HANDOFF

**갱신:** 2026-07-10  
**브랜치:** `rebuild/open-run-mvp`  
**작업 로그:** `docs/worklog/2026-07-10-01-rebuild.md`

## 현재 상태

재구축 전 상태 보존, 공식 기준 확정, 과거 문서 폐기와 깨끗한 MV3 스캐폴드 교체까지 완료했다. 아직 오픈런 코어 로직과 UI는 구현하지 않았다.

## 다음 작업

1. 설정·시간·상태 머신 단위 테스트부터 TDD로 구현한다.
2. 서버 시계 표본 선택과 fallback을 구현한다.
3. 실측 fixture를 바탕으로 Site Adapter와 오픈런 오케스트레이터를 구현한다.

## 검증

```bash
npm test
git status --short --branch
```

현재 새 스캐폴드 기준 `npm test`: 2 pass.
