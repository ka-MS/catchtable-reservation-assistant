# 예약 자동화 아키텍처

## 구성

```text
Side Panel
  └─ Background Service Worker
       ├─ RunSupervisor / LogicalRun control plane
       ├─ PageRuntimePort / navigation / injection
       ├─ scheduled jobs / saved configs / storage
       ├─ TerminalEffects
       └─ telemetry repositories
            └─ on-demand Content Script
                 └─ OpenRunOrchestrator
                      ├─ preparation coordinators
                      ├─ ReferenceClock / toggle scheduler
                      ├─ SlotAdapter / PostSlotAdapter
                      └─ CompletionCoordinator
                           └─ ReservationFormAdapter

MAIN world availability probe
  └─ isolated bridge / correlation / AvailabilityDomWake
```

- Side Panel은 설정·작업·상태·실행 이력 UI를 소유한다.
- Background는 탭, 논리 실행, attempt, 영속 결정, terminal 효과와
  저장소를 소유한다.
- Content는 한 attempt의 준비·슬롯·후속 화면·완주 DOM 실행을
  소유한다.
- Adapter는 실측 selector와 DOM 사실·action을 소유한다.
- Shared는 Chrome·DOM에 의존하지 않는 설정, 상태, 정책과 protocol을
  소유한다.

## 의존 규칙

- CSS selector와 `querySelector`는 adapter·진단 경계 밖으로 새지
  않는다.
- shared는 `chrome.*`, `window`, `document`를 참조하지 않는다.
- 오케스트레이터는 adapter의 사실을 조합하며 selector를 알지 못한다.
- Content는 storage에 직접 쓰지 않고 Background protocol과 telemetry
  port를 사용한다.
- control plane 결정과 terminal side effect는 Background만 확정한다.
- 서버 기준 wait·deadline은 `performance.now()`에 앵커된 단조
  ReferenceClock을 사용한다.

## 설정과 일회성 authorization

`ReservationConfig`는 다음 범주를 가진다.

- 매장, 오픈·종료 시각, 예약 날짜·인원
- 희망 시간 범위·우선순위
- 진입 모드, dry-run과 날짜 토글 설정
- 후속 선택·결제 방식·테이블·메뉴 조건
- `availabilityProbeMode: off | observe | empty_exit`
- 예약 완주 opt-in, 결제금액 상한, 필수 입력 기본 답변

신규 Side Panel 폼은 `empty_exit`을 사용한다. 구 저장 설정에 모드가
없으면 `off`, legacy boolean true는 `observe`로 정규화한다.

CatchPay PIN은 `ReservationConfig`와 분리된 `OneShotRunAuthorization`
이다. 첫 수동 attempt에만 전달하며 recovery·scheduled attempt에는
복사하지 않는다. Content의 authorization handle은 값을 한 번만
소비하고 terminal cleanup에서 참조를 폐기한다.

## Data Plane

Content의 준비 단계는 세 coordinator가 같은 기계 루프를 재사용한다.

```text
adapter.inspect
  → classifier
  → policy fact
  → BoundedStepRunner
  → coordinator 의미
  → AttemptControlMessage
```

Entry·Calendar·Person adapter는 DOM 사실과 action 결과만 반환한다.
실패 원인 분류는 classifier, 재시도·RESET 여부는 policy가 소유한다.
준비 단계가 끝난 뒤 기존 slot hot path로 진입한다.

슬롯 후보는 `SlotAdapter`가 최종 DOM 상태를 재검증한 뒤 클릭한다.
XHR body와 Mutation telemetry는 슬롯 후보를 직접 선택하거나
클릭하지 않는다.

## Control Plane

`RunSupervisor`는 하나의 `LogicalRun`과 attempt 배열을
`chrome.storage.local.logicalRun`에 영속한다.

- attempt 결과를 원인·terminal outcome으로 접수
- persisted decision 뒤 ACK, 그 뒤 `RESET_PAGE | HANDOFF | TERMINAL`
  실행
- 같은 탭 reload를 사용하는 RESET_PAGE 최대 1회
- service worker 재시작 시 logical run reconcile
- terminal 배지·알림·예약 작업 결과의 멱등 실행
- outer/PIN submit의 phase별 durable claim과 replay 차단

Content의 `RUN_EVENT`는 UI projection과 telemetry 입력이다. 비동기
event 순서가 durable logical run 결정보다 terminal 효과를 먼저
확정하지 않는다.

## Availability 경로

- `off`: MAIN probe 없이 기존 25ms bounded DOM polling
- `observe`: 검증된 현재 cycle POPULATED가 polling wait를 깨우고
  제한된 burst scan 허용
- `empty_exit`: observe 동작과 current non-stale `EXACT EMPTY` cycle
  조기 종료

body는 신호일 뿐이다. 후보 선택·재검증·단일 click 권한은 항상
`SlotAdapter`에 있다. probe·bridge·correlation 실패는 DOM polling으로
폴백한다.

## 예약 완주

`CompletionCoordinator`는 예약 폼에서 다음 순서를 강제한다.

1. 실제 매장·날짜·시간·인원과 현재 결제금액 재검증
2. 유일한 CatchPay 선택과 일반결제 미선택 확인
3. 필수 입력과 필수 약관만 처리
4. stable fingerprint로 outer durable claim
5. 필요하면 same-origin PIN surface 확인과 pin durable claim
6. 성공 path·정확한 완료 문구·동일 예약 방문예정 확인

claim 이후 결과가 불명확하면 재제출하지 않고 `HANDED_OFF`로
종료한다. credential surface snapshot과 예약 폼의 민감한 fragment는
수집하지 않는다.

## 저장과 telemetry

`chrome.storage.local`은 다음 제품 상태를 보관한다.

```text
reservationConfig / draftForm
configHistory / configFavorites
scheduledJobs
activeRun / runEvents
logicalRun
```

raw PIN은 어느 키에도 저장하지 않는다. `requiredFormDefaultAnswer`는
telemetry config에서 빈 문자열로 정제한다.

상세 실행 추적은 IndexedDB `catchtable-reserve-telemetry`의
`runs`, `events`, `snapshots` store에 저장한다. Content가 Port batch로
보내고 Background가 transaction 저장 뒤 ACK한다. Side Panel은 최근
실행, CSV와 진단 ZIP을 제공한다.

## 주입과 배포

- manifest에는 `content_scripts`가 없다.
- Background는 PING 실패 때만 Content IIFE를 주입한다.
- availability mode가 필요할 때만 MAIN-world bundle을 주입한다.
- Content는 esbuild IIFE, Background와 Side Panel은 ES module이다.
- `npm run check:dist`가 manifest, 정적 파일과 번들 독립성을
  검증한다.
