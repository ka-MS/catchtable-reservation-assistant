# HANDOFF

**갱신:** 2026-07-10  
**브랜치:** `rebuild/open-run-mvp`  
**작업 로그:** `docs/worklog/2026-07-10-01-rebuild.md`

## 현재 상태

오픈런 MVP의 서버 시각 보정과 날짜 토글을 정밀화했다. HTTP Date 초 경계 추정, 오픈 직전 재동기화, 서버 오픈 시각에 위상 고정된 150ms 토글 버스트가 구현됐다. 테이블 타입 화면은 사용자 제공 이미지로 존재만 확인했고 DOM 실측은 남아 있다.

## 다음 작업

1. 테이블 타입 모달을 다시 열어 둔 상태에서 DOM 역할·속성·선택 상태를 실측한다.
2. 선택기가 확인되면 `있으면 선택 후 다음`, `없으면 예약 폼 인계` 단계를 구현한다.
3. `chrome://extensions`에서 확장 카드를 새로고침하고 수동 dry-run을 수행한다.

## 검증

```bash
npm test
git status --short --branch
```

현재 전체 코드 기준 `npm run check`: 40 tests pass + dist/independence pass.
