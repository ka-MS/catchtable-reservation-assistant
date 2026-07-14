# 실행 Trace CSV 내보내기 short-cut

**작성일:** 2026-07-14
**상태:** 구현·자동 검증 완료, Chrome live 확인 대기

## 목표

여러 Chrome 프로필에 분리 저장된 실행 Trace를 선택 실행 단위 CSV로 내려받아 외부에서 취합·분석할 수 있게 한다.

## 계약

- 상세 추적 제목 우측에 `[CSV] [삭제]` 순서로 버튼을 둔다.
- 종료된 실행을 선택했을 때만 CSV와 삭제 버튼을 활성화한다.
- 상세 추적 화면은 기존대로 최신 100개 이벤트만 렌더링한다.
- CSV는 화면에 표시된 목록이 아니라 IndexedDB에 저장된 해당 run 전체 이벤트를 읽는다.
- `GET_RUN_TRACE`의 화면 조회 상한 500개는 유지하고, `EXPORT_RUN_TRACE` 읽기 전용 메시지를 별도로 사용한다.
- 저장 schema, 최근 20개 run 보존 정책, trace 기록 경로는 변경하지 않는다.
- 다운로드는 `Blob`과 임시 `<a download>`를 사용하고 새 Chrome 권한이나 외부 CSV 라이브러리를 추가하지 않는다.

## CSV 형식

- UTF-8 BOM을 포함한다.
- run 정보와 event 기본 필드는 각 행에 포함한다.
- `attributes`는 전체 이벤트의 key 합집합을 `attr.<key>` 열로 펼친다.
- `localAt`, `serverAt`, `startedAt`, `finishedAt`, `openAtMs`, `stopAtMs`는 원본 epoch ms와 `Asia/Seoul` 사람이 읽을 수 있는 열을 함께 둔다.
- `*MonoMs`와 구간 지연 값은 절대시각으로 변환하지 않고 원본 숫자를 유지한다.
- 쉼표, 큰따옴표, 개행은 RFC 4180 방식으로 escape한다.
- 파일명은 `catchtable_<shop>_<reservationDate>_<runId>.csv`로 생성하고 파일명에 부적합한 문자는 `_`로 치환한다.

## 완료 조건

1. 500개를 초과한 run도 전체 이벤트를 내보낸다.
2. KST 시간과 원본 epoch 값이 모두 보존된다.
3. 동적 attribute, 쉼표, 큰따옴표, 개행이 손실 없이 CSV에 기록된다.
4. 실행 중 run에서는 CSV 버튼이 비활성이다.
5. `npm run check`가 통과한다.

## 제외 범위

- 여러 run 일괄 내보내기
- IndexedDB 전용 조회 화면
- CSV 가져오기
- 원격 수집기 전송
- 예약 hot path와 성능 상수 변경

## 검증 결과

- CSV·Trace UI·IndexedDB·정적 UI 대상 테스트 19/19 통과
- 501개 이벤트 전체 조회와 화면용 최신 100개 조회 분리 확인
- `npm run check`: 278/278 tests, typecheck, dist validation, MAIN/ISOLATED independence 통과
- 예약 오케스트레이터, 날짜 토글, XHR probe, wake, SlotAdapter 변경 없음
- Chrome DevTools MCP는 `DevToolsActivePort`가 없어 연결되지 않았다. 확장 재로드 뒤 실제 CSV 다운로드 확인은 남아 있다.
