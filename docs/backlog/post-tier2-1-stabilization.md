# Tier 2-1 이후 안정화 backlog

**상태:** ACTIVE

**작성일:** 2026-07-14

**기준 코드:** `main@8ba22f5` (`Tier 2-1 availability shadow observation` 병합 완료)

**현재 체크포인트:** Tier 2-2 fallback 보존형 구현·RT-05 운영 격리 완료

**다음 성능 단계:** 공식 p95·wake counterfactual 측정은 후속 성능 backlog로 이관

## 1. 목적

Tier 2-1 완료 후 외부 정적 레드팀 리뷰와 실제 후속 예약 흐름에서 새로운 문제들이 발견됐다. 이 문서는 다음 내용을 한 곳에서 관리한다.

- 레드팀이 발견한 문제와 현재 TypeScript 원본을 대조한 결과
- 각 지적의 `수용`, `부분 수용`, `보류`, `조사 필요` 판정과 근거
- 현재 진행 중인 실오픈 기준선 측정을 훼손하지 않는 보완 작업 삽입 시점
- 다음 Tier 진입을 실제로 막는 항목과 막지 않는 항목의 구분
- 착수 전 항목이 spec으로 승격되는 조건과 이후 추적 링크
- 비스트로 꼬꼬뜨와 야키토리묵에서 발견된 신규 후속 화면 사례

이 문서는 구현 상세 spec이 아니다. 항목이 실제로 착수되면 해당 소유 영역에 분석·설계·구현·검증·적대적 리뷰 문서를 만들고, 이 문서에는 상태와 링크만 남긴다.

## 2. 현재 기준선과 작업 제약

현재 저장소 기준선은 다음과 같다.

- Tier 1 ReferenceClock 개선 완료
- Tier 2-1 XHR shadow 관찰 구현·자동 테스트·live dry-run 완료
- 실제 오픈 `EMPTY -> POPULATED`를 1회 확인했고 body가 DOM보다 47.7ms 선행했다. 34/34 events, dropped 0, 최종 사용자 인계까지 공식 판독 완료
- Tier 2-2 `REDUCE`를 구현했다. 검증된 body는 DOM scan만 깨우며 선택과 클릭은 기존 SlotAdapter가 담당한다.
- 자동 게이트와 Chrome·실제 오픈 기능 검증을 통과했다. RT-10M과 RT-05까지 완료한 현재 상태는 `REDUCE 기능·안전 범위 종료, probe 기본 비활성, 성능 이득·공식 p95 미입증`이다.
- live에서 확인한 `main` 밖 예약 portal 슬롯을 fixture로 고정하고 조상 가시성 필터를 유지한 채 SlotAdapter 범위를 보완했다.

현재 기준선을 보존하기 위해 다음 제약을 둔다.

1. RT-10M 전에는 실제 성능 향상 또는 20/40/60ms 축소를 주장하지 않는다.
2. XHR probe는 진단·실험 전용 기본 비활성 정책을 유지한다.
3. body claim만으로 클릭하거나 날짜 토글을 중단하지 않는다.
4. `SLOT_SELECTED`라는 기존 상태명이 서버 좌석 hold 완료를 증명한다고 간주하지 않는다.
5. 증거가 부족한 신규 화면은 selector를 추측해 자동 진행하지 않는다.
6. non-blocking 항목이 남았다는 이유만으로 다음 Tier 진입을 막지 않는다.

## 3. 레드팀 리뷰 대조 결과

리뷰는 압축된 JavaScript 산출물을 정적으로 분석했다. 아래 판정은 동일 기준선의 TypeScript 원본과 기존 Tier 2-1 설계·검증 문서를 다시 대조한 결과다.

### 3.1 슬롯 클릭을 실제 확보로 표현함

**레드팀 지적**

`SlotAdapter.clickSlot()`의 성공은 현재 버튼에 `click()`을 호출했다는 뜻일 뿐, 서버가 슬롯을 확보했거나 다음 예약 단계가 정상적으로 열렸다는 뜻이 아니다. 그럼에도 오케스트레이터는 즉시 `SLOT_SELECTED`로 전이하고 "시간 선택을 완료했습니다"라고 표시한다.

**코드 대조**

- `src/content/adapter/slots.ts`는 후보를 다시 읽고 연결·disabled 여부를 확인한 뒤 `button.click(); return true;`를 수행한다.
- `src/content/orchestrator.ts`는 클릭 반환값이 `true`이면 별도 화면 전환 확인 없이 `SLOT_SELECTED`로 전이한다.
- `postSlotEnabled=false`이면 후속 화면을 확인하지 않고 즉시 사용자에게 인계한다.

**판정: 수용**

