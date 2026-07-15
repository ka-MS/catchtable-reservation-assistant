# Actual-open cross-run analysis

**분석일:** 2026-07-15
**대상:** 2026-07-14·15 actual-open `run.csv` 26건
**집계 도구:** `node scripts/analyze-live-runs.mjs`

## 1. 결론

실측은 Tier 2-2의 안전성과 실제 사이트 동작을 확인했지만 XHR wake의 순수 성능 이득은 입증하지 못했다.

- 26건 모두 `droppedCount=0`이고 `seq=1..eventCount`가 연속이다.
- `EXACT/STRONG POPULATED` body를 20건에서 관측했고, 그중 설정 범위와 일치하는 슬롯을 포함한 body는 19건이다.
- 19건 모두 DOM 슬롯을 감지하고 클릭을 dispatch했다. 설정 범위 밖 슬롯 클릭은 0건이다.
- wake는 7건에서 수락됐고 모두 DOM 후보를 찾았다. 1건은 250ms window를 넘겨 fallback했다.
- 12건은 일치 body가 다음 cycle에 늦게 도착해 `inactive_cycle`로 거절됐지만 기존 DOM 경로가 슬롯을 찾았다.
- 사용자 확인 최종 성공 3건인 누와, 키이로, 윤주당은 모두 body wake가 아니라 기존 DOM fallback으로 클릭했다.

따라서 probe는 실제 오픈에서 동작하는 실험 경로이지만, 현재 자료로 운영 기본 활성 또는 속도 향상을 주장할 수 없다.

## 2. 자료와 방법

원본은 [actual-open evidence index](../../../evidence/live-runs/README.md)의 실행별 `run.csv`다.

집계 규칙:

1. 실행 단위는 `runId` 하나다.
2. target body는 `correlationQuality=EXACT|STRONG`이고 `classification=POPULATED`인 경우다.
3. wake 성능 표본은 위 조건에 더해 `selectedMinutes`가 존재하고 `wakeAccepted=true`인 경우다.
4. 슬롯 성능은 `timingStage=slot_detected`와 `slot_click_dispatched`가 모두 있는 실행만 포함한다.
5. percentile은 nearest-rank를 사용한다.
6. 사용자 성공 메모는 최종 예약 성공의 보조 증거이며 Trace의 `FORM_REACHED`와 구분한다.

`attr.matchesTarget`은 상관 품질만 반영해 설정 범위 슬롯 일치 여부로 사용하지 않았다. 집계 스크립트는 `selectedMinutes`를 별도로 요구한다.

## 3. 자료 무결성

| 항목 | 결과 |
|---|---:|
| 전체 실행 | 26 |
| dropped 0 | 26 |
| eventCount와 seq 연속 일치 | 26 |
| `EXACT/STRONG POPULATED` body | 20 |
| 설정 범위 일치 body | 19 |
| 슬롯 감지·클릭 | 19 |
| 클릭 슬롯이 설정 범위 안 | 19/19 |
| 슬롯 후속 화면 전환 확인 | 15/19 |

이 무결성은 Trace 집계가 가능하다는 뜻이지, 26건이 동일 환경의 독립 표본이라는 뜻은 아니다.

| 날짜 | 실행 | POPULATED body | 범위 일치 body | wake 수락 | 슬롯 클릭 | 전환 확인 |
|---|---:|---:|---:|---:|---:|---:|
| 2026-07-14 | 4 | 3 | 2 | 1 | 2 | 1 |
| 2026-07-15 | 22 | 17 | 17 | 6 | 17 | 14 |

## 4. 종료 결과

| Trace 판정 | 건수 | 의미 |
|---|---:|---|
| `FORM_REACHED` | 11 | 예약 폼 인계. 최종 예약 성공과 동일하지 않음 |
| `UNSUPPORTED_POST_SLOT` | 3 | 후속 unknown에서 안전 인계 |
| `SLOT_TRANSITION_TIMEOUT` | 4 | 슬롯 click dispatch 뒤 5초 내 전환 미확인 |
| `POST_SLOT_TIMEOUT` | 1 | 전환 뒤 후속 단계 진행 timeout |
| `DATE_PREPARATION_FAILURE` | 1 | 장거리 월 이동 실패. 이후 코드에서 수정됨 |
| `ENTRY_FAILURE` | 1 | 작은 4분할 창에서 예약 CTA 미검출 |
| `NAVIGATION_STOP` | 1 | 실행 중 설정 매장을 벗어남 |
| `USER_STOPPED` | 4 | 사용자가 중지해 성능 결과에서 제외 |

슬롯 클릭 19건 중 전환 확인은 15건이다. 나머지 4건은 성능 탐색 성공과 예약 경쟁 결과를 구분해야 한다는 RT-01 판단을 재확인한다.

## 5. 운영 지연

2026-07-15 슬롯 감지·클릭 17건의 참고값이다.

| 구간 | n | min | p50 | p90 | 관측 p95 |
|---|---:|---:|---:|---:|---:|
| 오픈 → DOM 슬롯 감지 | 17 | 742ms | 1108ms | 1743ms | 1877ms |
| 오픈 → 클릭 dispatch | 17 | 759ms | 1127ms | 1752ms | 1894ms |
| 목표 날짜 클릭 → 감지 | 17 | 101ms | 199ms | 289ms | 763ms |
| 감지 → dispatch | 17 | 8ms | 14ms | 19ms | 20ms |

