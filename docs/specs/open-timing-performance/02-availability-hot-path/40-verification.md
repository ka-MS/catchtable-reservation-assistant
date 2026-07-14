# Tier 2-2 - Availability DOM wake-up 검증

**검증일:** 2026-07-14
**상태:** fallback 보존형 구현 완료, RT-10M 재측정 대기

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

현재 판정은 **fallback 보존형 구현 완료, RT-10M 재측정 대기**다. RT-05는 최종 종료 gate로 유지한다.

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
