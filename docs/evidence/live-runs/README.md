# Live Run Evidence

실제 예약 실행에서 수집한 원본 증거를 실행 단위로 보관한다.

## 날짜 인덱스

- [2026-07-14](2026-07-14/README.md): 누와 RT-10M 최초 실제 오픈 표본
- [2026-07-15](2026-07-15/README.md): 다매장 실제 오픈 및 경쟁 승패·후속 화면 표본

## 구조

```text
live-runs/
  YYYY-MM-DD/
    README.md
    <restaurant>-<run-id>/
      run.csv
      diagnostic/       # optional
      screenshot.png    # optional
      case.md            # optional, 분석 완료 후
```

- 폴더명은 `<restaurant>-run-<uuid>` 형식을 사용한다.
- `run.csv`는 전체 Trace 원본이며 실행당 하나만 둔다.
- `diagnostic/`은 진단 ZIP을 해제한 내용이다. `manifest.json`을 진입점으로 사용한다.
- `case.md`는 분석이 끝난 실행에만 추가하며 판정과 근거를 기록한다.
- 한 실행의 원본은 한 디렉터리에만 저장하고 관련 스펙에서는 링크한다.
- 재현 가능한 정제 DOM만 `tests/fixtures/`로 승격한다.
- 영상과 개인정보가 포함된 원본 파일은 Git에 추가하지 않는다.
- 실행 결과는 `SUCCESS`, `CONTENTION_LOST`, `FLOW_FAILURE`, `ENVIRONMENT_FAILURE`, `UNCLASSIFIED` 중 하나로 기록한다.
- Windows가 만든 `Zone.Identifier`는 증거가 아니며 저장하지 않는다.

## 링크 규칙

- 날짜 README는 해당 날짜의 모든 실행을 빠짐없이 링크한다.
- 분석 문서는 가능한 한 run ID 텍스트가 아니라 `run.csv` 또는 `diagnostic/manifest.json` 링크를 사용한다.
- 사용자 메모와 로그로 확인된 사실을 구분한다. 파일명에 있던 메모는 날짜 README의 `원본 메모` 열에 보존한다.
