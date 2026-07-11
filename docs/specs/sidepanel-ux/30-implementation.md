# 사이드패널 UX 개선 구현 계획

**Goal:** `20-design.md`의 채택 항목을 표현 계층 변경만으로 구현한다.

**Architecture:** 순수 뷰 모델(`job-list-model.ts`) → HTML/CSS 재구성 → `index.ts` 배선. background·메시지 계약은 건드리지 않는다.

## Global Constraints

- 병합 게이트: WSL에서 `npm run check` + `git diff --check`
- 오류 표시(`#form-error`)는 모든 화면에서 보여야 하므로 헤더로 이동한다(홈의 삭제 실패 오류가 폼 전용 액션바에 갇히면 안 됨)

### Task 1: 뷰 모델

- Create: `src/sidepanel/job-list-model.ts` — `jobListModel(jobs)`(활성 openAt 오름차순 유지 / 완료 updatedAt 내림차순 / `doneLabel`), `miniLogModel(events)`(최신 3건 최신순 + 빈 상태 문구)
- Test: `tests/job-list-model.test.mjs`

### Task 2: HTML/CSS

- `sidepanel.html`: 헤더에 세그먼티드 내비(작업/예약 설정/실행 로그)와 전역 오류 라인 추가. 홈 타이틀 행 + 컴팩트 `+ 새 예약`, 완료 접기 토글·목록. 폼 타이틀(`#form-title`)과 '최근 설정' 아래 미니 로그 카드. 실행 화면 runtime-tools에 `실행 중지` 이동. 푸터는 `예약 저장 | 지금 시작` 2버튼만, 기본 `hidden`.
- `sidepanel.css`: `.view-nav` pill, `.primary.compact`, `.view-title-row`, `.archive-toggle`, `.mini-log*`, `.action-bar` 2열 grid. `body[data-view="form"]`일 때만 하단 여백 96px, 그 외 24px. Task 6에서 만든 `.wide-button` 제거(내 부산물 정리).

### Task 3: index.ts

- 내비 클릭 → `setView`. `setView`는 `document.body.dataset.view` 설정, 액션바 표시 제어, `aria-current` 갱신, 폼 타이틀(새 예약/작업 편집) 갱신. `back-home` 제거.
- `renderJobs`: `jobListModel`로 활성/완료 분리 렌더, 완료 토글(기본 접힘, 라벨 ▾/▴).
- `renderRuntime`에서 `renderMiniLog()` 호출(폼 미니 로그, `전체 보기` → 실행 화면).
- 실행 중지·자동 전환·카운트다운 소스 규칙은 기존 유지.

### Task 4: 게이트·문서

- `npm run check` + `git diff --check`
- 워크로그 `2026-07-12-01-sidepanel-ux.md`, HANDOFF 갱신, 커밋