클릭 dispatch와 후속 화면 전환 확인을 분리해야 한다. 다만 예약 폼이나 다음 dialog 출현만으로 서버 좌석 hold를 확정할 수는 없으므로, 근거 없이 `SLOT_HOLD_CONFIRMED`라는 의미를 도입하지 않는다. 구현 spec에서는 최소한 다음 의미를 분리한다.

```text
슬롯 클릭 dispatch
→ 후속 화면 전환 확인 중
→ 확인 가능한 예약 흐름 도착 또는 실패·경합·불명 상태
```

`postSlotEnabled=false`는 후속 선택을 자동 클릭하지 않는 설정이지, 방금 발생시킨 슬롯 클릭의 결과조차 확인하지 않는 설정으로 취급하지 않는다.

**보완 항목:** RT-01

### 3.2 40ms 리드와 60ms 선택 확인이 공격적임

**레드팀 지적**

인접 날짜와 목표 날짜 사이의 40ms, 목표 날짜 `aria-pressed` 확인 상한 60ms가 메인 스레드 지연과 React 렌더링 부하에 취약하다. MutationObserver 기반 확인과 실측 p95 기반 상한을 사용해야 한다.

**코드 대조**

- `src/shared/toggle-schedule.ts`의 `SWITCH_LEAD_MS`는 40ms 고정이다.
- `src/content/orchestrator.ts`의 목표 날짜 선택 확인 상한은 `targetClickAtMs + 60`이다.
- 슬롯 렌더 감지는 별도로 watch 도착과 최대 700ms quiescence를 사용하므로 전체 슬롯 감지가 60ms에 끝나는 구조는 아니다.
- 40ms 리드는 목표 날짜 요청을 서버 오픈 그리드에 맞추기 위한 의도적인 스케줄 값이다.

**판정: 부분 수용**

60ms 선택 확인은 이벤트 기반 관찰과 bounded fallback 검토 대상이다. 반면 인접 날짜가 완전히 선택될 때까지 기다린 뒤 목표 날짜를 클릭하면 오픈 정각 스케줄이 밀릴 수 있으므로 40ms를 즉시 제거하지 않는다. 실제 오픈 로그에서 다음 분포를 확보한 뒤 Tier 2-2에서 결정한다.

- 인접 날짜 계획·클릭 시각
- 목표 날짜 계획·클릭 시각
- 목표 날짜 선택 확인 시각
- 슬롯 응답 도착과 DOM 후보 감지 시각
- 메인 스레드 지연 또는 선택 미확인 발생 빈도

**보완 항목:** RT-04

### 3.3 `clockSampleCount` 설정이 실행에 반영되지 않음

**레드팀 지적**

사이드패널은 3~9회의 시계 표본 수를 설정하지만 실제 `ReferenceClockSampler` 생성에 값이 전달되지 않는다. 샘플러는 1.75초 주기로 계속 수집하며 최대 64개를 유지한다.

**코드 대조**

- 설정 모델, UI, 검증에는 `clockSampleCount`가 남아 있다.
- `src/content/index.ts`는 `createReferenceClockSampler(config.targetUrl, ...)`만 호출한다.
- 샘플러 기본값은 `periodMs=1750`, `bufferSize=64`다.
- 현재 rolling 관측은 과거 3~9회 burst 동기화에서 Tier 1 설계로 변경된 결과다.

**판정: 수용**

사용자에게 효과가 있다고 표시되는 설정이 실제 실행에 영향을 주지 않는 계약 오류다. 다만 값을 단순히 ring buffer 크기에 연결하면 "측정 횟수"라는 UI 의미와 여전히 일치하지 않는다. 실오픈 판독에서 실제 sample count, observation span, uncertainty를 확인한 뒤 다음 중 하나를 spec에서 결정한다.

- UI·설정·저장 모델에서 제거
- rolling clock의 최소 유효 표본 수로 재정의
- 다른 명시적인 ReferenceClock 품질 설정으로 대체

이 항목은 현재 시계 알고리즘이 동작하지 않는 버그가 아니므로 Tier 2-2 진입을 막지는 않는다.

**보완 항목:** RT-02

### 3.4 XHR prototype 관찰의 위험 대비 제어 효과가 없음

**레드팀 지적**

MAIN world에서 `XMLHttpRequest.prototype`을 감싸는 방식은 사이트 또는 다른 wrapper와 충돌할 수 있고 탐지 표면을 늘린다. 현재 body 후보는 클릭 제어에 사용되지 않으므로 운영판에서는 진단 전용으로 격리해야 한다.

**코드 대조**

