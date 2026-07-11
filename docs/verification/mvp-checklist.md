# MVP 검증 체크리스트

**검증일:** 2026-07-11
**브랜치:** `codex/feat-entry-pipeline`

## 자동 검증

- [x] `npm run typecheck`
- [x] `npm test` — 93 pass, 0 fail
- [x] `npm run check:dist`
- [x] `npm run check:independence`
- [x] Manifest V3이며 `content_scripts`가 없음
- [x] Content Script IIFE에 정적 import가 없음
- [x] dry-run 통합 시나리오 click 0회
- [x] 실제 모드 통합 시나리오 슬롯 click 1회 후 `HANDED_OFF`
- [x] 종료 시각 도달 시 click 0회와 `TIMED_OUT`
- [x] 이벤트 storage 쓰기 직렬화
- [x] 자동 탭 이동 완료 대기와 URL 정규화
- [x] 예약 CTA·월 이동·날짜·인원 Adapter fixture
- [x] 자동 준비 상태 전이와 웨이팅/미지원 인원 안전 인계

실행 명령:

```bash
npm run check
```

## 읽기 전용 실사이트 확인

대상: `https://app.catchtable.co.kr/ct/shop/taeo?type=DINING&date=260711`

- [x] `main button[data-busy]` 슬롯 49개 확인
- [x] 표시 복제본은 `aria-hidden` 없음, 화면 밖 복제본은 `aria-hidden="true"` 확인
- [x] `data-duplicate-index`와 한국어 시간 텍스트 확인
- [x] 어떤 슬롯·날짜·예약 버튼도 클릭하지 않음
- [ ] 달력 모달이 닫혀 있어 현재 세션에서 날짜 셀 재확인은 수행하지 않음

## Side Panel 시각 확인

- [x] 빌드된 `dist/sidepanel/sidepanel.html` 렌더링
- [x] 예약 오픈 일시와 감시 종료 시각이 별도 필드로 표시됨
- [x] 희망 시간 범위와 시간 우선순위 편집 UI 표시
- [x] 명시적 자동/현재 페이지 준비 모드와 dry-run 표시
- [x] 상태·시계·실행 기록 영역 표시
- [x] 필드 텍스트 겹침 없음

## Chrome 확장 수동 게이트

Chrome 특수 페이지는 자동 제어 정책상 접근하지 못했으므로 다음 항목은 사용자가 새 `dist/`를 재로드한 뒤 확인해야 한다.

- [ ] `chrome://extensions`에서 확장 카드 새로고침
- [ ] Side Panel에 새 “예약 오픈런” UI가 표시됨
- [ ] 자동 페이지 준비 모드 선택
- [ ] 1분 뒤 오픈 시각, dry-run으로 시작
- [ ] `NAVIGATING -> CONFIGURED -> VALIDATING -> SYNCING_CLOCK -> ENTERING_RESERVATION -> SELECTING_DATE -> SELECTING_PERSON -> PREPARING_PAGE -> WAITING_FOR_OPEN` 확인
- [ ] T-3초부터 인접 날짜·목표 날짜 토글 확인
- [ ] 슬롯 감지 시 `DRY_RUN_COMPLETED`, 실제 슬롯 화면 이동 없음 확인
- [ ] 중지 또는 감시 종료 뒤 추가 날짜 토글 없음 확인

실제 슬롯 클릭과 슬롯 이후 예약 단계는 이 체크리스트의 자동 검증 범위가 아니다.
