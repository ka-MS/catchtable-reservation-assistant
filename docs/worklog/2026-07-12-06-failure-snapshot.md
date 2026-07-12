# 2026-07-12 실패 스냅샷 (B+C)

## 동기

실전 런에서 `RUN_TERMINATED · 알 수 없는 단계 화면은 자동 진행하지 않습니다 · postSlotCertainty=unknown · dialogUrlKind=shop`가 발생했으나 dialog의 label·title이 비어 "무슨 화면인지" 식별이 어려웠다. entry/calendar/person 단계는 포기 시 DOM 증거가 아예 없었다.

## 수행

- **`captureStageSnapshot`(신규 `adapter/snapshot.ts`)**: 단계 무관 DOM 요약(url·headings·buttons·disabledButtons·dialogLabel/title·textSnippet·fingerprint). 활성 dialog/sheet 우선, 없으면 main→body 폴백.
- **PII 최소화**: textSnippet은 활성 dialog/sheet에서만·`reservation_form`에서는 금지, 전화·이메일 마스킹. main/body는 구조만.
- **fingerprint**: 버튼별 disabled 포함 + 동적 숫자(`\d+`→`#`) 정규화로 구조 동일 화면을 같은 지문으로 묶음.
- **`captureSnapshot?` 옵셔널 포트**(`trace?`·`flushTrace?`와 동일 패턴) + `stageSnapshotData` flatten 빌더.
- **RunSession 중앙 헬퍼**: `diagnosticHandOff`/`timedOut`(스냅샷 O) vs plain `handOff`(스냅샷 X). 정상 종료 2곳(폼 도착·postSlotEnabled=false)만 plain, 나머지 포기·예외는 진단. `failureData`가 전이 직전 `machine.state`를 `snapshotRunState`로 남겨 실패 단계를 식별한다. 캡처 예외는 내부 guard로 삼켜 원래 실패를 덮지 않는다.
- **예외 경로**: 캡처 1회로 trace(`RUN_FAILED`)와 FAILED 전이 data에 동일 스냅샷 전달.
- **사이드패널**: `formatEventDetail`에 스냅샷 라인(제목·버튼·snippet) 추가.

## 검증

- 단위·fixture 테스트 177개 green (신규: snapshot-adapter 5, snapshot-data 2, orchestrator 3, event-format 1).
- 기존 orchestrator 18개 무수정 통과(옵셔널 포트라 미주입 시 동작 동일).
- 타입·dist·독립성·`git diff --check` 통과.
- 검증한 동작: 정상 폼 인계엔 스냅샷 미첨부·post-slot 진단 유지 / waiting-only 포기엔 fingerprint+snapshotRunState 첨부 / 캡처 throw 시에도 포기 정상 진행 / 전화번호 마스킹 / 숫자 정규화 fingerprint.

## 리뷰 반영

초안 대비 수정: 정상/실패 인계 분리, main/body snippet 금지·PII 마스킹, snapshotRunState 추가, 예외 이중 캡처 제거, fingerprint에 disabled·숫자 정규화. `captureSnapshot`은 `trace?` 일관성 위해 optional 유지(리뷰의 required 제안은 근거 들어 미채택).

## 사용자 확인

1. `chrome://extensions`에서 확장 재로드.
2. unknown을 유발하는 화면(승인제·미지원 다이얼로그)에서 이벤트 로그에 `스냅샷:` 라인과 textSnippet이 남는지 확인.
3. 정상 예약 폼 도착 시에는 스냅샷 라인이 없는지 확인.

## 비고

- 설계·계획: `docs/specs/orchestrator-refactor/40-snapshot-design.md`, `50-snapshot-implementation.md`
- 남은 D(어댑터 DOM 쿼리 중복 제거)는 독립 작업. `captureStageSnapshot`이 `findActiveDialog` 등을 재사용해 일부 공통화에 기여.
- 병합 순서: postslot → A(`codex/refactor-orchestrator-session`) → 이 브랜치(`codex/feat-failure-snapshot`).
