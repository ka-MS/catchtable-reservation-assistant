# Tier 2-2 - Availability DOM wake-up 설계

## 1. 불변식

1. body는 DOM scan을 깨울 수만 있다.
2. `SlotAdapter.readAvailableSlots()`가 반환하지 않은 후보는 선택하지 않는다.
3. 클릭 직전 `SlotAdapter.clickSlot()`이 같은 logical key를 다시 조회한다.
4. body 경로의 부재·거부·예외는 기존 bounded DOM 결과를 바꾸지 않는다.
5. 한 cycle에는 단일 scan loop만 존재하며 body handler는 클릭하지 않는다.

## 2. 컴포넌트

`AvailabilityDomWake`를 content 계층의 작은 run-local coordinator로 둔다.

```text
beginCycle(cycle)
offer(correlation + selected slot + monotonic timing)
  -> accepted signal 또는 discard reason
consume(cycle) / wait(cycle, fallback delay)
endCycle(cycle)
```

coordinator는 active cycle, 마지막 수용 sequence, 대기 중 signal 하나만 보관한다. 새 cycle이 시작되면 이전 pending signal과 waiter를 폐기한다.

### 수용 조건

- quality: `EXACT | STRONG`
- `stale=false`
- `cycle === activeCycle`
- `requestSequence`가 마지막 수용값보다 큼
- selected minutes가 유효함
- response, classification, bridge, wake monotonic time이 유효함

거부 사유는 `untrusted_quality`, `stale_sequence`, `inactive_cycle`, `duplicate_sequence`, `no_matching_slot`, `malformed_signal` 중 하나로 고정한다.

## 3. scan loop

기존 25ms bounded loop를 소유권이 있는 유일한 detector로 유지한다.

```text
scan DOM
if candidate -> 기존 반환
else wait(min(deadline, interval))
  - accepted body가 오면 wait 즉시 해제
  - 없으면 기존 sleep 만료
```

accepted body를 소비하면 즉시 한 번 DOM을 스캔한다. 후보가 아직 없으면 검증된 body의 bridge 시각부터 최대 250ms 동안 10ms 간격을 사용한다. 이 bounded render window가 다음 인접 날짜 클릭보다 늦게 끝나면 해당 cycle만 window 끝까지 유지한다. 이후에는 25ms 간격과 기존 토글로 복귀하며 stop/timeout 상한은 넘지 않는다.

10ms는 기존 `xhr-slot-watch` 설계에서 검증 대상으로 사용한 burst 간격이고, 250ms는 현재 response-to-render 실측 상한을 포함하는 기존 `ARRIVAL_BURST_MS`다. 새 무제한 polling을 만들지 않는다.

## 4. ordering과 중복

- body 선행: pending signal을 첫 scan 전에 소비한다.
- DOM 선행: DOM 후보를 즉시 반환하고 pending body는 actuator가 되지 않는다.
- duplicate/old sequence: coordinator가 거부한다.
- old cycle: active cycle 불일치로 거부한다.
- newer signal: 아직 소비되지 않은 이전 pending signal을 최신 sequence로 대체한다.
- cycle 종료: pending signal과 waiter를 해제한다.

## 5. 로그 계약

기존 `AVAILABILITY_SHADOW` code를 재사용한다.

### body phase

- `wakeAccepted`
- `wakeDiscardReason`
- `wakeAtMonoMs`
- `bodyToWakeMs` (`bridgeReceivedMonoMs -> wakeAtMonoMs`)
- cycle, requestSequence, correlationQuality와 기존 response/bridge timing

### wake_result phase

- cycle, requestSequence, correlationQuality
- response/bridge/wake/DOM candidate monotonic time
- body-to-wake, wake-to-DOM, response-to-DOM
- `wakeCandidateFound`
- `wakeFallbackUsed`
- `wakeScanCount`

`DATE_TOGGLE_CYCLE`에는 wake 사용 여부와 fallback 여부를 추가해 body 로그가 없어도 cycle 결과를 판독할 수 있게 한다.

### SlotAdapter DOM 범위

Catchtable 예약 drawer는 `main` 밖의 portal에 렌더될 수 있고, 이때 배경 `main`은 `aria-hidden` 처리된다. 따라서 슬롯 후보는 문서 전체의 `button[data-busy]`에서 읽되 기존 안전 필터를 모두 유지한다.

- `data-busy="false"`인 버튼만 허용
- disabled, detached, 자신 또는 조상 hidden 후보 제외
- 분 단위 logical key로 중복 제거
- 클릭 직전 같은 logical key를 다시 조회

탐색 범위 확대가 body 기반 직접 선택을 의미하지 않는다. wake 이후에도 최종 후보 소유권은 `SlotAdapter`에 있다.

## 6. RT-04

- 40ms lead: 유지. 목표 클릭 그리드를 늦추지 않는다.
- 60ms confirmation cap: 유지. p95 근거 부족.
- 클릭 직후 고정 20ms: stale `aria-pressed`와 이전 슬롯 DOM 방지 근거가 있어 유지.

## 7. 실패 격리

- `offer`, `consume`, `wait`, 신규 wake trace는 오케스트레이터에서 예외 경계 안에 호출한다.
- coordinator wait가 실패하면 같은 남은 시간으로 일반 sleep을 수행한다.
- availability shadow와 mutation observer start/stop/snapshot 실패는 기존 terminal 결과를 바꾸지 않는다.
- dry-run은 기존 `advanceFromSlot()` 경계에서 클릭 0회를 유지한다.

## 8. 최종 운영 활성화

probe와 wake coordinator는 코드에 유지하되 `availabilityProbeEnabled=true`인 진단 실행에서만 MAIN wrapper와 channel을 설치한다. 기본값과 구버전 누락값은 `false`다. 비활성 상태의 기존 DOM detector는 coordinator 신호 없이 동일한 bounded loop를 수행한다.