- prototype wrapper를 사용하는 것은 사실이다.
- Tier 2-1은 처음부터 관측·비교 전용으로 설계됐으며 shadow 결과는 클릭, 토글, deadline, 상태 전이를 바꾸지 않는다.
- 원본 의미 보존, 예외 격리, channel 검증, 종료·만료 시 자기 wrapper 원복을 구현하고 테스트했다.
- live dry-run에서 body/DOM 일치, wrapper 원복, console error 없음까지 확인했다.
- 실제 오픈 empty-to-populated 비교와 운영 기본 활성화 여부는 아직 결정하지 않았다.

**판정: 부분 수용**

현재 probe는 알려지지 않은 운영 기능이 아니라 Tier 2-1 진단 실험이다. 실오픈과 Tier 2-2 비교가 끝나기 전에 제거하면 필요한 증거를 잃는다. Tier 2-2 종료 시 다음 중 하나를 명시적으로 결정한다.

- 진단 모드에서만 활성화
- 성능 이득이 없으면 제거
- 제한된 관측 경로로 유지하되 기본 비활성화

body 신호를 actuator로 승격하는 것은 별도 안전 근거가 없는 한 범위 밖이다.

**보완 항목:** RT-05

### 3.5 Catchtable DOM 변화에 취약함

**레드팀 지적**

슬롯, 인원, 월 이동, 진행 버튼 등 사이트 DOM과 문구에 대한 하드코딩이 많다. 특히 슬롯 버튼은 자신만 hidden인지 확인하고 숨겨진 조상 컨테이너를 확인하지 않아 캐러셀 복제본을 고를 수 있다.

**코드 대조**

- 슬롯 selector와 다수의 사이트 계약이 하드코딩된 것은 사실이다.
- 공용 `isElementHidden()`과 `visibleAll()`은 조상 `hidden`, `inert`, `aria-hidden`, computed style까지 검사한다.
- `SlotAdapter.readSlots()`만 공용 helper를 사용하지 않고 버튼 자신의 `aria-hidden`, `hidden`, `disabled`만 검사한다.
- 후속 단계는 이미 정규화 텍스트, exact/supported/unknown 분류, 다중 구조 증거, fingerprint, 개인정보 없는 snapshot, 모호할 때 인계를 사용한다.

**판정: 부분 수용**

즉시 확인된 구체 결함인 슬롯 조상 가시성은 수용한다. 전체 DOM 의존성은 단일 selector를 더 범용적으로 바꾸는 문제가 아니므로 Tier 3의 strategy·fixture·drift 관측 범위로 유지한다. 레드팀의 "사이트 변경 대응력" 우려는 유효하지만 현재 후속 화면 복원력 구조를 전혀 반영하지 않은 평점은 객관적 기준으로 채택하지 않는다.

**보완 항목:** RT-03, RT-08

### 3.6 반복 자동화의 운영정책 위험

**레드팀 지적**

빠른 날짜 토글, 반복 조회, 자동 슬롯 클릭과 후속 선택은 서비스에서 자동화 또는 비정상 접근으로 판단될 수 있다. 장시간·고빈도 동작은 차단이나 세션 무효화 위험을 높일 수 있다.

**코드 대조**

- 프로그램이 반복 토글과 자동 클릭을 수행하는 것은 사실이다.
- 현재 stopAt, 단계별 timeout, followup·long-tail 완화 간격은 존재한다.
- 공개적으로 확인 가능한 고객용 공식 문서만으로 자동화 금지와 제재 조건을 확정하지 못했다.

**판정: 부분 수용·보류**

정책 위반 여부를 확정 사실로 기록하지 않는다. 다만 기술적·운영적 위험은 유효하므로 Tier 3에서 최대 실행시간, 반복 완화, 명확한 중지, 진단/운영 모드 경계를 검토한다. 사용자 목적과 직접 충돌하는 임의의 속도 제한을 실측 근거 없이 이번 안정화 단계에 추가하지 않는다.

**보완 항목:** RT-09

### 3.7 리뷰의 정량 점수와 전체 결론

코드 구조와 관측 설계가 양호하다는 평가는 현재 자동 게이트와 live dry-run 결과에 부합한다. 반면 실전 신뢰도 등의 10점 척도는 산정 기준과 표본이 없어 공식 품질 지표로 채택하지 않는다.

다음 정성적 결론만 수용한다.

- 현재는 실제 오픈 반복 검증이 부족한 정교한 실험 단계다.
- 클릭 dispatch와 실제 예약 흐름 진입을 같은 성공으로 표시하면 안 된다.
- hot path 변경은 실오픈 기준선 측정 이후 근거를 바탕으로 수행해야 한다.

### 3.8 Tier 2-1 shadow timing의 cycle 상관관계가 부족함

**후속 리뷰 지적**

