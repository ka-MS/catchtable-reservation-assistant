# 릴리스 버저닝

**상태:** 진행
**착수일:** 2026-07-30

## 목표

현재 완성 상태를 `v1.0.0`으로 고정하고, 이후 변경을 일관된
Semantic Version, 자동 검증, GitHub Release와 설치 가능한 확장
ZIP으로 반복 배포한다.

## 범위

- 세 버전 파일의 일치 검사
- PR CI
- Release Please 릴리스 PR·태그·GitHub Release
- 릴리스 커밋의 `dist` ZIP 패키징
- 버전 판정과 실패 복구 절차

Chrome Web Store 게시와 prerelease 채널은 포함하지 않는다.

## 문서

| 문서 | 상태 | 역할 |
|---|---|---|
| [20-design.md](20-design.md) | 확정 | 버전 계약, workflow 책임과 실패 정책 |
| [릴리스 프로세스](../../development/release-process.md) | 운영 기준 | 반복 가능한 실제 릴리스 절차 |

## 완료 조건

- `npm run check`가 버전 불일치를 포함해 전체 검증을 통과한다.
- PR CI와 `main` Release Please workflow가 GitHub에서 유효하다.
- 첫 릴리스 PR이 `1.0.0`과 세 동기화 파일을 제안한다.
- 릴리스 PR 병합 뒤 `v1.0.0` Release와 확장 ZIP이 생성된다.
