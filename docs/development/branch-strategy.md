# 브랜치 전략

## 기본 브랜치

- `main`은 Chrome에 로드해 사용하는 검증 완료 상태만 유지한다.
- `main`에서 직접 기능을 개발하지 않는다.
- 긴급한 단일 수정도 작업 브랜치에서 검증한 뒤 병합한다.

## 작업 브랜치

- 기능: `codex/feat-<짧은 이름>`
- 수정: `codex/fix-<짧은 이름>`
- 문서: `codex/docs-<짧은 이름>`
- 구조 리팩터: `codex/refactor-<짧은 이름>`
- 릴리스·도구: `codex/chore-<짧은 이름>`
- 큰 재설계만 별도 장기 브랜치를 사용한다.

작업 브랜치는 최신 `main`에서 만들고 한 가지 목적만 포함한다. 완료 후 `main`에 병합하고 삭제한다.

## 병합 기준

병합 전 다음 명령이 모두 통과해야 한다.

```bash
npm run check
git diff --check
```

실사이트 동작에 영향을 주는 변경은 관련 fixture 또는 회귀 테스트와 수동 검증 결과를 함께 남긴다. 미실측 동작은 추측으로 자동화하지 않는다.

## 릴리스

별도 release 브랜치는 두지 않는다. Release Please가 `main`의
Conventional Commit을 집계해 하나의 릴리스 PR을 유지한다. 릴리스
PR을 병합하면 검증된 커밋에 `v<major>.<minor>.<patch>` 태그와
GitHub Release를 만들고 빌드된 확장 ZIP을 첨부한다.

버전 판정, 첫 `v1.0.0`과 실패 복구 절차는
[릴리스 프로세스](release-process.md)를 따른다.
