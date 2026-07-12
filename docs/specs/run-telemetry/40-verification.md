# 실행 텔레메트리 검증

## 자동 검증

- record 경로가 동기 queue push만 수행
- 시간·크기 batch와 trace overflow 정책
- terminal force flush와 ACK timeout
- Port disconnect 후 미확인 batch 재전송
- `(runId, seq)` 중복 put의 멱등성
- IndexedDB run/event 저장·조회·삭제·최근 20건 보존
- Background 시작 실패 기록
- 날짜 토글 성공·무슬롯·클릭 실패·선택 미확인 trace
- Viewer batch 증분 렌더링과 100행 제한
- URL query·HTML·입력값·결제정보 비저장
- 기존 예약·스케줄러 회귀

## 완료 게이트

```bash
npm run check
git diff --check
```

실확장에서는 150ms 토글 중 클릭 drift와 배치 전송 유무를 비교하고, 종료 후 확장 재로드 뒤 실행 상세가 복원되는지 확인한다.

## 결과

- `npm run check` 통과
- 단위·fixture 테스트 161개 통과
- fake IndexedDB 저장·중복·삭제·보존 테스트 통과
- Port disconnect·ACK·재전송 테스트 통과
- 날짜 토글 `NO_SLOT`·`SLOT_FOUND` trace 테스트 통과
- Side Panel 증분 렌더링·100행 제한 테스트 통과
- `dist` 및 모듈 독립성 검사 통과
- 최초 작성 당시에는 실제 Chrome 제어 채널이 연결되지 않아 확장 재로드 뒤 확인이 남아 있었다.

## 후속 실확장 검증 (2026-07-12)

Chrome DevTools MCP로 확장 업데이트 후 Side Panel에 재접속하고 UI 실행 로그와 `catchtable-reserve-telemetry` IndexedDB를 대조했다.

- Side Panel의 최신 실행 선택과 상세 추적 판독 성공
- telemetry DB의 `runs` 18건, `events` 478건 조회 성공
- 최신 run의 UI 이벤트 10건과 IndexedDB 이벤트 10건 일치
- `droppedCount=0`, `seq` 연속성 확인
- 최초 `RUN_STARTED`, 최종 `RUN_TERMINATED`, `finalState=STOPPED` 확인
