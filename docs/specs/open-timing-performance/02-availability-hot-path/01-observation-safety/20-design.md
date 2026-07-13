# Tier 2-1 — Shadow 관찰·안전 기반 설계

**상태:** 구현·검증 완료.
**분석:** `10-analysis.md`

## 1. 성공 기준

1. 사이트가 발생시킨 `time-slots` XHR의 요청 날짜·인원과 응답 요약을 원문 없이 기록한다.
2. body 분류와 기존 DOM 후보가 같은 슬롯을 가리키는지, body가 몇 ms 앞서는지 실행 trace로 확인한다.
3. probe·bridge·분류기 실패가 날짜 토글, DOM 스캔, 슬롯 클릭, 상태 전이에 영향을 주지 않는다.
4. 런 종료·중지·만료 시 MAIN world wrapper를 원복한다.

## 2. 고정 제약

- XHR만 패치한다. fetch는 실제 사용 근거가 생기기 전까지 지원하지 않는다.
- 요청을 새로 만들거나 body·header를 변경하지 않는다.
- 암호화 body, 전체 response, shopRef, 결제·사용자 정보는 전달·저장하지 않는다.
- shadow 결과는 클릭·토글·deadline·상태 전이를 바꾸지 않는다.
- `postMessage` channel은 상관관계 값이지 인증 수단이 아니다. 수신 payload는 항상 검증한다.

## 3. 구성

```text
Background
  ├─ content/index.js 주입
  └─ availability-probe.js를 MAIN world에 best-effort 주입
       ↓
MAIN AvailabilityProbe
  XHR open/setRequestHeader/send 관찰
  → loadend에서 responseText 분류
  → redacted postMessage
       ↓
ISOLATED AvailabilityShadowBridge
  source/schema/channel/크기 검증
  → bridgeReceivedMonoMs 추가
       ↓
RunSession ShadowObserver
  body 후보 정책 적용 + claim 기록
  → 기존 DOM 후보와 agreement/lead trace
```

MAIN probe 주입 실패는 시작 실패가 아니다. 기존 content 실행은 그대로 계속한다.

## 4. MAIN probe

별도 entry `src/main-world/availability-probe.ts`를 IIFE로 빌드한다. 전역 control 객체로 중복 설치를 막고, ACTIVATE 때 wrapper를 설치하며 DEACTIVATE 때 현재 prototype이 자기 wrapper일 때만 원복한다.

관찰 대상:

- method가 `POST`
- URL pathname이 `/api/reservation/v1/dining/time-slots`로 끝남
- `setRequestHeader`에서 `yymmdd`, `personcount`만 복사
- `send(body)`의 body는 읽지 않음

원본 `open`, `setRequestHeader`, `send`의 인자·반환값·throw를 그대로 유지한다. 응답은 `loadend` 이후 기본 text `responseText`만 읽는다. 파싱·메시지 전송 오류는 삼킨다.

ACTIVATE에는 `channelId`와 `expiresAtEpochMs`를 보낸다. 명시적 종료가 없어도 만료 시 비활성화·원복한다.

## 5. 분류 계약

`classifyAvailabilityResponse(responseText, request)`는 DOM·Chrome API가 없는 순수 함수다.

```ts
type AvailabilityClassification =
  | "EMPTY"
  | "POPULATED"
  | "UNPARSABLE"
  | "IRRELEVANT";
```

- `data.timeSlotMap`이 plain object가 아니면 `UNPARSABLE`
- 취소·비-2xx XHR은 payload 손상과 구분해 `IRRELEVANT`로 기록하고 status만 남김
- 요청 헤더와 응답 `inputDate`/`personCount`가 명시적으로 충돌하면 `IRRELEVANT`
- boolean `availableYn === true`인 항목의 strict HHmm만 분으로 변환
- true 항목의 시간이 유효하지 않으면 `UNPARSABLE`
- 가용 분이 0개면 `EMPTY`, 1개 이상이면 `POPULATED`
- 최대 64개, 중복 제거·오름차순

테이블 타입 코드는 선택 정책으로 해석하지 않는다.

## 6. Bridge 계약

수신 조건을 모두 만족한 이벤트만 통과시킨다.

- `event.source === window`
- 고정 message type·source·`schemaVersion: 1`
- 현재 런의 `channelId` 일치
- sequence가 양의 정수
- 분류 enum 일치
- 날짜·인원·시각 필드 타입과 `availableMinutes` 길이/범위 검증

bridge는 수신 즉시 `bridgeReceivedMonoMs = performance.now()`를 추가한다. START 전에 channel을 설정하고 런 시작에서 ACTIVATE, finally에서 DEACTIVATE한다.

## 7. Shadow observer와 claim

`ShadowClaimCoordinator`는 동기 순수 객체다. body 또는 DOM이 설정 범위·우선순위로 고른 후보를 제안하면 첫 후보만 claim으로 보관한다. 이 claim은 진단 데이터일 뿐 actuator 소유권이 아니다.

RunSession은 target date/person의 최신 body 이벤트만 비교 대상으로 유지한다. body 후보 선택은 기존 `selectPreferredSlot`을 재사용한다. DOM 후보가 발견되면:

- body/DOM 선택 분 일치 여부
- `domObservedMonoMs - payloadClassifiedMonoMs`
- first claim source
- response sequence

를 `AVAILABILITY_SHADOW` trace에 기록한다. 기존 `clickSlot()` 호출 위치와 조건은 변경하지 않는다.

## 8. Trace

새 code는 `AVAILABILITY_SHADOW` 하나만 추가하고 `phase` attribute로 구분한다.

- `phase=body`: classification, request date/person, sequence, available count/list, 선택 후보, 각 monotonic mark
- `phase=dom_compare`: DOM 후보, body 후보, agreement, body lead, claim source
- `phase=bridge_rejected`는 고빈도·스푸핑 가능성이 있어 저장하지 않는다.

모든 monotonic 값은 같은 document의 `performance.timeOrigin`을 전제로 한다. server epoch과 섞지 않는다.

## 9. 실패·수명

- background MAIN 주입 실패: 무시하고 DOM 경로 계속
- bridge event malformed/stale: 폐기
- classifier throw: `UNPARSABLE` 요약 또는 무시, 사이트 예외로 전파 금지
- 페이지 이동: document와 probe가 함께 폐기
- STOP/terminal: bridge DEACTIVATE, wrapper 원복
- 만료: MAIN probe 자체 원복

## 10. 2-2 판정

현재 warm 측정은 body가 DOM보다 19.1~30.0ms 앞선다. 안전한 pre-DOM actuator는 아직 없다. 따라서 2-1 종료의 임시 판정은 **REDUCE 우세**이며, 실제 오픈 empty→populated 자료에서 이득과 일치율을 재평가한다.
