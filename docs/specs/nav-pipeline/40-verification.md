# 네비게이션 파이프라인 검증

**검증:** 2026-07-11

## 자동 검증

- `npm run check`: 성공
- Node test: 93 pass, 0 fail
- strict typecheck: 성공
- dist/독립성 검사: 성공
- `git diff --check`: 성공

## 핵심 회귀

- dock 밖의 동일 문구 예약 버튼 click 0회
- 웨이팅 전용 CTA click 0회
- 월 전환 완료 전 다음/이전 버튼 중복 click 0회
- 목표 인원 미존재 시 다른 인원 click 0회
- 자동 준비 뒤 기존 날짜·인접 날짜 안전 검증 실행
- 구 `pagePrepared` draft를 명시적 `entryMode`로 변환

## 실사이트 근거

스시서정에서 월 머리글과 `Previous page`/`Next page`를 확인하고 7월→8월→7월 전환을 원상복구했다. 인원 라디오는 `value=1..80` 80개가 유일하며 선택 상태는 native `checked`였다.
