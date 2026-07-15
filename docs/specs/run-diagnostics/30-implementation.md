# 실행 진단 구현 계획

## Task 1 - 스키마와 DOM 캡처

1. 진단 공유 타입을 추가한다.
2. 개인정보 정제, 요소 요약, query 근거, 환경, fingerprint 단위 테스트를 작성한다.
3. breadcrumb와 failure snapshot 생성기를 구현한다.

검증: 개인정보가 fragment에 남지 않고 요소·surface·달력·슬롯 구조가 상한 내에서 기록된다.

## Task 2 - Ring buffer와 Orchestrator 배선

1. 최근 3개 breadcrumb를 유지하는 `DiagnosticRecorder` 테스트를 작성한다.
2. 정상 종료 폐기, 실패 시 3+1 snapshot 저장, 중복 실패 방지, ACK flush를 구현한다.
3. `transition`, 주요 action, 기존 diagnostic terminal에 중앙 배선한다.

검증: hot loop trace는 캡처를 호출하지 않고 정상 handoff에는 snapshot이 없다.

## Task 3 - 전송과 IndexedDB v2

1. v1 DB에 기존 run/events를 넣은 뒤 v2를 여는 보존 테스트를 작성한다.
2. `DiagnosticSnapshotRepository`와 `snapshots` store를 구현한다.
3. save/read/delete/prune과 runtime ACK 메시지를 연결한다.

검증: 기존 데이터 보존, idempotent put, run cascade delete가 통과한다.

## Task 4 - 진단 ZIP

1. JSONL·environment·manifest 직렬화 테스트를 작성한다.
2. 무압축 ZIP writer를 구현하고 표준 ZIP 구조를 검증한다.
3. Side Panel에 진단 버튼과 다운로드 경로를 추가한다.

검증: ZIP 파일 목록과 fragment 연결이 일치하고 기존 CSV 동작이 유지된다.

## Task 5 - 전체 검증과 인계

1. 대상 테스트와 `npm run check`를 실행한다.
2. hot path diff와 개인정보·용량·저장 경쟁을 적대적으로 리뷰한다.
3. 발견 사항을 수정하고 `40-verification.md`, `50-adversarial-review.md`, HANDOFF, worklog를 갱신한다.

