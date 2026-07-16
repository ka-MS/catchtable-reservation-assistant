# 2026-07-15 실행 진단 번들

## 목표

재현이 어려운 예약 흐름 실패를 수정할 수 있도록 기존 성능 CSV와 별도의 구조화 DOM 진단 bundle을 제공한다.

## 변경

- Content에 최근 3개 breadcrumb ring과 failure rich snapshot을 추가했다.
- 실패 snapshot에 환경, 판별 전략/근거, query match, 주요 control rect, 달력/슬롯, surface, fingerprint, 정제 fragment를 포함했다.
- IndexedDB를 v2로 올리고 기존 `runs/events`를 유지한 채 `snapshots` store를 추가했다.
- run 삭제/prune에 snapshot cascade를 연결했다.
- Side Panel 상세 추적에 `진단` 버튼과 무압축 ZIP 내보내기를 추가했다.
- ZIP은 manifest, CSV, events JSONL, snapshots JSONL, environment, fragment 파일로 구성한다.
- 테스트 worker 동시성을 8로 제한해 WSL 자원 고갈을 방지했다.

## 안전 경계

- `REFRESHING_SLOTS`, `SLOT_DETECTED`, cycle/XHR/mutation/polling에서는 DOM 캡처를 하지 않는다.
- 정상 폼 인계, 후속 자동 진행 비활성, dry-run 완료, 사용자 중지는 snapshot을 영속화하지 않는다.
- 예약 폼 fragment는 저장하지 않고 다른 fragment도 허용 목록과 64KiB 상한을 적용한다.
- 진단 실패는 예약 실행 상태를 바꾸지 않는다.

## 검증

- `npm run check`: 296/296, typecheck, dist, independence 통과
- v1→v2 migration과 기존 데이터 보존 통과
- Windows 기본 압축 해제 및 Chrome 실제 다운로드 통과
- Chrome IndexedDB live: version 2, 기존 runs/events 유지, snapshots store 생성

상세 결과는 `docs/specs/run-diagnostics/40-verification.md`와 `50-adversarial-review.md`에 기록했다.
