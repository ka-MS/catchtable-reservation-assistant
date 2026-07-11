# HANDOFF

**갱신:** 2026-07-11  
**브랜치:** `main`
**작업 로그:** `docs/worklog/2026-07-11-07-entry-pipeline.md`

## 현재 상태

명시적 `entryMode`와 자동 진입 파이프라인을 구현했다. 자동 모드는 목표 식당 이동, dock 예약 CTA, 목표 월·날짜·인원을 준비하고 기존 `PREPARING_PAGE` 안전 검증으로 합류한다. 현재 페이지 모드는 기존 수동 준비 흐름을 유지한다. 웨이팅 전용·미지원 날짜/인원·DOM 시간 초과는 임의 대체 없이 인계한다.

## 다음 작업

1. `chrome://extensions`에서 확장 카드를 새로고침한다.
2. 자동 준비 + dry-run으로 다른 탭에서 목표 식당 이동과 `ENTERING_RESERVATION → SELECTING_DATE → SELECTING_PERSON` 로그를 확인한다.
3. 현재 페이지 사용 모드로 기존 수동 준비 회귀를 확인한다.

## 검증

```bash
npm run check
git status --short --branch
```

현재 전체 코드 기준 `npm run check`: 93 tests pass + typecheck/dist/independence pass. 실제 확장 UI와 탭 이동은 새 dist 재로드 후 사용자 주도 dry-run이 남아 있다.
