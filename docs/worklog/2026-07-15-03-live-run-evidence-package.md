# Live Run Evidence Package

**날짜:** 2026-07-15
**브랜치:** `codex/run-diagnostic-bundle`

## 목적

실제 오픈 실행 원본을 스펙 디렉터리와 임시 폴더에서 분리하고, 실행별 단일 경로와 문서 링크를 만든다. 이번 작업에서는 새 표본의 성능·실패 원인을 분석하지 않는다.

## 정리 결과

- `docs/evidence/live-runs/2026-07-14`에 누와 RT-10M 4개 실행을 이관했다.
- `docs/evidence/live-runs/2026-07-15`에 다매장 22개 실행을 정리했다.
- 모든 실행은 `<restaurant>-run-<uuid>/run.csv` 구조를 사용한다.
- 진단 bundle 3개는 각 실행의 `diagnostic/manifest.json`을 진입점으로 둔다.
- 윤주당 보조 이미지는 해당 실행의 `screenshot.png`로 배치했다.
- 동일 실행 CSV의 중복 사본은 SHA-256 일치 확인 후 제거했다.
- Windows `Zone.Identifier` 36개를 제거하고 재유입 방지 ignore 규칙을 추가했다.

## 문서 연결

- `docs/evidence/README.md`: Evidence 패키지의 경계와 보관 원칙
- `docs/evidence/live-runs/README.md`: 실행별 구조, 결과 분류, 링크 규칙
- 날짜별 README: 해당 날짜의 모든 실행과 원본 메모 인덱스
- 기존 누와 RT-10M 분석·검증 문서: 원본 `run.csv` 링크로 연결

## 검증 기준

- 실행 디렉터리마다 `run.csv`가 정확히 1개 존재한다.
- 날짜 README가 해당 날짜의 모든 실행 디렉터리를 링크한다.
- 진단 디렉터리마다 `manifest.json`이 존재한다.
- 변경 문서의 로컬 Markdown 링크가 모두 해석된다.
- 원본 CSV·JSONL·HTML 내용은 파일 정리 과정에서 수정하지 않는다.

## 다음 단계

2026-07-15 표본 분석은 별도 작업으로 진행한다. 사용자 메모, trace 사실, 진단 snapshot을 구분하고 분석 결론은 `docs/analysis` 또는 관련 스펙에 기록한다.