현재 `bodyLeadOverDomMs`는 MAIN world에서 payload 분류가 끝난 시각부터 DOM 후보 관측까지를 계산한다. ISOLATED world의 content script가 신호를 실제로 사용할 수 있는 시점은 `bridgeReceivedMonoMs` 이후이므로 실제 제어 가능 시간의 상한은 `domObservedMonoMs - bridgeReceivedMonoMs`로 봐야 한다.

또한 `latestTargetShadow`와 최초 shadow claim이 run 전체에 유지돼 이전 날짜 토글 cycle의 body와 이후 cycle의 DOM 후보를 비교할 수 있다. 실제 오픈 성능 통계에는 요청·응답·DOM이 같은 target click에서 발생했다는 상관관계가 필요하다.

**코드 대조**

- `requestSequence`, `responseCompletedMonoMs`, `payloadClassifiedMonoMs`, `bridgeReceivedMonoMs`, `domObservedMonoMs` 원시값은 이미 trace에 존재한다.
- `bodyLeadOverDomMs`는 `domObservedMonoMs - payloadClassifiedMonoMs`다.
- `requestSequence`는 body trace와 DOM 비교의 `bodySequence`에 존재하지만 날짜 토글 `cycle`과 결합돼 있지 않다.
- `latestTargetShadow`와 `ShadowClaimCoordinator.claim`은 run 단위로 유지된다.
- 목표 날짜 클릭 전후 DOM mutation generation과 stale DOM 존재 여부를 같은 correlation record로 남기지 않는다.

**판정: 수용**

문제는 원시 timestamp 부족보다 cycle correlation 부족이다. RT-10에서는 다음 관측 계약을 설계한다.

- target click마다 `cycleId`와 monotonic 기준점을 등록
- target date/person과 `requestSequence`를 같은 cycle에 연결
- response completed, payload classified, bridge received, DOM mutation, DOM candidate 관측을 같은 record에 연결
- `bridgeToDomMs`와 `targetResponseToDomMs`를 명확한 기준점으로 계산
- 클릭 직전 동기 DOM 전체 검색을 추가하지 않고 observer generation으로 stale DOM 여부 판정
- `correlationQuality`를 `EXACT`, `STRONG`, `WEAK`, `NONE`으로 분류
- Tier 2 성능 통계에는 `EXACT`와 `STRONG` 표본만 포함

RT-10은 현재 기준선 로그를 먼저 판독한 뒤 구현한다. correlation trace가 포함된 실제 오픈 표본 재측정은 RT-10M으로 분리한다. RT-10M 전에도 fallback을 보존한 Tier 2-2 분석·구현은 가능하지만 성능 이득 확정이나 body 기반 actuator 승격은 하지 않는다.

**보완 항목:** RT-10

## 4. 실제 후속 화면 신규 사례

### 4.1 비스트로 꼬꼬뜨 예약금 안내의 `다음` 버튼

**매장:** 비스트로 꼬꼬뜨

**URL:** `https://app.catchtable.co.kr/ct/shop/bistrotcocotte?type=DINING&date=260731`

**발견 단계:** `ADVANCING_RESERVATION`

**현재 결과:** `확인 버튼을 찾을 수 없습니다.`

수집된 안전 진단:

```text
dialog: 예약금 안내
buttons: 이전 | 다음
text: 예약금 안내 / 인원에 따른 예약 보증금 / 1인당 10,000원 / 2명 / 합계 20,000원
fingerprint: ss-3091c725
```

**판정: 수용**

현재 `advanceDepositNotice()`는 `확인`만 허용하지만 다른 진행 단계는 이미 `다음`과 `확인` 변형을 허용한다. 구현 시 다음 범위만 다룬다.

- 예약금 안내로 확실히 분류된 dialog에서 `확인` 또는 `다음` 진행 버튼 허용
- 제목·구조 기반 supported 판별도 `다음`을 진행 증거로 인정
- `이전`은 자동 클릭 대상에서 제외
- exact와 supported fixture를 각각 추가
- 유료 예약금 자체를 선택하거나 최종 예약을 제출하지 않음

**보완 항목:** RT-06

### 4.2 야키토리묵 미지원 후속 단계

**매장:** 야키토리묵

**URL:** `https://app.catchtable.co.kr/ct/shop/yakitorimook?date=260731`

**사용자 보고:** 7월 23일 오후 5시·7시 예약 흐름에서 새로운 사례 발생

URL의 `date=260731`과 사용자 보고 예약일 표현이 일치하지 않으므로 재현 조건을 추정하지 않는다. 현재는 단계 제목, 버튼, control, 전환 전후 snapshot이 부족하다.

**판정: 조사 필요**

구현 전에 다음 증거를 확보한다.

