# Tier 2-2 — 제어 경로 활성화 분석

**상태:** REDUCE fallback 보존형 구현·기능/안전 검증 완료. probe 기본 비활성, 성능 이득 미입증.
**부모:** `../10-analysis.md`

**현재 판정:** RT-01·RT-03 선행 조건은 완료됐다. target body로 DOM scan을 깨우는 축소 경로는 구현했지만, 안전한 pre-DOM actuator와 MutationObserver 제어 연결은 승인하지 않았다. 공식 p95와 동등 비교는 후속 측정이다.

## 1. 목적

Tier 2-1에서 신뢰성과 실제 선행 시간이 검증된 availability 신호만 기존 예약 제어 경로에 연결한다. 목표는 detector를 늘리는 것이 아니라, 단 하나의 슬롯 claim을 더 이르게 확정하면서 기존 DOM 폴백과 안전 경계를 유지하는 것이다.

## 2. 선행 조건

- payload classifier와 bridge 계약이 교차 매장 fixture에서 고정됨
- body/DOM shadow 판정 false positive 0
- stale 날짜·인원, 중복, 응답 순서 역전 식별 가능
- 기존 경로보다 유의미한 선행 시간과 사용 가능한 actuator가 실측됨
- claim guard가 shadow 모드에서 런당 최대 1회임을 증명함
- Tier 1 실제 오픈 시계 검증 결과가 판독됨

이 목록은 2-2 진입 당시의 gate다. RT-01·RT-03과 cycle correlation 보강은 완료됐고, 실제 오픈에서 기능과 fallback 안전성을 확인했다. 반면 유의미한 성능 개선과 pre-DOM actuator 근거는 확보하지 못했으므로 축소 경로만 채택했다.

### 2026-07-14 실제 오픈 판독

- 실제 `EMPTY → POPULATED` 전환과 body/DOM agreement true를 확인했다.
- body 분류는 DOM 후보보다 47.7ms 선행했고, DOM 관측부터 클릭까지는 약 7ms였다.
- 최초 확인된 `POPULATED` 자체가 app ReferenceClock 기준 약 +956ms에 도착했으므로 약 +1011ms 슬롯 클릭의 대부분은 DOM 폴링 비용이 아니다.
- 날짜 불문 `PerformanceResourceTiming` arrival은 canceled 인접 요청과 target 응답을 구분하지 못했다. target 날짜·인원이 검증된 body 이벤트가 없는 cycle도 존재했다.
- 따라서 A 경로만 검토한다. B 경로를 시작할 안전한 pre-DOM actuator 근거는 없다.

세부 근거: `../01-observation-safety/40-verification.md` §7.

## 3. 가능한 활성화 수준

### A. DOM claim 가속 (REDUCE 경로)

body 신호는 후속 토글을 중단하고 목표 슬롯 조건을 미리 준비하는 데만 사용한다. 실제 버튼 출현은 좁은 `MutationObserver` 또는 즉시 DOM 재검증으로 감지하고 기존 `clickSlot()`을 호출한다.

- 장점: 자동화 경계와 기존 SlotAdapter 재검증 유지
- 기대 이득: 최대 25ms 폴링 지연과 불필요한 스캔 일부 제거
- 한계: responseEnd→DOM 렌더 56~182ms는 제거하지 못함

실제 오픈 표본을 반영하면 wakeup은 임의 resource arrival이 아니라 날짜·인원이 검증된 target body 이벤트에만 연결해야 한다. body 이벤트가 없으면 기존 bounded DOM 대기와 토글 경로를 유지한다.

현재 구현은 `EXACT/STRONG` current-cycle body를 `AvailabilityDomWake`에 전달한다. 수락 즉시 DOM을 한 번 재검증하고 후보가 아직 없으면 body bridge 시점부터 최대 250ms 동안 10ms bounded scan을 수행한다. 좁은 MutationObserver는 telemetry 전용이며 제어 wake로 연결하지 않았다.

### B. 안전한 pre-DOM actuator (GO 경로)

사이트가 공개적으로 사용하는 안정된 액션 표면을 정찰로 확인한 경우에만 검토한다. React private property, minified 함수, Query cache 직접 변경은 DOM 변경보다 더 취약하므로 허용하지 않는다. 안정된 액추에이터를 찾지 못하면 이 경로는 폐기한다.

현재 안전한 공개 actuator 근거가 없어 구현하지 않았다. body만으로 후보를 선택하거나 클릭하는 승격은 승인되지 않았다.

## 4. 제어 구조

```text
BodyDetector ─┐
              ├→ ClaimCoordinator → DOM 재검증/Actuator → SLOT_SELECTED
DomDetector  ─┘          │
                         └→ 단 한 detector만 claim 성공
```

- detector는 후보를 제안할 뿐 직접 클릭하지 않는다.
- coordinator는 runId, request date/person, response sequence, candidate key를 검증한다.
- MAIN→ISOLATED bridge는 보안 인증 채널이 아니므로, body 제안만으로 DOM 버튼을 선택하지 않는다. 실제 클릭 직전에는 현재 날짜·인원·가용 슬롯 DOM을 다시 조회한다.
- claim 뒤 actuator가 실패하면 무조건 기존 DOM 루프로 복귀할지, claim을 해제할지는 설계 단계에서 상태 전이와 함께 명시한다. 무제한 재claim은 금지한다.
- body bridge가 끊기면 DOM detector만으로 현행 동작한다.

## 5. 필수 적대적 시나리오

- 인접 날짜 populated 응답이 목표 날짜 empty 응답보다 늦게 도착
- 동일 목표 응답 중복 전달
- body candidate 직후 사용자가 모달을 닫음
- body candidate와 DOM 버튼의 시간/가용 상태 불일치
- claim 직후 슬롯 소진으로 click 실패
- STOP과 claim 동시 발생
- 새 런 시작 후 이전 channel event 도착
- probe 설치 실패·페이지 리로드·확장 context 무효화

각 시나리오에서 클릭은 최대 1회이며, 잘못된 날짜·시간·인원 버튼은 0회여야 한다.

## 6. 완료 기준과 남은 판정

완료된 기능·안전 기준:

- 기존 자동화 경계와 post-slot 파이프라인 불변
- body 경로 장애 시 현행 DOM 성능으로 복귀
- dry-run 클릭 0회
- 중복 detector에서도 슬롯 클릭 최대 1회
- body/DOM/claim/click monotonic 타임라인으로 개선 폭을 설명 가능

남은 성능 판정:

- 실제 오픈에서 기존 기준보다 개선되고 오탐·조기 클릭 없음
- 동질 `off` 비교군과 공식 p95·wake counterfactual 확보
- 운영 기본(probe off) actual-open 확인

## 7. 종료 조건

RT-05에서 probe를 진단·실험 전용 기본 비활성으로 결정하고 Tier 2-2 구현 단계를 종료했다. 이 종료는 REDUCE 기능·안전 범위의 완료이며 성능 목표 달성 선언이 아니다. 공식 p95, body wake 인과 이득, 기본값 승격은 후속 측정이 필요하고 GO 경로는 계속 미승인이다.
