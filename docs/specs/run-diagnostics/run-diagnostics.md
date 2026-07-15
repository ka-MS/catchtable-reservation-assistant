# 실행 진단 번들

## 목표

재현이 어려운 예약 흐름 실패를 실행 로그만으로 분석할 수 있도록, 기존 Trace와 별도로 저빈도 DOM 진단 스냅샷을 저장하고 실행 단위 ZIP으로 내보낸다.

## 단계 산출물

- `10-analysis.md`: 현재 증거와 실패 원인, 범위
- `20-design.md`: 스키마, 캡처 정책, 저장·전송·내보내기 계약
- `30-implementation.md`: TDD 구현 순서와 완료 조건
- `40-verification.md`: 자동·수동 검증 결과
- `50-adversarial-review.md`: 적대적 리뷰와 수정 결과

## 핵심 계약

1. 날짜 토글, XHR probe, 슬롯 탐색·클릭 hot path를 변경하지 않는다.
2. 최근 3개의 가벼운 breadcrumb는 Content 메모리에만 보관한다.
3. 정상 종료에서는 breadcrumb를 폐기한다.
4. 예상하지 못한 `HANDED_OFF`, `TIMED_OUT`, `FAILED`에서 breadcrumb와 실패 상세 스냅샷을 저장한다.
5. 정상 예약 폼 인계, 후속 자동 진행 비활성 인계, dry-run 완료, 사용자 중지는 상세 DOM을 저장하지 않는다.
6. 기존 IndexedDB v1의 `runs`, `events`를 보존하며 v2에서 `snapshots`만 추가한다.
7. DOM fragment는 허용 목록 기반으로 정제하고 크기를 제한한다.
8. 실행 삭제·prune은 연결된 스냅샷도 함께 삭제한다.

## 완료 조건

- 기존 v1 데이터 보존 테스트 통과
- 실패 직전 breadcrumb 최대 3개와 실패 snapshot 저장
- 정상 실행 snapshot 0개
- 개인정보 제거와 fragment 크기 상한 검증
- 진단 ZIP이 정의한 파일을 포함하고 표준 ZIP 도구로 열림
- 전체 `npm run check` 통과