- 실패 직전과 직후 RunEvent·TraceEvent
- 현재 URL 종류와 dialog/presentation 구조
- 제목, 버튼 문구·disabled 상태
- radio, checkbox, quantity control 개수
- 개인정보를 제외한 text snippet과 fingerprint
- 앞 단계에서 선택한 테이블·메뉴·예약금 흐름
- 버튼 클릭 없이도 확인 가능한 화면 전환 관계

증거를 fixture로 고정하고 기존 화면 유형으로 안전하게 분류 가능한지 먼저 판단한다. 기존 유형으로 설명되지 않으면 새 kind와 행동 정책을 별도 spec에서 설계한다.

**보완 항목:** RT-07

## 4.3 사후 레드팀 리뷰 발견 (2026-07-15)

Tier 2-2 종료 후 [사후 레드팀 리뷰](../specs/open-timing-performance/02-availability-hot-path/90-redteam-review.md)가 분석·결정 근거를 재검증했다. RT-05 결정 자체는 유지하고 다음 세 항목을 신규 등재한다. F2(counterfactual 계측)와 F3(집계 스크립트 시계 gating)는 발견 당일 구현해 backlog로 넘기지 않는다.

### 4.3.1 probe off 구성의 actual-open 확인 표본 (F1)

26건 actual-open이 전량 probe 상시 주입 빌드에서 수집됐다. 운영 기본인 wrapper 미설치 구성의 실오픈 표본이 0건이다. **판정: 수용.** 다음 실제 오픈 1건을 probe off로 실행해 확인 표본을 남긴다. 코드 변경 없음. **보완 항목: RT-12**

### 4.3.2 inactive_cycle 기회비용 분석 (F4)

일치 body 19건 중 12건이 다음 cycle 도착으로 `inactive_cycle` 거절됐고(사용자 확인 성공 3건 전부 포함), 이 경우 F1 수정이 준 250ms render window 보존을 받지 못한다. 수락률이 7/19에 그친 원인(응답 지연 대 cycle 위상)과 "이전 cycle body + target 날짜 재확인 통과 시 window 보존만 허용" 완화의 비용·이득이 미분석이다. **판정: 조사 필요.** probe 진단 전용 결정과 별개이며 hot path 변경이므로 중요 예약 시즌에는 착수하지 않는다. **보완 항목: RT-13**

### 4.3.3 EXACT EMPTY body 기반 cycle 조기 종료 검토 (F5)

오픈→클릭 p50 1127ms의 지배 항은 서버 게시 지연 + cycle 양자화(~914ms)로, body wake가 건드릴 수 없는 구간이다. `EXACT EMPTY` body 확인 시 bounded 대기를 조기 종료해 cycle 주기를 줄이는 옵션은 검토된 적이 없다. 클릭 없는 경로라 오클릭 위험은 낮지만 재요청 빈도 증가 = 사이트 부하·운영정책 위험(RT-09와 동일 계열)이 있다. **판정: 조사 필요.** 채택하지 않더라도 우산 문서 §7 거부 대안 표 수준의 기각 근거를 남긴다. **보완 항목: RT-14**

2026-07-16 설계 메모에서 RT-14를 3신호 구조와 분리했다. 기존 XHR correlation을 재사용해 현재 cycle의 `EXACT EMPTY`만 별도 종료 신호로 전달할 수 있으므로 MutationObserver 제어 연결은 선행 조건이 아니다. 구현 전 기존 실측 CSV의 counterfactual 절감과 요청 증가량을 먼저 계산한다. 상세 계약은 [`100-three-signal-and-empty-early-exit.md`](../specs/open-timing-performance/02-availability-hot-path/100-three-signal-and-empty-early-exit.md)를 따른다.

### 4.3.4 원시 시계 표본 trace 기록 (F3 후속)

trace에는 `CLOCK_SYNCED` 요약 2건만 남고 개별 HEAD 표본(t0, t1, 서버 Date)이 없어 사후 재추정이 불가능하다. 원시 표본을 남기면 hindsight 재추정으로 일부 고불확실성 실행을 복원하고 estimator 오류를 분석할 수 있다. 단, 서버 풀 스큐가 실재하면 표본을 늘려도 하나의 정답으로 수렴하지 않으므로 모든 실행의 복원을 보장하지 않는다. **판정: 수용.** 설계 제약: 표본은 실시간 전송하지 않고 기존 메모리 ring을 actual arm에서 동결한 뒤 terminal에서 기존 trace flush에 합류시켜 정각 hot path의 메시지·로그 부담을 만들지 않는다. RT-11 이후라는 기존 순서는 blocking이 아니며 2026-07-16 명시적 착수 결정으로 먼저 진행한다. **보완 항목: RT-15**

