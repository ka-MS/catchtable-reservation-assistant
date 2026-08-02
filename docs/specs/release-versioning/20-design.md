# 릴리스 버저닝 설계

## 1. 현재 상태

저장소는 `package.json`, `package-lock.json`, `manifest.json`에
`0.2.0`을 각각 기록하지만 일치 검사가 없다. Git tag, GitHub
Release, CHANGELOG와 Actions workflow도 없다. `main` 병합 전
`npm run check`는 로컬 규칙으로만 존재한다.

## 2. 결정

### D1. 단일 안정 버전

`package.json`을 버전 원본으로 삼고 package lock과 Chrome
manifest가 같은 `X.Y.Z`를 갖게 한다. Chrome 숫자 범위까지
`scripts/check-version.mjs`에서 검사한다.

### D2. PR과 main의 분리된 게이트

PR CI는 읽기 권한으로 `npm ci`, `npm run check`를 실행한다.
`main` push에서는 같은 검증이 끝난 뒤에만 Release Please job에
쓰기 권한을 부여한다. Release Please가 릴리스 PR을 생성하거나
갱신하면 해당 head branch로 PR CI를 자동 dispatch한다.

### D3. Release Please

Node release type이 package와 lock, CHANGELOG를 관리하고
`manifest.json`은 JSON extra-file로 동기화한다. 태그는 component
prefix 없이 `vX.Y.Z`를 사용한다. 첫 실행의 검색 범위는 문서 정리
완료 커밋 뒤로 제한하며 일회성 `release-as` 설정이 첫 버전만
`1.0.0`으로 강제한다. 첫 릴리스 PR에서 이 설정을 제거한다.

PAT는 추가하지 않는다. 기본 `GITHUB_TOKEN`으로 만든 릴리스 PR의
CI 이벤트는 승인 대기 상태가 되므로, Release Please의 `pr` 출력에서
head branch를 읽어 기존 CI를 `workflow_dispatch`로 자동 실행한다.
최종 태그 생성은 병합 뒤 `main` 전체 검증을 반드시 통과해야 한다.

### D4. 같은 workflow의 배포물

기본 `GITHUB_TOKEN`으로 만든 Release 이벤트가 별도 workflow를
연쇄 실행한다고 가정하지 않는다. Release Please가 release를 만든
같은 job에서 해당 SHA를 checkout하고 `dist`를 다시 빌드해 ZIP을
첨부한다.

## 3. 실행 흐름

```text
기능 PR
→ CI
→ main 병합
→ main 전체 검증
→ Release Please 릴리스 PR 생성·갱신
→ 릴리스 PR head에서 CI 자동 실행
→ 사람의 버전·CHANGELOG 검토
→ 릴리스 PR 병합
→ main 전체 검증
→ vX.Y.Z tag·GitHub Release
→ released SHA build
→ dist ZIP 첨부
```

## 4. 실패 정책

- 버전 불일치나 전체 검사 실패 전에는 write job이 실행되지 않는다.
- Release Please에는 contents·issues·pull-requests 쓰기와 릴리스 PR의
  CI dispatch에 필요한 actions 쓰기만 허용한다.
- 외부 Action은 검증한 버전의 전체 commit SHA로 고정한다.
- 공개 릴리스 태그는 이동·재사용하지 않는다.
- ZIP 업로드 재실행은 같은 자산 이름을 교체해 멱등하게 처리한다.

## 5. 검증

- 버전 검사 정상값과 예상 버전 인자 확인
- workflow YAML과 Release Please JSON 구문 확인
- 전체 `npm run check`, `git diff --check`
- 문서 내부 링크와 spec 카탈로그 확인
- 원격 PR CI 성공
- 설정 PR 병합 뒤 `1.0.0` 릴리스 PR 생성 확인
