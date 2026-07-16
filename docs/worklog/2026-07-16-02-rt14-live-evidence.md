# 2026-07-16 RT-14 실오픈 evidence 정리

## 범위

- 목란 실행 6건과 진단 bundle을 `docs/evidence/live-runs/2026-07-16/`에 보관
- 날짜 README를 RT-14, 설정 비교, 달력 호환성, 예약창 진입 진단으로 분류
- 목적별 고정 앵커와 루트 주제 인덱스 추가
- RT-14 대표 실행 `run-85a4f2c0` case 판독 작성
- RT-14 `60-live-verification.md` 작성과 HANDOFF 갱신

## 판정

- cycle 1 / request 4의 current `EXACT EMPTY`가 수락됐고 7ms 뒤 `EMPTY_EARLY_EXIT`로 종료됐다.
- 같은 실행은 오픈 후 cycle 10에서 슬롯을 발견하고 `+891ms`에 클릭한 뒤 예약 폼에 도달했다.
- 비신뢰·비활성 응답의 제어 오수용과 DOM 후보 손실은 관측되지 않았다.
- 기능·안전 실오픈 gate는 통과했다.
- 동등한 `off` 비교군이 없어 실제 성능 이득과 요청 증가량은 판정하지 않는다. 기본값은 `off`를 유지한다.

## 재현

```bash
npm run analyze:rt14
npm run check
git diff --check -- . ':(exclude)docs/evidence/live-runs/2026-07-16/**/*.csv'
```

새 evidence 6건 추가 후 분석기는 32개 실행과 `EXACT EMPTY` 97건을 스캔한다. counterfactual 적격 53건, timing-clean 28건과 핵심 p50/p95는 변하지 않았다.

`run.csv`는 Excel 내보내기 원본의 UTF-8 BOM과 CRLF를 보존한다. Git은 CRLF의 `\r`을 trailing whitespace로 보고하므로 문서 diff 검사는 원본 CSV만 제외한다.
