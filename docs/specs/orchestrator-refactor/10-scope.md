# 오케스트레이터 리팩터 — 범위와 결정 노트

**기준일:** 2026-07-12
**상태:** 브레인스토밍 중 (A 설계 미확정). 이 문서는 논의된 범위·통찰·순서를 남기는 결정 노트다.

## 배경

`src/content/orchestrator.ts`의 `start()`가 626줄 단일 메서드다. 다른 모든 모듈은 300줄 이하인데 이것만 비대하다. entry 대기 → 날짜 준비 → 인원 준비 → 오픈 대기 → 토글 루프 → 슬롯 루프 → 후속 단계 루프가 전부 중첩 while문으로 한 메서드 안에 있다. 시간초과 진단(`lastInspection`) 수정 때 어느 중첩 루프에 넣을지 찾느라 파일 전체를 훑어야 했다 — 이 구조의 실제 비용이다.

## 핵심 통찰 (방향을 가르는 지점)

1. **어댑터(DOM)는 이미 제일 잘 분리돼 있다.** 오케스트레이터는 `EntryPort`/`CalendarPort`/`PersonPort`/`SlotPort`/`PostSlotPort` 인터페이스로만 대화하고, 실제 `querySelectorAll`은 `content/adapter/*.ts` 다섯 파일 안에만 있다. 626줄이 지옥인 이유는 "DOM 하드코딩"이 아니라 **타이밍·상태·텔레메트리·제어흐름이 한 함수에 인라인으로 뒤엉킨** 것이다. 예: slot-detected 블록 ~60줄에서 실제 어댑터 호출은 `slots.clickSlot`·`postSlot.inspect` 딱 2군데뿐이고 나머지는 전부 비어댑터 관심사다.
2. **XHR/변화감지 전환은 오케스트레이터를 안 뒤엎는다.** Port 인터페이스가 이미 격리막이다. `SlotAdapter`를 XHR 파싱으로 통째 교체해도 `SlotPort.readAvailableSlots()/clickSlot()` 시그니처만 지키면 오케스트레이터는 무변경. 따라서 "어댑터 DOM 쿼리 중복 제거"(D)와 "XHR 전환"은 별개 레이어의 문제이며, D를 지금 해도 XHR 전환과 무관하게 안전하다.
3. **네비게이터(`background/navigation.ts`)는 DOM을 안 만진다.** `chrome.tabs` API로 탭 이동만 기다린다. DOM 관측은 전부 content script 어댑터에 있다.

## 관심사 4개

- **A. 구조 리팩터 (동작 무변경):** `start()`를 단계별 named 함수로 분해. 여기엔 **두 층**이 있다 — (a) 제어흐름 분해(중첩 while → 단계 함수), (b) 텔레메트리 페이로드 추출(거대한 인라인 `data: {}` 블롭을 `timingEventData(...)` 등으로 분리). `postSlotEventData`가 이미 그 추출 패턴의 선례다.
- **B. 실패 스냅샷:** 실패 순간 DOM 증거 캡처. 범위는 **둘 다** — (1) 실제 JS 예외(throw), (2) 포기 전이(`HANDED_OFF`/`FAILED`/`TIMED_OUT`/`unknown`). 후자가 실사용에서 실제로 겪는 "에러"다.
- **C. 스냅샷 일반화:** 현재 `post-slot-inspection.ts`에만 있는 `DialogSnapshot`(certainty/strategy/evidence/fingerprint) 패턴을 entry/calendar/person 전 단계로 확장. observability 비대칭 채무 상환.
- **D. 어댑터 DOM 쿼리 중복 제거:** 5개 어댑터의 `querySelectorAll → isElementHidden 필터 → 라벨 파싱` 반복과 어댑터 간 크로스 의존(`entry.ts`가 `post-slot-inspection.ts`의 `findPromoDismissButton` import)을 공통화.

## 제약

- 성능 무영향. 슬롯 감지 루프는 25ms 간격(`orchestrator.ts` 슬롯 루프). 스냅샷은 **실패/예외 시에만** 캡처하고 성공 경로엔 분기 자체가 없어야 한다.
- 레이어를 쉽게 구분: 현재 (a) `dom.ts` 리프 헬퍼, (b) 어댑터(포트 구현), (c) 오케스트레이터. B는 어댑터 호출부와 오케스트레이터 사이의 얇은 계측 층으로 자연스럽다.

## 권장 순서

**A → (B+C) → D**, 각각 별도 스펙·브랜치.

- A가 반드시 먼저다. B(스냅샷 훅)를 626줄 단일 메서드에 지금 꽂으면 또 파일 전체를 훑어야 한다. A로 단계가 named 함수로 갈라진 뒤엔 "각 단계 경계에서 실패 시 스냅샷" 훅을 한 곳에 깔끔히 걸 수 있다.
- B와 C는 사실상 한 몸(스냅샷 캡처하려면 일반화된 스냅샷 함수 필요).
- D는 A/B/C와 독립. 아무 때나 가능.

## 미확정 (다음 결정)

- A만 먼저 스펙 떠서 끝내고 B/C/D는 A 끝난 코드 위에서 다시 브레인스토밍할지(추천), 아니면 3덩이를 지금 다 계획할지. 추천 근거: A가 코드 지형을 크게 바꿔서, A 결과 없이 B 설계를 확정하면 헛돈다.
- B의 스냅샷 저장 위치·형식(기존 telemetry trace에 실을지, `postSlotEventData` 확장인지).
