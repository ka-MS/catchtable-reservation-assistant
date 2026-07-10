# HANDOFF

**갱신:** 2026-07-10  
**브랜치:** `rebuild/open-run-mvp`  
**작업 로그:** `docs/worklog/2026-07-10-01-rebuild.md`

## 현재 상태

재구축 전 상태가 `cb15c27`에 보존됐고 기존 자산 분류, 실측 이관, 새 공식 제품·UI·경계·상태·아키텍처·테스트·구현 계획이 작성됐다. 아직 새 구현으로 교체하지 않았다.

## 다음 작업

1. 과거 공식 문서에 폐기 표시를 추가하고 중복 진행 디렉터리를 제거한다.
2. 실패 구현과 테스트를 새 프로젝트 기반으로 교체한다.
3. `docs/plans/mvp-implementation.md` 순서로 TDD 구현한다.

## 검증

```bash
npm test
git status --short --branch
```

현재 스냅샷 기준 `npm test`: 7 pass. 이 테스트들은 새 구현 게이트가 아니며 교체 대상이다.
