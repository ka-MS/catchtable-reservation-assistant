# Live Run Sample Sufficiency

**날짜:** 2026-07-15
**브랜치:** `codex/run-diagnostic-bundle`

## 목적

2026-07-14·15 실제 오픈 원본이 open-timing p50/p95 및 재시도 설계에 어느 정도 사용할 수 있는지 1차 판정한다.

## 재시도 증거 분리

- Case 1, 키이로: 슬롯 클릭 후 명시적인 테이블 선정 실패 안내가 나타났지만 현재 Adapter가 이를 active dialog로 인식하지 못했다.
- Case 2, 윤주당: 일시적인 재시도 toast가 나타난 뒤 종료 snapshot 시점에는 shop·슬롯 화면만 유지됐다.

두 케이스는 같은 `RUN_TERMINATED` 문구로 합치지 않는다. 향후 재시도 설계에서 명시적 실패 복구와 무응답·원상복귀 복구를 별도 전이로 다룬다.

## 표본 수

| 범위 | 실행 | EXACT/STRONG target POPULATED | wake accepted | 슬롯 감지·클릭 | response-to-DOM 완전 표본 |
|---|---:|---:|---:|---:|---:|
| 2026-07-15 | 22 | 17 | 6 | 17 | 6 |
| 2026-07-14·15 합계 | 26 | 20 | 7 | 19 | 7 |

모든 실행의 dropped count는 0이다.

## 1차 판정

- 2026-07-15의 오픈→슬롯 감지·클릭 17건은 운영 환경의 탐색적 중앙값을 계산하는 데 사용할 수 있다.
- 서로 다른 매장·슬롯 구조·창 상태가 섞여 있으므로 이 중앙값은 코드 hot path만의 성능값이 아니다.
- 17건의 nearest-rank p95는 사실상 최댓값 한 건이므로 공식 p95 또는 상수 변경 근거로 사용하지 않는다.
- body response→DOM과 wake 경로는 6건뿐이므로 probe 성능의 p50/p95를 주장할 수 없다.
- Trace-only 실행에는 viewport, focus, visibility가 없어 환경별 층화도 불가능하다.

참고용 2026-07-15 nearest-rank 집계는 슬롯 감지 p50 `+1108ms`, 슬롯 클릭 p50 `+1127ms`다. p95 값은 표본 부족으로 성능 계약에 사용하지 않는다.

## 성공 표본의 body 경로

- 키이로 `run-231096aa`: cycle 3 `EXACT POPULATED` body는 `inactive_cycle`로 거절됐고 cycle 4 DOM fallback이 슬롯을 찾아 `+1182ms`에 클릭했다.
- 윤주당 `run-c742db22`: cycle 3 `EXACT POPULATED` body는 `inactive_cycle`로 거절됐고 cycle 4 DOM fallback이 슬롯을 찾아 `+1072ms`에 클릭했다.

두 실행 모두 XHR body 관측 표본이지만 body wake가 클릭을 앞당긴 표본은 아니다.

## 다음 표본 기준

공식 hot-path 통계는 같은 빌드·설정에서 환경 정보가 있고, `EXACT/STRONG POPULATED -> response -> bridge -> DOM -> click` 구간이 완전한 정상 크기 전면 실행을 추가 확보한 뒤 계산한다.
