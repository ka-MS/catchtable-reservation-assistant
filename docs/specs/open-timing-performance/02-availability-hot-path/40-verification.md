# Tier 2-2 - Availability DOM wake-up 검증

**검증일:** 2026-07-14
**상태:** 실제 오픈 기능 검증 완료, probe 기본 비활성, body wake 성능 이득 미입증

## 1. 자동 게이트

최종 포털 슬롯 수정 뒤 다음 명령을 다시 실행했다.

```bash
npm run check
```

결과:

- TypeScript typecheck 통과
- Node test `263/263` 통과
- dist validation 통과
- MAIN/ISOLATED independence validation 통과
- content IIFE와 MAIN probe bundle 생성 통과

## 2. TDD 범위

| 계약 | 검증 |
|---|---|
| EXACT/STRONG 현재 cycle 수용 | coordinator와 orchestrator 테스트 |
| WEAK/NONE, 날짜·인원 불일치 거부 | 25ms fallback 결과 비교 |
| stale, old cycle, duplicate, malformed 거부 | 고정 discard reason 테스트 |
| body 선행/DOM 선행 | 순서별 동일 terminal 결과 테스트 |
| body가 대기 중 scan을 깨움 | in-flight fallback sleep 중단 테스트 |
| body 후 DOM 지연 | 현재 cycle만 250ms render window 보존 |
| wake 후 후보 없음 | 다음 날짜 토글 계속 |
| probe·observer·trace 예외 | baseline 결과·클릭 수 동일 |
| 클릭 직전 후보 소실 | 클릭하지 않고 탐색 재개 |
| dry-run | 슬롯 클릭 0회 |
| RT-04 | 20ms settling, 40ms lead, 60ms confirmation 유지 |
| portal drawer | `main` 밖 visible 슬롯과 hidden 복제본 fixture |

## 3. Chrome 환경

- extension ID: `olbclnjiehfelpfmgmdphfmenapmpaal`
- version: `0.2.0`
- load path: `\\wsl.localhost\Ubuntu\home\developer\source\catchtable-reserve\dist`
- 개발자 모드에서 확장을 재로드한 뒤 검증했다.

## 4. 최종 안전 live

설정:

- 매장: `ishizue`
- 예약일: `2026-07-22`
- 인원: 2명
- 시간 범위: 18:30-19:00
- entry: auto
- post-slot: off
- dry-run: on

실행 `run-9e67fd6e-29a4-4def-87f8-244f0960e84f`는 `DRY_RUN_COMPLETED`로 종료했다. 예약 drawer의 `18:30` 슬롯은 `main` 밖 portal에 있었으며, 수정된 `SlotAdapter`가 이를 DOM 후보로 읽었다.

IndexedDB 원본 trace:

| 항목 | 결과 |
|---|---|
| 이벤트 | 24개, seq `1..24`, gap 없음 |
| dropped | 0 |
| body | cycle 1, requestSequence 4, `EXACT`, `POPULATED` |
| wake | accepted, `bodyToWakeMs=0` |
| wake 결과 | `candidateFound=true`, `fallback=false`, scan 1회 |
| wake-to-DOM | 약 `0.1ms` |
| response-to-DOM | 약 `20.4ms` |
| DOM 후보 | 18:30 (`1110`) |
| 슬롯 클릭 | 0회 |
| 결제·약관·최종 예약 동작 | 0회 |

Catchtable 페이지 콘솔에는 error/warn/issue가 없었다. extension page에는 기존 접근성 issue 한 건(`aria-labelledby` 대상 없음)만 있었고 예약 실행 오류는 없었다.

## 5. fallback live 근거

최종 수정 전 별도 dry-run에서는 설정 범위와 일치하지 않는 body를 `no_matching_slot`으로 거부하고 기존 토글을 계속했다. 또 `EXACT` body를 수용했지만 `main` 제한 selector 때문에 visible portal 슬롯을 놓치는 사례를 확인했다. 후자는 fixture RED를 추가한 뒤 selector 범위 수정과 최종 live로 해소했다.

## 6. 제한과 판정

이번 live는 이미 열려 있던 슬롯의 기능·안전 검증이다. 실제 `EMPTY -> POPULATED` 오픈 경쟁 표본이 아니므로 다음을 주장하지 않는다.

- body wake의 실제 성능 향상
- 20/40/60ms 상수 축소 근거
- body의 actuator 승격
- Tier 2-2 최종 종료

이 절의 당시 판정은 **fallback 보존형 구현 완료, RT-10M 재측정 대기**였다. 이후 RT-10M 실제 오픈 판독과 RT-05 종료 gate를 완료했다. 현재 최종 판정은 **REDUCE 기능·안전 범위 종료, probe 기본 비활성, body wake 성능 이득 미입증**이며 공식 p95와 counterfactual은 후속 측정이다.

## 7. RT-10M 실제 오픈 음성 표본

