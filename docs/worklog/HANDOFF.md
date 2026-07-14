# HANDOFF

**갱신:** 2026-07-14
**브랜치:** `main`
**작업 로그:** `docs/worklog/2026-07-14-09-tier2-2-availability-hot-path.md`

## 현재 상태

Tier 2-2 availability hot-path의 fallback 보존형 구현과 비최종 안전 검증을 완료했다.

- 검증된 현재 cycle `EXACT/STRONG` body만 DOM scan wake-up 후보로 사용한다.
- body는 슬롯을 선택하거나 클릭하지 않는다.
- 최종 후보와 클릭 직전 유효성은 기존 `SlotAdapter`가 DOM에서 다시 확인한다.
- body 부재, WEAK/NONE, stale, malformed, probe·observer·trace 실패는 기존 bounded DOM 경로로 폴백한다.
- body 이후 DOM이 늦게 렌더되면 현재 cycle만 최대 250ms 보존하고 `stopAt`은 넘지 않는다.
- 20ms settling, 40ms switch lead, 60ms confirmation cap은 실제 p95 근거가 없어 유지했다.
- 예약 drawer가 `main` 밖 portal에 렌더되는 live 구조를 fixture로 고정하고 SlotAdapter 범위를 보완했다.

상태 표현:

> fallback 보존형 구현 완료, RT-10M 재측정 대기

성능 향상 완료 또는 Tier 2-2 최종 종료를 선언하지 않는다.

## 검증 근거

- `npm run check`: 263/263 tests, dist validation, MAIN/ISOLATED independence 통과
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
