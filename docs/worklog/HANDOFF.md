# HANDOFF

**갱신:** 2026-07-14
**브랜치:** `main`
**최신 보조 작업 로그:** `docs/worklog/2026-07-14-10-payment-policy-ux-shortcut.md`
**핵심 hot-path 작업 로그:** `docs/worklog/2026-07-14-09-tier2-2-availability-hot-path.md`
**최신 RT-10M 실측:** `docs/worklog/2026-07-14-11-rt10m-yangjour-negative-control.md`
**최신 short-cut:** `docs/specs/run-telemetry/60-csv-export-shortcut.md`

## 현재 상태

예약 흐름 호환성 패키지의 달력, 결제 방식, 좌석·메뉴, 실제 폼 인계 검증을 완료했다. 이어 RT-10M 측정을 기다리는 동안 hot path와 독립적인 결제 정책 UX를 단축 절차로 보완했다.

- `결제 방식까지 자동 진행`이 켜진 경우 `예약금 0원 방식만`과 `사이트에서 선택된 방식 허용` 중 하나를 고른다.
- 기본값과 구버전 복원값은 기존 동작을 보존하는 `사이트에서 선택된 방식 허용`이다.
- 어떤 정책에서도 선택되지 않은 유료 방식을 임의로 선택하지 않는다.
- `20,000원`을 `0원` 방식으로 오인하던 부분 문자열 판별을 금액 경계 판별로 수정했다.
- 슬롯 탐색, 날짜 토글, 서버 시계, XHR probe와 wake 경로는 이번 단축 패치에서 변경하지 않았다.

Tier 2-2 availability hot-path는 fallback 보존형 구현과 비최종 안전 검증을 완료한 상태다.

- 검증된 현재 cycle `EXACT/STRONG` body만 DOM scan wake-up 후보로 사용한다.
- body는 슬롯을 선택하거나 클릭하지 않는다.
- 최종 후보와 클릭 직전 유효성은 기존 `SlotAdapter`가 DOM에서 다시 확인한다.
- body 부재, WEAK/NONE, stale, malformed, probe·observer·trace 실패는 기존 bounded DOM 경로로 폴백한다.
- body 이후 DOM이 늦게 렌더되면 현재 cycle만 최대 250ms 보존하고 `stopAt`은 넘지 않는다.
- 20ms settling, 40ms switch lead, 60ms confirmation cap은 실제 p95 근거가 없어 유지했다.
- 예약 drawer가 `main` 밖 portal에 렌더되는 live 구조를 fixture로 고정하고 SlotAdapter 범위를 보완했다.
- 양주르 실제 오픈에서 target body가 `EMPTY -> POPULATED`로 바뀌고 `EXACT`로 상관되는 것을 확인했다.
- 해당 실행은 설정 시간 18:30-21:00과 열린 슬롯 11:00·15:00·15:30·17:30이 불일치해 미클릭이 정상인 음성 표본이다.
- 종료된 실행의 상세 추적에서 `[CSV] [삭제]` 순서로 전체 Trace CSV를 내보낼 수 있다.
- CSV는 Excel-safe 문자열인 원본 epoch ms와 전체 KST 시각을 함께 보존하고 동적 trace attributes를 열로 펼친다.
- 화면은 최신 100개만 유지하지만 CSV는 IndexedDB의 해당 run 전체 이벤트를 읽는다.
- CSV short-cut은 예약 오케스트레이터, 날짜 토글, XHR probe, wake, SlotAdapter를 변경하지 않았다.

상태 표현:

> fallback 보존형 구현 완료, RT-10M 재측정 대기

성능 향상 완료 또는 Tier 2-2 최종 종료를 선언하지 않는다.

## 검증 근거

- 결제 정책 UX 대상 테스트: 73/73 통과
- CSV short-cut 대상 테스트: 19/19 통과
- 전체 `npm run check`: 278/278 tests, typecheck, dist validation, MAIN/ISOLATED independence 통과
- CSV Chrome live 확인: 원격 디버깅 미연결로 대기
- `git diff --check` 통과
- extension: `olbclnjiehfelpfmgmdphfmenapmpaal`, version `0.2.0`
- load path: `\\wsl.localhost\Ubuntu\home\developer\source\catchtable-reserve\dist`
- live dry-run: `run-9e67fd6e-29a4-4def-87f8-244f0960e84f`
- 결과: `DRY_RUN_COMPLETED`, 24 events, seq `1..24`, dropped 0
- wake: cycle 1 / request 4 / EXACT / candidate found / fallback false
- wake-to-DOM 약 0.1ms, response-to-DOM 약 20.4ms
- 슬롯·결제·약관·최종 예약 클릭 0회

상세 문서:

- `docs/specs/open-timing-performance/02-availability-hot-path/10-analysis.md`
- `docs/specs/open-timing-performance/02-availability-hot-path/20-design.md`
- `docs/specs/open-timing-performance/02-availability-hot-path/30-implementation.md`
- `docs/specs/open-timing-performance/02-availability-hot-path/40-verification.md`
- `docs/specs/open-timing-performance/02-availability-hot-path/50-adversarial-review.md`

## 다음 작업 1 - RT-10M 실제 오픈 재측정

실제 `EMPTY -> POPULATED` 오픈에서 다음 원시 시각을 같은 cycle·requestSequence로 보존한다.

1. response completed
2. payload classified
3. bridge received
4. wake accepted
5. DOM candidate observed
6. slot dispatch 및 click 결과

`EXACT` 또는 `STRONG` 유효 표본만 집계한다. 여러 실행에서 p50/p95를 계산하고 body wake가 기존 25ms polling 잔여를 실제로 줄이는지 판정한다. 그 전에는 20/40/60ms를 변경하거나 성능 이득을 주장하지 않는다.

2026-07-14 양주르 실측은 `EXACT POPULATED` 분류와 조건 불일치 시 미클릭 안전성을 확인했지만, 설정과 일치하는 슬롯이 없어 wake-to-DOM·dispatch·click 성능 표본으로 사용할 수 없다. 마지막 `SETUP_INVALID` 종료는 측정 중 사용자 클릭으로 발생했으므로 제외한다. 다음 실측은 실제 열린 슬롯을 포함하는 시간 조건으로 수행해야 한다.

## 다음 작업 2 - RT-05 종료 gate

RT-10M 판독 뒤 MAIN XHR probe를 다음 중 하나로 결정한다.

- 진단 모드 전용
- 성능 이득이 없으면 제거
- 제한된 관측 경로로 기본 비활성 유지

비활성 시 wrapper 미설치, 활성 시 원본 의미 보존·종료 원복·제어 독립성 회귀를 통과해야 Tier 2-2를 최종 종료할 수 있다.

## 검증 명령

```bash
npm run check
git status --short --branch
```