RT-15의 성격은 서버 시계 **진단 로그 강화**다. 실시간 estimator, 예약 시각, 슬롯 제어 결정을 바꾸지 않고 각 HEAD 표본의 monotonic `t0/t1`, 서버 `Date`, RTT와 offset 후보를 제한된 메모리 ring에 보존하는 것이 범위다. flush 시점과 최대 표본 수, trace schema, 개인정보 비수집 계약은 별도 spec에서 확정한다.

## 5. 보완 항목 원장

`Blocks`는 해당 항목이 미완료일 때 실제로 진입하거나 종료할 수 없는 체크포인트만 표시한다. `없음`인 항목은 backlog에 남아 있어도 다른 Tier 진행을 자동으로 막지 않는다.

| ID | 항목 | 리뷰 판정 | 처리 시점 | Blocks | 상태 | spec/worklog |
|---|---|---|---|---|---|---|
| RT-01 | 슬롯 클릭 dispatch와 화면 전환 확인 분리 | 수용 | 실오픈 기준선 판독 후 | Tier 2-2 진입 | DONE | `docs/specs/slot-transition-outcomes/`, `docs/worklog/2026-07-14-03-rt01-slot-transition-outcomes.md` |
| RT-02 | `clockSampleCount` 설정 계약 정리 | 수용 | 실오픈 시계 표본 판독 후 별도 정리 | 없음 | DONE | `docs/specs/clock-sample-setting-contract/`, `docs/worklog/2026-07-14-05-rt02-clock-setting-contract.md` |
| RT-03 | SlotAdapter 조상 가시성 검사 | 수용 | 실오픈 기준선 판독 후 | Tier 2-2 진입 | DONE | `docs/specs/slot-ancestor-visibility/`, `docs/worklog/2026-07-14-02-rt03-slot-ancestor-visibility.md` |
| RT-04 | 40/60ms 실측과 선택 확인 개선 | 부분 수용 | Tier 2-2 | 없음 | DONE | `docs/specs/open-timing-performance/02-availability-hot-path/`, `docs/worklog/2026-07-14-09-tier2-2-availability-hot-path.md` |
| RT-05 | XHR probe 운영·진단 격리 결정 | 부분 수용 | Tier 2-2 종료 판정 | Tier 2-2 종료 | DONE | `docs/specs/open-timing-performance/02-availability-hot-path/80-probe-final-decision.md`, `docs/worklog/2026-07-15-05-live-run-analysis-probe-decision.md` |
| RT-06 | 비스트로 꼬꼬뜨 예약금 안내 `다음` 지원 | 수용 | 정확성·호환성 안정화 | 없음 | DONE | `docs/specs/deposit-notice-next/`, `docs/worklog/2026-07-14-06-rt06-deposit-notice-next.md` |
| RT-07 | 야키토리묵 신규 후속 단계 조사 | 수용 | 정확성·호환성 안정화 | 없음 | DONE | `docs/specs/seating-menu-sheet/`, `docs/worklog/2026-07-14-07-rt07-seating-menu-sheet.md` |
| RT-08 | 일반 DOM strategy·fixture·drift 대응 | 부분 수용 | Tier 3 | 없음 | DEFERRED | `03-runtime-resilience` 예정 |
| RT-09 | 장시간·고빈도 운영 안전장치 검토 | 부분 수용·보류 | Tier 3 | 없음 | DEFERRED | `03-runtime-resilience` 예정 |
| RT-10 | cycle-correlated shadow timing 보강 | 수용 | 현재 기준선 판독과 RT-03 완료 후 | Tier 2-2 구현 진입 | DONE | `docs/specs/availability-cycle-correlation/`, `docs/worklog/2026-07-14-04-rt10-cycle-correlation.md` |
| RT-10M | correlation 실제 오픈 재측정 | 후속 측정 | 다음 실제 오픈 가능 시점 | 성능 결론·actuator 승격 | DONE | `docs/specs/open-timing-performance/02-availability-hot-path/70-live-run-analysis.md` |
| RT-11 | 공식 p95와 wake counterfactual 측정 | 실측 보강 | 동질 actual-open 표본 확보 시 | 없음 | DEFERRED | `docs/specs/open-timing-performance/02-availability-hot-path/70-live-run-analysis.md` §10 |
| RT-12 | probe off 구성 actual-open 확인 표본 | 수용 | 다음 실제 오픈 | 없음 | PENDING | `docs/specs/open-timing-performance/02-availability-hot-path/90-redteam-review.md` F1 |
| RT-13 | inactive_cycle 기회비용·수락 완화 분석 | 조사 필요 | 중요 예약 시즌 이후 | 없음 | INVESTIGATE | `docs/specs/open-timing-performance/02-availability-hot-path/90-redteam-review.md` F4 |
| RT-14 | EXACT EMPTY body cycle 조기 종료 | 수용 | 구현·자동·Chrome 검증 완료, 비중요 실오픈 성능 검증 대기 | 없음 | DONE | `docs/specs/open-timing-performance/02-availability-hot-path/03-exact-empty-early-exit/` |
| RT-15 | 원시 시계 표본 ring buffer trace 기록 | 수용 | 구현·자동 검증 완료 | 없음 | DONE | `docs/specs/open-timing-performance/01-reference-clock-reliability/01-raw-sample-trace/` |
| RT-16 | 런타임 오류 분류와 오픈 전 준비 bounded recovery | 수용 | 구현·자동 검증 완료, Chrome live 재현 대기 | 없음 | PROMOTED | `docs/specs/open-timing-performance/03-runtime-resilience/01-rt16-preparation-recovery/` |

