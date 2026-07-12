# 2026-07-12 실행 텔레메트리·히스토리

## 수행

- OpenTelemetry 구조를 참고한 경량 Logger·Processor·Transport·Repository·Viewer 경계를 추가했다.
- Content 로그를 250ms 또는 20건 Port batch로 전송하고 ACK 전까지 보존한다.
- 상세 로그를 IndexedDB에 실행별 저장하고 최근 20건을 보관한다.
- 날짜 왕복 사이클, 슬롯 탐색 수, 클릭 결과와 실패 단계를 구조화했다.
- 수동·예약 시작 실패, 탭 종료와 URL 이탈도 Background trace로 남긴다.
- Side Panel에 실행 선택·삭제·상세 100행 실시간 Viewer를 추가했다.
- JSONL·HTTP·OTLP 확장을 위한 Repository·Exporter 인터페이스를 고정했다.

## 검증

- 전체 테스트 161개 통과
- 타입·배포 산출물·모듈 독립성·diff 검사 통과
- IndexedDB·Port 재연결·ACK·terminal·redaction·증분 UI 테스트 통과

## 사용자 확인

1. `chrome://extensions`에서 확장을 새로고침한다.
2. 실행 로그의 상세 추적에서 날짜 토글 사이클이 연속 표시되는지 확인한다.
3. 실행 종료 후 새 실행을 수행해 이전 실행을 선택·조회할 수 있는지 확인한다.
4. 확장을 다시 새로고침한 뒤에도 최근 실행 상세가 남는지 확인한다.
