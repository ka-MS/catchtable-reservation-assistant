# 릴리스 프로세스

## 버전 계약

안정 릴리스는 Semantic Versioning의 `X.Y.Z`만 사용한다. Git 태그와
GitHub Release 이름에는 `v`를 붙여 `vX.Y.Z`로 표시한다. Chrome
manifest가 prerelease 문자열을 허용하지 않으므로 별도 prerelease
체계가 승인되기 전까지 beta·RC 버전은 만들지 않는다.

- Major: 저장 설정·예약 작업·telemetry/export schema, 자동화 경계나
  사용자 권한과 호환되지 않는 변경
- Minor: 기존 저장 데이터와 동작을 보존하는 신규 기능
- Patch: 공개 계약을 바꾸지 않는 버그·성능·보안 수정
- 릴리스 없음: `docs`, `test`, `chore`, 호환 `refactor`만 있는 변경

`package.json`의 버전을 원본으로 삼는다. `package-lock.json`의 두
버전 필드와 `manifest.json`은 같은 값을 가져야 하며
`npm run check:version`이 불일치를 차단한다.

## 커밋과 릴리스 PR

Release Please는 `main`에 병합된 Conventional Commit을 집계한다.

| 커밋 | 버전 영향 |
|---|---|
| `fix: ...` | Patch |
| `feat: ...` | Minor |
| `type!: ...` 또는 `BREAKING CHANGE:` | Major |
| `docs:`, `test:`, `chore:`, 호환 `refactor:` | 없음 |

기능 PR에서는 사용자가 실제로 받는 변화를 대표하는 제목을 사용한다.
한 PR 안의 중간 수정 커밋보다 병합 뒤 남을 변경 계약을 우선한다.

### changelog 노출은 버전 영향과 별개다

`release-please-config.json`의 `changelog-sections`가 어떤 타입을 노출할지
정한다. 현재 노출은 `feat`·`fix`·`refactor`·`perf`·`revert`·`deps`이고
`docs`·`test`·`chore`·`build`·`ci`·`style`은 숨긴다.

`refactor:`는 **changelog에 나오지만 버전은 올리지 않는다.** 따라서 구조
변경만 쌓인 구간에서는 릴리스 PR 자체가 생기지 않고, 그 변경들은 다음
`fix:`·`feat:`가 릴리스를 띄울 때 함께 실린다.

구조 변경을 특정 릴리스에 담고 싶다면 **그 릴리스 PR을 병합하기 전에**
해당 `refactor:`를 `main`에 넣어야 한다.

`changelog-sections`는 기본값을 병합하지 않고 **대체한다.** 수정할 때는
남길 타입을 전부 나열한다 — `feat`·`fix`를 빠뜨리면 그것들이 사라진다.

Release Please가 만든 릴리스 PR에서는 다음을 확인한다.

1. `package.json`, `package-lock.json`, `manifest.json` 버전이 같다.
2. CHANGELOG가 사용자에게 의미 있는 기능·수정만 설명한다.
3. Major·Minor·Patch 판정이 위 버전 계약과 일치한다.
4. CI의 `npm run check`가 통과한다.

기본 `GITHUB_TOKEN`으로 만든 PR 이벤트의 CI는 승인 대기 상태가 된다.
Release Please workflow는 생성·갱신한 PR의 head branch로 CI의
`workflow_dispatch`를 호출해 같은 검사를 자동 실행한다. 별도 PAT나
장기 secret은 사용하지 않는다. 자동 실행 결과가 통과한 뒤에만 릴리스
PR을 병합하며, 병합된 릴리스 커밋도 태그 생성 전에 `main` 검증을 다시
통과해야 한다.

Release Please는 자동 생성한 PR의 제목과 release note 형식으로 병합된
릴리스를 판별한다. 일반 PR의 한국어 작성 원칙과 달리 자동 릴리스 PR의
제목과 본문은 기계가 생성한 형식을 유지하고, 필요한 한국어 설명은 PR
댓글에 남긴다.

릴리스할 준비가 될 때만 릴리스 PR을 병합한다. 병합 뒤 Release
Please workflow는 같은 커밋을 다시 검증하고 태그와 GitHub Release를
만든 뒤, manifest가 ZIP 루트에 있는
`catchtable-reservation-assistant-vX.Y.Z.zip`을 첨부한다.

## 첫 v1.0.0

초기 Release Please manifest는 현재 버전 `0.2.0`과 문서 정리 완료
커밋을 bootstrap 기준으로 사용한다. 설정의 일회성 `release-as`가
첫 릴리스만 `1.0.0`으로 지정한다. 첫 릴리스 PR에서
`release-please-config.json`의 `release-as`를 제거한 뒤 병합해 이후
버전은 Conventional Commit으로 판정되게 한다.

bootstrap 이전 커밋을 그대로 나열하지 않는다. 자동 생성된 첫
릴리스 PR의 CHANGELOG는 현재 제품 기능, 안전 경계와 검증 기준을
요약하도록 사람이 정리한다. 과거 spec과 worklog에 기록된 `0.2.0`
실측 버전은 역사 근거이므로 일괄 변경하지 않는다.

## 실패와 복구

- PR 또는 `main` 검증 실패: 버전·태그·Release를 만들지 않고 원인을
  수정한 새 PR을 병합한다.
- Release 생성 뒤 ZIP 업로드 실패: 같은 workflow를 재실행한다.
  업로드는 같은 이름의 자산을 교체할 수 있다.
- 배포 뒤 결함 발견: 공개 태그를 이동·삭제하지 않고 다음 Patch로
  수정한다.
- Major 변경 여부가 불명확하면 자동 판정에 맡기지 않고 릴리스 PR에서
  버전 계약을 먼저 결정한다.