상태 값은 다음 의미로 사용한다.

- `PENDING`: 판정됐지만 구현 분석에 착수하지 않음
- `INVESTIGATE`: 안전한 설계에 필요한 실제 증거가 부족함
- `PROMOTED`: 별도 spec을 만들고 분석 또는 구현에 착수함
- `DEFERRED`: 의도적으로 이후 단계에 배치함
- `DONE`: spec 검증과 적대적 리뷰까지 완료함
- `DROPPED`: 근거와 함께 수행하지 않기로 결정함

## 6. 삽입 지점 매트릭스

| 체크포인트 | 수행·확인 항목 | 단계 전환 조건 |
|---|---|---|
| A. Tier 2-1 완료 직후 | 현재 코드로 실오픈 `EMPTY -> POPULATED`, 스큐, body/DOM lead, 40/60ms 자료 판독 | hot path 코드 변경 없이 현재 기준선 확보 |
| B. 현재 기준선 판독 후 정확성 안정화 | RT-03 완료. RT-01을 수행하고 RT-02, RT-06, RT-07은 blocking과 분리해 순차 처리 | RT-01 검증 완료 전 Tier 2-2 구현 진입 금지 |
| C. Tier 2-1 관측 보강 | RT-03으로 DOM 후보 정확성을 확보한 뒤 RT-10의 cycle correlation trace 구현 | RT-10 자동 게이트와 shadow 제어 독립성 검증 |
| D. correlation 실오픈 재측정 | RT-10M에서 실제 오픈 `EMPTY -> POPULATED`를 다시 측정하고 `EXACT` 또는 `STRONG` 표본 확보 | 유효 상관 표본 없이 성능 이득 확정·actuator 승격 금지 |
| E. Tier 2-2 분석·구현 | fallback을 보존하고 body 신호만으로 클릭하지 않으며 DOM 재검증 유지 | Tier 2-2 자체 성공 기준 통과; 성능 판정은 RT-10M 이후 |
| F. Tier 2-2 종료 판정 | RT-05에서 XHR probe를 진단 전용·기본 비활성으로 결정 | 완료. 공식 p95와 counterfactual은 non-blocking 후속 측정 |
| G. Tier 3 | RT-08, RT-09를 runtime resilience 범위에서 재분석 | 해당 Tier spec의 성공 기준에 따름 |

RT-02, RT-06, RT-07은 중요하지만 현재 Tier 2-2 진입 blocking으로 지정하지 않는다. 다만 HANDOFF가 정확성·호환성 안정화를 현재 체크포인트로 선택하면 해당 세션의 실제 다음 작업이 될 수 있다.

## 7. 항목별 최소 완료 조건

### RT-01

- 클릭 dispatch와 화면 전환 확인이 상태·로그에서 구분됨
- `postSlotEnabled=false`에서도 추가 자동 선택 없이 전환 결과를 확인함
- 다음 화면, 경합 실패, 제한시간 초과, unknown을 서로 다른 결과로 남김
- 서버 hold를 증명하지 못한 상태를 hold 완료라고 표시하지 않음
- 단위 테스트, 상태 머신 테스트, live 비최종 예약 흐름 검증 통과

### RT-02

- UI 설명과 실제 ReferenceClock 동작이 일치함
- 제거 또는 재정의 시 저장 설정·즐겨찾기·예약 작업 마이그레이션 영향을 처리함
- 시계 uncertainty와 armLead 회귀가 없음

### RT-03

- 슬롯 후보가 공용 조상 가시성 규칙을 사용함
- 숨겨진 캐러셀 조상 아래 복제 슬롯 fixture가 제외됨
- 실제 visible 슬롯 선택 회귀가 없음
- 실제 예약 drawer가 `main` 밖 portal에 렌더되는 사례를 fixture로 추가했고, hidden 배경 복제본을 제외하면서 visible portal 슬롯을 읽는 live 회귀를 통과함

### RT-04

