# Tier 2-1 — Shadow 관찰·안전 기반 분석

**상태:** 분석 완료, live 정찰 및 설계 승인 대기.
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
- 현재 responseEnd→DOM 렌더 지연은 56~182ms, DOM 폴링 간격은 최대 25ms다.

### 정찰로 확정할 항목

- 페이지가 실제로 사용하는 transport가 fetch인지 XHR인지, 둘 다인지
- `timeSlotMap`의 객체/배열/빈 값 변형과 시간 키 형식
- 요청 헤더를 wrapper에서 안정적으로 읽을 수 있는지
- 같은 document의 MAIN/ISOLATED realm에서 `performance.now()` 기준이 동일한지
- response body clone 판독이 원본 소비·사이트 렌더 타이밍에 영향을 주지 않는지
- 월 전환·인원 변경·테이블/메뉴 선택 요청도 같은 endpoint를 공유하는지

미확정 항목을 추측해 범용 wrapper를 먼저 만들지 않는다. DevTools 읽기 전용 정찰로 실제 transport 하나를 먼저 고정하고 필요한 표면만 패치한다.

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
  responseHeadersMonoMs: number;
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

현행 on-demand 정책을 유지한다. Background가 런 시작 시 `chrome.scripting.executeScript({ world: "MAIN" })`로 probe를 설치하고, START 명령에 동일한 `channelId`를 전달하는 구성이 현재 구조와 가장 맞는다.

- wrapper는 원본 요청을 `Reflect.apply`로 즉시 호출하고 원본 response를 지연 없이 반환한다.
- body 판독은 `response.clone()`에서 비동기로 수행하며 원본 stream을 소비하지 않는다.
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

## 10. 다음 산출물

정찰 결과를 반영한 `20-design.md`와 단계별 `30-implementation.md`를 별도 승인 후 작성한다. 이 분석만으로 production 코드를 변경하지 않는다.
