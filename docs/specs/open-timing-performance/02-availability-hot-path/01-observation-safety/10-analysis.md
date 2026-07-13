# Tier 2-1 — Shadow 관찰·안전 기반 분석

**상태:** 분석·정찰·shadow 검증 완료. 2-2 판정은 REDUCE.
**부모:** `../10-analysis.md`

## 1. 목표

사이트가 스스로 발생시킨 availability 응답을 MAIN world에서 읽기 전용으로 관찰하고, 기존 DOM 감지와 나란히 기록한다. 이 단계의 결과는 "더 빨리 클릭"이 아니라 다음 질문에 대한 재현 가능한 답이다.

1. 실제 transport는 `fetch`와 XHR 중 무엇이며 실행 중 바뀌는가?
2. `data.timeSlotMap`은 매장·테이블 타입·메뉴 조건에 관계없이 안정적으로 정규화 가능한가?
3. body 판정은 DOM 후보 출현보다 실제로 얼마나 빠른가?
4. 응답 역전·중복·인접 날짜 응답을 안전하게 구분할 수 있는가?
5. body 신호를 제어 경로에 연결할 가치와 안전한 액추에이터가 있는가?

## 2. 범위

### 포함

- transport와 payload의 읽기 전용 정찰
- on-demand MAIN-world shadow probe
- 응답을 `EMPTY | POPULATED | UNPARSABLE | IRRELEVANT`로 정규화하는 순수 classifier
- 요청 헤더의 `yymmdd`·`personcount`와 응답 sequence를 이용한 상관관계
- MAIN→ISOLATED bridge의 스키마·run channel 검증·수명 관리
- body/bridge/DOM/click 단조 타임라인 계측
- 다중 detector claim 상태기계의 순수 구현·shadow 검증
- redacted fixture와 단위·통합 테스트

### 제외

- shadow 결과에 따른 클릭·토글 중단·오케스트레이터 상태 전이
- availability 직접 호출, 요청 body 복제, 요청 헤더 변경
- React 내부 상태·TanStack Query cache·사이트 비공개 함수 호출
- 최종 예약 제출 범위 변경
- body detector를 실제 actuator로 승격

## 3. 사실과 미확정 가정

### 실측된 사실

- endpoint는 별도 호스트의 `POST .../dining/time-slots`이며 URL에 날짜가 없다.
- 요청 헤더에는 `yymmdd`와 `personcount`가 있고 body는 `encryptedParamString`이다.
- 응답은 200 + `data.timeSlotMap`이고 각 항목에 `availableYn`, `date`, `time` 등이 있다.
- `PerformanceObserver`는 ISOLATED world에서 리소스 완료를 볼 수 있다.
- 실제 transport는 세 매장 모두 `XMLHttpRequest`였고 XHR `responseType`은 기본 text였다.
- `setRequestHeader`에서 `yymmdd`·`personcount`를 읽을 수 있고 응답의 `inputDate`·`personCount`와 교차 검증할 수 있다.
- 빈 `timeSlotMap`은 `{}`, 가용 map은 HHmm key와 boolean `availableYn`을 사용했다.
- warm 토글에서 body 분류→DOM 슬롯 출현은 19.1~30.0ms(n=3)였다. 실제 오픈 전이는 아직 미실측이다.
- 같은 document의 MAIN/ISOLATED world는 `performance.timeOrigin`이 같았다.
- 테이블 타입 사용 매장의 `onlineTableTypeList`는 문자열 코드 배열이었고 슬롯 `tableType`은 빈 문자열일 수도 있었다.

### 남은 미확정 항목

- 실제 오픈 순간 empty→populated 전이와 응답 역전 빈도
- 다른 매장의 비정상 `timeSlotMap` 변형과 `availableYn` 타입 변형
- probe를 장시간 활성화했을 때 사이트 동작·XHR 지연 회귀 여부
- 월 전환·테이블/메뉴 선택 요청도 같은 endpoint를 공유하는지

실측에 따라 production probe는 XHR만 패치한다. fetch 지원은 실제 transport 변화가 관측되기 전에는 추가하지 않는다.

## 4. 관찰 타임라인

모든 시각은 같은 document time origin의 monotonic milliseconds로 수집하고, content가 런 시작 대비 값으로 변환한다.

```text
requestObservedMonoMs
→ responseHeadersMonoMs
→ bodyReadCompletedMonoMs
→ payloadClassifiedMonoMs
→ bridgeReceivedMonoMs
→ resourceResponseEndMonoMs
→ domCandidateObservedMonoMs
→ slotClickedMonoMs
```

`fetch()` promise는 headers 시점에 resolve될 수 있으므로 `responseHeaders`와 clone body 완료를 구분한다. 기존 `xhrArrivalServerAtMs`는 PerformanceObserver callback에서 찍은 기준시계 값이라 정확한 `responseEnd` 대체값으로 사용하지 않는다.

주요 파생값:

- `bodyToBridgeMs = bridgeReceived - bodyReadCompleted`
- `bodyToDomMs = domCandidateObserved - bodyReadCompleted`
- `domToClickMs = slotClicked - domCandidateObserved`
- `bodyLeadOverDomMs = domCandidateObserved - payloadClassified`
- `shadowAgreement = body 분류와 DOM 가용 판정의 일치 여부`

## 5. Shadow 이벤트 최소 계약

원문 body 대신 허용된 요약만 전달·저장한다.

