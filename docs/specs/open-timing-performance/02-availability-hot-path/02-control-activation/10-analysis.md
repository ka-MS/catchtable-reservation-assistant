# Tier 2-2 — 제어 경로 활성화 분석

**상태:** 조건부 대기. Tier 2-1의 GO 또는 REDUCE 판정 전 구현 금지.
**부모:** `../10-analysis.md`

## 1. 목적

Tier 2-1에서 신뢰성과 실제 선행 시간이 검증된 availability 신호만 기존 예약 제어 경로에 연결한다. 목표는 detector를 늘리는 것이 아니라, 단 하나의 슬롯 claim을 더 이르게 확정하면서 기존 DOM 폴백과 안전 경계를 유지하는 것이다.

## 2. 선행 조건

- payload classifier와 bridge 계약이 교차 매장 fixture에서 고정됨
- body/DOM shadow 판정 false positive 0
- stale 날짜·인원, 중복, 응답 순서 역전 식별 가능
- 기존 경로보다 유의미한 선행 시간과 사용 가능한 actuator가 실측됨
- claim guard가 shadow 모드에서 런당 최대 1회임을 증명함
- Tier 1 실제 오픈 시계 검증 결과가 판독됨

하나라도 충족하지 않으면 2-2로 넘어가지 않는다.

## 3. 가능한 활성화 수준

### A. DOM claim 가속 (REDUCE 경로)

body 신호는 후속 토글을 중단하고 목표 슬롯 조건을 미리 준비하는 데만 사용한다. 실제 버튼 출현은 좁은 `MutationObserver` 또는 즉시 DOM 재검증으로 감지하고 기존 `clickSlot()`을 호출한다.

- 장점: 자동화 경계와 기존 SlotAdapter 재검증 유지
- 기대 이득: 최대 25ms 폴링 지연과 불필요한 스캔 일부 제거
- 한계: responseEnd→DOM 렌더 56~182ms는 제거하지 못함

### B. 안전한 pre-DOM actuator (GO 경로)

사이트가 공개적으로 사용하는 안정된 액션 표면을 정찰로 확인한 경우에만 검토한다. React private property, minified 함수, Query cache 직접 변경은 DOM 변경보다 더 취약하므로 허용하지 않는다. 안정된 액추에이터를 찾지 못하면 이 경로는 폐기한다.

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

## 6. 성공 기준

- 기존 자동화 경계와 post-slot 파이프라인 불변
- body 경로 장애 시 현행 DOM 성능으로 복귀
- dry-run 클릭 0회
- 중복 detector에서도 슬롯 클릭 최대 1회
- body/DOM/claim/click monotonic 타임라인으로 개선 폭을 설명 가능
- 실제 오픈에서 기존 기준보다 개선되고 오탐·조기 클릭 없음

## 7. 종료 조건

2-1 결과가 NO-GO이거나 안전한 actuator가 없고 DOM claim 가속의 이득도 미미하면 Tier 2-2는 구현하지 않는다. "이미 문서를 만들었다"는 이유로 활성화를 강행하지 않는다.