2026-07-14 양주르 실제 오픈 실행 `run-866b9478-ff60-4429-977b-0ea012eefdaa`에서 target body가 `EMPTY -> POPULATED`로 전환되고 cycle 6, requestSequence 12, `EXACT`로 상관됐다.

| 항목 | 결과 |
|---|---|
| 예약 조건 | `2026-09-05`, 2명, 18:30-21:00 |
| 열린 슬롯 | 11:00, 15:00, 15:30, 17:30 |
| 후보 일치 | 없음 |
| 슬롯 클릭 | 0회, 정상 |
| `NONE/IRRELEVANT` shadow | target wake와 무관한 cycle 없는 응답으로 분류, 제어 미사용 |
| 최종 달력 상태 변경 | 측정 중 사용자 클릭으로 발생, 판정에서 제외 |

이 표본은 실제 오픈에서 `EXACT POPULATED` 분류와 조건 불일치 시 미클릭 안전성을 확인한다. 다만 설정과 일치하는 슬롯이 없으므로 wake accepted부터 DOM candidate, dispatch, click까지의 지연을 측정할 수 없다. 따라서 RT-10M 성능 게이트와 RT-05 종료 gate는 계속 열어 둔다.

## 8. 누와 실제 오픈 표본

2026-07-15 누와 00:00 오픈에서 로컬 3개와 신규 PC 1개 CSV를 분석했다. CSV에 포함된 네 실행은 모두 dropped 0이고 seq gap이 없다. 신규 PC의 나머지 3개 실패는 CSV가 없어 사용자 관측으로만 보존한다.

| 실행 | 환경 | 결과 | 핵심 판정 |
|---|---|---|---|
| [run-ec3acf59](../../../evidence/live-runs/2026-07-14/nuwa-run-ec3acf59-2e31-48c5-a558-b7dd184d7a01/run.csv) | 로컬, 전면 | 폼 인계, 사용자 최종 예약 성공 | body `inactive_cycle`, 기존 DOM 경로로 +893ms 클릭 |
| [run-5881d898](../../../evidence/live-runs/2026-07-14/nuwa-run-5881d898-a394-4244-a694-07e2d5ea0205/run.csv) | 로컬, 최소화 | +1297ms 클릭, 후속 화면 timeout | wake accepted, wake-to-DOM 482ms, fallback |
| [run-8984299b](../../../evidence/live-runs/2026-07-14/nuwa-run-8984299b-a323-4278-a799-4da514d9c20a/run.csv) | 로컬, 최소화 | 사용자 중지 | 2초 이상 cycle과 20~37초 공백, 일치 슬롯 없음 |
| [run-b413a0d5](../../../evidence/live-runs/2026-07-14/nuwa-run-b413a0d5-d2ed-4642-bee3-d4aea20d04ac/run.csv) | 신규 PC, 4분할 | entry 인계 | 5초 동안 `aside#dock` 예약 CTA 미검출, viewport 원인 미확정 |

전면 성공 실행의 서버 기준 주요 시각:

| 단계 | 오픈 대비 |
|---|---:|
| target 날짜 클릭 | +690ms |
| XHR resource arrival | +814ms |
| DOM 후보 감지 | +884ms |
| 슬롯 클릭 dispatch | +893ms |
| 후속 dialog 확인 | +1560ms |
| 예약 폼 최초 관측 | +1857ms |
| 예약 폼 인계 이벤트 | +2253ms |

성공 실행에서 response-to-DOM은 약 74ms였지만 bridge delay가 약 57ms라 bridge 이후 DOM까지 남은 시간은 약 16ms였다. 다른 일치 실행은 body wake를 수용했으나 wake-to-DOM 약 482ms로 fallback했다. 실제 오픈에서 body wake가 기존 DOM 경로보다 빠르게 후보를 반환한 표본은 0개다.

표본 수와 환경 편향 때문에 p50/p95를 계산하지 않는다. 20/40/60ms 상수와 cycle 정책을 변경할 근거도 없다. 중요한 예약 전에는 현재 fallback 보존형 빌드를 유지하며, viewport·visibility 진단을 추가한 뒤 정상 크기 전면 실행 표본을 더 확보한다.

## 9. 전체 actual-open 판독과 RT-05

[26건 교차 분석](70-live-run-analysis.md)에서 모든 실행의 dropped 0과 seq 연속성, 19건의 설정 범위 슬롯 감지·클릭을 확인했다. 2026-07-15의 참고용 오픈→클릭 p50은 `+1127ms`, 감지→dispatch p50은 `14ms`다. n=17의 관측 p95는 최댓값이므로 공식 지표로 사용하지 않는다.

[RT-05 결정](80-probe-final-decision.md)에 따라 probe는 기본 비활성이다. 자동 테스트는 비활성 실행에서 MAIN `executeScript` 0회, 활성 실행에서 지정 bundle 1회, 주입 실패 시 DOM fallback을 확인한다.

최종 `npm run check`는 301/301 tests, typecheck, dist validation, MAIN/ISOLATED independence를 통과했다.