해석:

- 감지 뒤 dispatch는 p50 14ms로 작다. 큰 지연은 목표 요청, 서버 응답과 DOM 생성 이전 구간에 있다.
- 오픈→클릭 p50 `+1127ms`는 서로 다른 매장·설정·환경이 섞인 운영 관찰치다.
- n=17 nearest-rank p95는 최댓값 한 건이다. 공식 p95나 20/40/60ms 상수 변경 근거로 사용하지 않는다.
- Tier 2 착수 전 동일 조건 기준선이 없으므로 시작 전후 속도 차이도 수치로 주장하지 않는다.

## 6. XHR wake 경로

전체 26건에서 wake 수락 7건의 참고값:

| 구간 | n | p50 | max |
|---|---:|---:|---:|
| response complete → DOM 후보 | 7 | 85.1ms | 606.4ms |
| bridge 수신 → DOM 후보 | 7 | 0.4ms | 482.5ms |
| wake → DOM 후보 | 7 | 0.3ms | 482.3ms |

2026-07-15만 보면 수락 6건 모두 후보를 찾았고 fallback은 0건이다. 5건은 wake 뒤 0.3ms 이내, 1건은 36.1ms 뒤 후보를 찾았다. 2026-07-14 최소화 누와 1건은 wake 뒤 482.3ms가 걸려 fallback했다.

이 수치는 wake가 후보를 빨리 반환했다는 증거가 아니다. wake가 없었을 때 다음 25ms polling scan이 언제 실행됐을지 기록하지 않았기 때문이다. wake 수락군과 `inactive_cycle`군의 오픈→감지 중앙값 비교도 매장·설정·창 상태가 달라 인과 비교가 아니다.

## 7. 실제 성공 표본

| 실행 | 사용자 결과 | body 처리 | 클릭 |
|---|---|---|---:|
| [누와 run-ec3acf59](../../../evidence/live-runs/2026-07-14/nuwa-run-ec3acf59-2e31-48c5-a558-b7dd184d7a01/run.csv) | 최종 예약 성공 | cycle 3 body `inactive_cycle` | DOM fallback `+893ms` |
| [키이로 run-231096aa](../../../evidence/live-runs/2026-07-15/kiro-run-231096aa-99ab-47d2-a79f-49d654bb3bf6/run.csv) | 예약 진행 성공 | cycle 3 body `inactive_cycle` | DOM fallback `+1182ms` |
| [윤주당 run-c742db22](../../../evidence/live-runs/2026-07-15/yunjudang-run-c742db22-e1a1-46bf-baf3-776f1957456b/run.csv) | 예약 진행 성공 | cycle 3 body `inactive_cycle` | DOM fallback `+1072ms` |

세 사례는 fallback 보존이 실제 성공에 중요했음을 입증한다. XHR body 관측은 있었지만 body wake 성능 성공 사례로 분류하지 않는다.

## 8. 환경과 표본 편향

- 26건은 `preOpenLead/toggleInterval/clock` 조합이 네 종류다.
- 2026-07-15도 `200/100/legacy` 13건, `300/100/legacy` 6건, `200/100/9` 3건으로 섞여 있다.
- viewport, focus, visibility가 들어 있는 진단 bundle은 3건뿐이다.
- 2026-07-14에는 전면 성공, 최소화 지연, 4분할 entry 실패가 함께 관측됐다.
- 사용자 중지와 일부 수동 조작은 terminal 결과에 영향을 줬다.
- 최종 예약 성공은 서버 좌석 경쟁, 후속 단계와 사용자 입력까지 포함하므로 hot path만의 결과가 아니다.

따라서 현재 결과는 기능·안전 판정과 병목 위치 파악에는 유효하지만, 환경 간 성능 순위나 공식 SLA에는 부적합하다.

## 9. 실패·재시도 증거

- [키이로 case 1](../../../evidence/live-runs/2026-07-15/kiro-run-853ff5b6-2b0e-4e41-b20c-39576a2062c0/case.md)은 명시적인 테이블 선정 실패 dialog다.
- [윤주당 case 2](../../../evidence/live-runs/2026-07-15/yunjudang-run-f3aba3bd-0b9e-4b2d-9825-fa75707c31df/case.md)는 일시적 재시도 toast 뒤 shop·슬롯 화면이 유지된 경우다.

두 사례는 동일 timeout으로 합치지 않는다. 향후 runtime resilience에서 명시적 경쟁 실패와 원상복귀·toast 실패를 별도 복구 전이로 설계한다.

## 10. 남은 측정

공식 p95와 XHR wake 이득은 다음 조건을 만족하는 후속 자료에서만 판정한다.

1. 같은 build와 timing 설정, 정상 크기·전면 창, 사용자 개입 없음
2. `EXACT/STRONG` target body와 일치 슬롯
3. response, body, bridge, wake, DOM, dispatch 시각 완전성
4. `dropped=0`, seq gap 0, 잘못된 슬롯 클릭 0
5. wake 시점과 기존 25ms loop의 다음 예정 scan 시점을 함께 기록한 counterfactual metric
6. p95에는 tail을 표현할 수 있는 충분한 동질 표본을 별도 확보

이 측정은 후속 성능 개선의 근거이며 Tier 2-2 종료 blocking은 아니다.