```ts
interface AvailabilityShadowEvent {
  schemaVersion: 1;
  channelId: string;
  sequence: number;
  requestDate: string | null;
  personCount: number | null;
  classification: "EMPTY" | "POPULATED" | "UNPARSABLE" | "IRRELEVANT";
  availableMinutes: number[];
  responseStatus: number;
  requestSentMonoMs: number;
  responseCompletedMonoMs: number;
  bodyReadCompletedMonoMs: number;
  payloadClassifiedMonoMs: number;
}
```

- `availableMinutes`는 유효한 정수·허용 개수 상한을 적용하고 기타 필드는 버린다.
- `channelId`는 런마다 생성한 상관관계 값이다. content는 `event.source === window`, message type, schema, channel, 배열 상한을 모두 검증한다.
- page script도 `window.postMessage`를 볼 수 있으므로 channel은 인증 수단이 아니다. bridge payload는 끝까지 비신뢰 입력으로 취급하며, 2-2에서도 DOM 재검증 없는 클릭 근거로 사용하지 않는다.
- shopRef, 암호화 문자열, 전체 URL query, 메뉴명, 결제·사용자 데이터는 싣지 않는다.
- seq는 응답 순서를 뜻하며 최신 요청의 날짜·인원과 맞지 않는 stale 응답을 식별하는 데만 쓴다.

## 6. 주입·수명 원칙

현행 on-demand 정책을 유지한다. Background가 런 시작 시 `chrome.scripting.executeScript({ world: "MAIN", files: [...] })`로 probe를 설치하고, START 명령에 동일한 `channelId`를 전달한다.

- wrapper는 원본 요청을 `Reflect.apply`로 즉시 호출하고 원본 response를 지연 없이 반환한다.
- XHR `loadend` 이후 `responseText`를 읽고 분류한다. fetch clone 경로는 구현하지 않는다.
- 관찰/파싱/bridge 오류는 모두 삼키고 기존 사이트 동작을 계속한다.
- 같은 페이지의 중복 설치를 막고 런 종료 시 해제한다. 안전하게 원복할 수 없는 경우 페이지 수명 단일 probe + 활성 channel 교체 방식을 설계 단계에서 비교한다.
- probe 미설치·bridge 단절·classifier 실패는 기존 DOM 경로에 아무 영향이 없어야 한다.

## 7. Claim guard의 2-1 범위

2-1에서는 다중 detector 중재기를 순수 상태기계로 만들고 **shadow 제안만** 통과시킨다.

```text
OBSERVING
  ├─ propose(body, candidate) ─┐
  └─ propose(dom, candidate)  ─┴→ CLAIMED(candidate, source, sequence)
CLAIMED → 이후 제안 무시
```

실제 `clickSlot()`은 기존 단일 오케스트레이터 경로가 계속 호출한다. shadow claim은 어떤 제안이 먼저였는지와 중복/역전 시 결과만 로그로 남긴다. 이 방식으로 guard 계약을 검증하면서 사용자 동작은 바꾸지 않는다.

## 8. 검증 기준

### 자동

- fixture: empty, populated, 혼합 availableYn, malformed, 날짜 불일치, 중복/역전
- wrapper: 원본 fetch/XHR 호출 인자·반환값·예외가 변하지 않음
- bridge: channel/schema/크기 검증, malformed/stale event 거부
- classifier: 원문 저장 없이 분 단위 후보만 생성
- claim guard: 런당 claim 최대 1회, stop/새 런 격리
- probe 실패 시 기존 오케스트레이터 테스트와 timing assertion 무수정 통과

### live shadow

- 최소 두 매장에서 빈 응답과 가용 응답 구조 교차 확인
- 같은 응답에 대한 body와 DOM 분류 일치
- 기존 `DATE_TOGGLE_CYCLE`, `SLOT_DETECTED`, `SLOT_SELECTED` 결과·시각에 회귀 없음
- dry-run에서 shadow claim이 발생해도 슬롯 클릭 0회
- 실제 오픈 또는 보존된 실오픈 fixture에서 empty→populated 전이와 응답 역전 여부 기록

## 9. 2-2 진입 판정 산출물

2-1 종료 문서는 다음 중 하나를 명시한다.

- **GO:** body 분류가 안정적이고 유의미하게 선행하며 안전한 actuator 후보가 있다.
- **REDUCE:** body는 선행하지만 pre-DOM actuator가 없어 MutationObserver 기반 DOM claim 가속만 가치가 있다.
- **NO-GO:** 분류 불안정, 선행 이득 미미, 또는 wrapper가 사이트 동작에 영향을 준다. shadow probe를 제거하고 현행 경로를 유지한다.

## 10. 결론

- XHR 응답은 warm 실측에서 DOM보다 19.1~79.4ms 먼저 분류됐고 같은 슬롯을 선택했다.
- 현재 actuator는 렌더된 DOM 버튼이므로 body 신호만으로 이 구간 전체를 제거할 수 없다.
- 기존 제어 경로를 바꾸지 않는 shadow 계측은 유지할 가치가 있지만, 2-2는 응답 기반 클릭으로 바로 진행하지 않는다.
- 실제 오픈 empty→populated 자료를 추가 수집하고 MutationObserver 기반 DOM claim 가속만 별도로 검토한다.

상세 근거는 `40-verification.md`, 적대적 검토는 `50-adversarial-review.md`에 기록한다.
