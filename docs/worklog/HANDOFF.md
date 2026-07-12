# HANDOFF

**갱신:** 2026-07-12
**브랜치:** `main`
**작업 로그:** `docs/worklog/2026-07-12-02-run-telemetry.md`

## 현재 상태

실행 상세 로그를 IndexedDB에 runId별로 저장하며 최근 20건을 보관한다. Content는 250ms 또는 20건 단위 ACK batch를 사용하고 날짜 왕복은 `DATE_TOGGLE_CYCLE`로 구조화한다. Side Panel 실행 로그에서 과거 실행 선택·삭제와 최근 100개 상세 trace를 확인할 수 있다. 기존 `runEvents`는 현재 상태와 미니로그 호환용으로 남아 있다.

## 다음 작업

1. `chrome://extensions`에서 확장 카드를 새로고침한다.
2. 가까운 오픈 시각 dry-run으로 `DATE_TOGGLE_CYCLE`의 인접·목표 클릭과 `NO_SLOT`을 확인한다.
3. 실행 종료 후 실행 선택 메뉴에서 이전 상세 로그를 조회하고 단건 삭제를 확인한다.
4. 확장을 다시 새로고침한 뒤 IndexedDB 실행 이력이 유지되는지 확인한다.
5. 이후 후보: JSONL 내보내기, HTTP/OTLP outbox exporter, XHR 응답 감시.

## 검증

```bash
npm run check
git status --short --branch
```

단위·fixture 테스트 161개와 전체 자동 게이트가 통과했다. 브라우저 제어 채널이 연결되지 않아 실제 확장 확인은 새 `dist` 재로드 후 수동으로 수행한다.