- 실제 오픈 p95가 부족하므로 20ms settling, 40ms switch lead, 60ms confirmation cap을 유지함
- 목표 날짜 클릭의 서버시각 그리드를 불필요하게 지연시키지 않음
- 이벤트 기반 관찰이 실패해도 bounded fallback과 중지·timeout이 유지됨
- 클릭 직전 DOM 후보 재검증을 유지함

### RT-05

- probe의 최종 운영 정책이 문서와 설정에 명시됨
- 비활성 상태에서는 prototype wrapper가 설치되지 않음
- 활성 상태의 원본 의미 보존, 종료 원복, 제어 경로 독립성 회귀 테스트 통과

### RT-06

- `예약금 안내 + 이전/다음` fixture에서 `다음`만 선택함
- 기존 `예약금 안내 + 확인` fixture가 계속 통과함
- 다른 unknown dialog의 일반 `다음` 버튼을 오탐하지 않음

### RT-07

- 재현 가능한 진단 증거와 개인정보 없는 fixture 확보
- 기존 kind 재사용 또는 새 kind 도입 근거 기록
- 유료 선택·약관·최종 예약 안전 경계 유지

### RT-08·RT-09

Tier 3 분석에서 범위와 성공 기준을 다시 확정한다. 이 backlog 단계에서는 추측 구현하지 않는다.

### RT-10

- target click cycle과 target date/person 요청이 결합됨
- 동일 `requestSequence`의 response·bridge·DOM mutation·DOM 후보를 하나의 correlation record로 조회할 수 있음
- `bridgeToDomMs`, `targetResponseToDomMs`의 기준점과 단위가 trace 계약에 명시됨
- `correlationQuality`가 결정 규칙과 함께 기록됨
- `WEAK`와 `NONE` 표본이 성능 집계에서 제외됨
- run 전체의 오래된 shadow나 claim이 이후 cycle 통계에 섞이지 않음
- 관측 코드 실패가 기존 날짜 토글·DOM 슬롯 선택·상태 전이에 영향을 주지 않음

### RT-10M

- correlation trace를 포함한 실제 오픈 `EMPTY -> POPULATED` 유효 표본을 확보함
- `EXACT` 또는 `STRONG` body와 같은 cycle DOM 후보의 원시 시각·지연을 보존함
- 표본 확보 전에는 Tier 2-2 성능 이득이나 body actuator 승격을 주장하지 않음

## 8. Spec 승격과 추적 규칙

1. 항목 구현 분석을 시작할 때 해당 소유 영역에 spec을 만든다.
2. 이 문서의 상태를 `PROMOTED`로 바꾸고 `spec/worklog` 열에 spec 경로를 연결한다.
3. 상세 selector, 상태 전이, 테스트 목록, 구현 순서는 spec에만 작성한다.
4. 구현·검증·적대적 리뷰가 끝나면 상태를 `DONE`으로 바꾸고 worklog를 연결한다.
5. 수행하지 않기로 결정하면 `DROPPED`로 바꾸고 코드·실측 근거를 기록한다.
6. backlog 항목은 spec으로 승격된 뒤에도 삭제하지 않는다. 발견부터 종료까지의 판정 이력을 보존한다.

예시:

```text
RT-01 PENDING
→ 분석 착수
→ RT-01 PROMOTED · docs/specs/<owner>/<package>/10-analysis.md
→ 구현·검증·적대적 리뷰 완료
→ RT-01 DONE · docs/worklog/<date>-<task>.md
```

## 9. HANDOFF 연계 원칙

HANDOFF는 이 표 전체를 복사하지 않는다. 현재 체크포인트와 실제 blocking 항목만 기록한다.

현재 기준으로 실오픈 판독이 끝난 뒤의 HANDOFF 예시는 다음과 같다.

```md
현재 체크포인트: 실오픈 측정 후 정확성 안정화

Blocking backlog:
- RT-01 슬롯 클릭/화면 전환 확인 분리
- RT-10 cycle-correlated shadow timing 보강

참조: docs/backlog/post-tier2-1-stabilization.md
```

RT-02, RT-06, RT-07이 아직 남아 있더라도 HANDOFF에서 별도의 현재 작업으로 선택되지 않았고 `Blocks`가 `없음`이면 Tier 2-2 진입을 자동으로 금지하지 않는다.

## 10. 범위 밖

이 backlog 자체에서는 다음을 수행하지 않는다.

- body 응답만으로 슬롯을 직접 선택하거나 클릭
- 서버 API를 새로 호출하거나 요청 빈도를 높이는 최적화
- 결제, 약관 동의, 최종 예약 자동화
- 증거가 없는 Catchtable 화면의 범용 `다음`·`확인` 클릭
- 실측 근거 없는 40ms 제거 또는 반복 간격 변경
- 전체 Adapter 재작성
- red-team 정량 점수를 제품 품질 지표로 사용
