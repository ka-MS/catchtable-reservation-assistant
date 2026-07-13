# RT-10 cycle correlation 설계

## marker와 request 결합

`AvailabilityTargetCycleMarker`:

```ts
interface AvailabilityTargetCycleMarker {
  cycle: number;
  targetDate: string;
  personCount: number;
  targetClickMonoMs: number;
}
```

ISOLATED bridge는 target click 직전에 marker를 `postMessage`하고 즉시 기존 click을 수행한다. MAIN probe는 marker와 request header의 날짜·인원이 일치하고 request send가 marker 시각의 허용 창 안이면 event에 `cycle`과 `targetClickMonoMs`를 싣는다. marker가 비동기로 늦게 도착하면 아직 완료되지 않은 request observation에 소급 결합한다.

marker 전송·처리는 전부 best-effort다. 예외를 삼키며 click 전에 await하지 않는다.

## quality 규칙

- `EXACT`: MAIN event의 cycle marker가 등록된 cycle, 날짜, 인원과 모두 일치
- `STRONG`: marker는 없지만 request send가 날짜·인원이 같은 등록 cycle 하나의 700ms 창에만 포함
- `WEAK`: 후보 cycle이 둘 이상이거나 marker와 등록 정보가 충돌
- `NONE`: 후보 cycle 없음 또는 target 날짜·인원 불일치

Tier 2 성능 집계 후보는 `EXACT`, `STRONG`뿐이다. quality는 일치 정확도이며 body와 DOM 슬롯 값의 agreement와 별개다.

## correlation record

body와 DOM trace 공통 필드:

- `cycle`
- `requestSequence`
- `correlationId = cycle:<cycle>:request:<sequence>`
- `correlationQuality`

DOM compare 추가 필드:

- `responseCompletedMonoMs`
- `bridgeReceivedMonoMs`
- `domObservedMonoMs`
- `bridgeToDomMs = domObservedMonoMs - bridgeReceivedMonoMs`
- `targetResponseToDomMs = domObservedMonoMs - responseCompletedMonoMs`
- `mutationGenerationAtTargetClick`
- `mutationGenerationAtDom`
- `mutationObservedAfterTarget`

body와 DOM의 도착 순서는 가정하지 않는다. DOM 후보가 먼저 관측되면 cycle에 임시 보관하고, 같은 cycle의 `EXACT` 또는 `STRONG` body가 뒤늦게 도착할 때 `dom_compare_late`로 다시 결합한다.

## mutation observer

별도 `SlotDomMutationWatch`가 정밀 슬롯 탐색 진입 시 시작되어 document subtree의 child/attribute mutation callback마다 generation과 마지막 monotonic 시각만 갱신한다. target click 직전 snapshot과 DOM 후보 관측 snapshot을 비교한다. callback은 DOM 검색·trace·제어를 수행하지 않는다.

## stale 방지

correlation tracker는 최근 bounded cycle만 보관한다. body는 판정된 cycle에만 저장하고 DOM compare는 현재 cycle record만 조회한다. run-global `latestTargetShadow`와 run-global 최초 claim 비교는 제거한다.
