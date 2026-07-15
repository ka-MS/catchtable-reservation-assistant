# 오픈런 MVP 아키텍처

## 1. 구성 요소

```text
Side Panel
  -> Background Service Worker
       -> on-demand Content Script
            -> OpenRunOrchestrator
                 -> StateMachine
                 -> ClockService / Scheduler
                 -> CatchtableSiteAdapter
                      -> EntryAdapter
                      -> CalendarAdapter
                      -> PersonAdapter
                      -> SlotAdapter
                      -> PostSlotAdapter
```

- Side Panel: 설정과 상태 표시
- Background: 탭 확인, PING 후 단일 주입, 설정·런·이벤트 저장, 알림
- Content Script: 한 런의 오케스트레이션과 DOM 접근
- Shared core: 설정 검증, 시간·슬롯 선택, 상태 머신. Chrome/DOM 없이 테스트 가능
- Site Adapter: 실측된 선택자와 DOM 클릭만 소유

## 2. 의존 규칙

- 핵심 오케스트레이터는 CSS 선택자를 모른다.
- adapter 외 모듈은 `querySelector`를 호출하지 않는다.
- shared core는 `chrome.*`, `window`, `document`를 참조하지 않는다.
- Clock과 Scheduler는 주입 가능한 인터페이스다.
- Content Script는 storage를 직접 쓰지 않고 이벤트를 Background로 보낸다.

## 3. 설정 모델

```ts
interface ReservationConfig {
  targetUrl: string;
  openAtMs: number;
  reservationDate: string;
  personCount: number;
  timeRange: { startMinutes: number; endMinutes: number };
  priorityTimes: number[];
  postSlotEnabled: boolean;
  tablePreference: "any" | "hall" | "bar" | "room";
  menuKeyword: string;
  stopAtMs: number;
  entryMode: "auto" | "prepared";
  dryRun: boolean;
  preOpenLeadMs: number;
  toggleIntervalMs: number;
  availabilityProbeEnabled?: boolean;
}
```

`availabilityProbeEnabled`는 XHR 응답과 DOM wake timing을 측정하는 실험 설정이다. 기본값과 구버전 누락값은 `false`다. `true`인 실행만 MAIN-world probe를 주입하며, body는 DOM scan을 깨울 수만 있고 후보 선택과 클릭은 계속 `SlotAdapter`가 소유한다.

## 4. Clock 계층

```ts
interface Clock {
  now(): number;
}

interface ClockSyncAdapter {
  measure(url: string, signal: AbortSignal): Promise<ClockMeasurement>;
}
```

ReferenceClock 표본 수와 rolling buffer는 자동 관리한다. 사용자 설정에는 노출하지 않으며 trace의 `clockSampleCount`는 estimator가 실제 사용한 관측 수를 뜻한다.

`ClockMeasurement`는 서버 Date 초 값, 로컬 요청 중간 시각, RTT를 포함한다. 연속 표본에서 서버 초 값이 바뀌면 그 로컬 구간의 중간점을 서버 초 경계로 사용한다. 경계를 관찰하지 못한 경우에만 최소 RTT 표본군의 중앙 오프셋을 선택한다. 비즈니스 로직은 직접 `Date.now()`를 호출하지 않는다.

서버 동기화가 끝나면 `wall epoch + offset`을 `performance.now()`에 앵커링한다. 이후 wait, deadline, 토글 계획과 서버 로그는 단조 서버 시계를 사용한다. 로컬 이벤트 시각 `at`만 wall clock epoch를 유지한다. 오픈 직전 재동기화 성공 시 앵커를 교체하고 실패 시 기존 앵커를 유지한다.

## 5. Site Adapter 계약

```ts
interface ReservationSiteAdapter {
  inspectSetup(date: string): SetupInspection;
  refreshSlots(targetDate: string): Promise<void>;
  readAvailableSlots(): SlotCandidate[];
  clickSlot(slot: SlotCandidate): void;
}
```

- `EntryAdapter`: `aside#dock`의 예약 CTA와 웨이팅 전용 상태만 판별한다.
- `CalendarAdapter.prepareTarget`: 목표 월로 한 달씩 이동하고 목표 날짜를 선택한다. 월 텍스트 변화 전 같은 이동 버튼을 재클릭하지 않는다.
- `PersonAdapter`: 정확한 `personCount` 라디오만 선택하며 다른 인원으로 대체하지 않는다.
- `inspectSetup`: 목표 날짜 선택 여부와 인접 가용 날짜를 반환한다.
- `refreshSlots`: 인접 날짜와 목표 날짜를 한 번씩 클릭한다.
- `readAvailableSlots`: 표시 중이고 `data-busy="false"`인 유니크 슬롯만 반환한다.
- `clickSlot`: 논리 후보를 DOM에 다시 매칭하고 연결·표시·가용 상태를 재검증한 뒤 한 번 클릭한다.
- `PostSlotAdapter`: 판별된 후속 단계에서 visible radio/checkbox/수량 control과 진행 버튼을 다시 조회해 선택적 중간 단계를 진행한다. `다음/확인` 버튼 활성화를 제한 시간 안에서 기다린다.
- `PostSlotInspection`: 최신 visible dialog를 개인정보 없는 구조 snapshot으로 만들고 `exact | supported | unknown`으로 분류한다. exact aria-label 경로를 우선하며, 라벨 변경 시에만 제목과 단계 고유 control 구조를 함께 요구한다.
- 후속 행동은 inspection 이후 현재 kind와 구조 fingerprint가 유지되는지 재검증하고 DOM target을 다시 조회한 뒤 한 번만 수행한다. unknown은 클릭하지 않고 제한된 진단 정보를 실행 기록에 남긴다.

자동 준비가 끝난 뒤에도 `inspectSetup`을 다시 실행해 목표 날짜와 토글 가능한 인접 날짜를 검증한다.

## 6. 주입과 번들

- manifest에는 `content_scripts`가 없다.
- `entryMode=auto`에서 Background는 다른 활성 탭을 목표 매장 URL로 이동하고 load complete를 확인한다.
- Background는 START 전에 PING하고 응답이 없을 때만 `chrome.scripting.executeScript`를 호출한다.
- MAIN-world availability probe는 진단 설정이 명시적으로 켜진 실행에만 별도로 주입한다.
- Content Script 전역 가드로 동일 프레임의 중복 부트스트랩을 막는다.
- Content Script는 esbuild IIFE 단일 번들로 만들며 정적 `import`가 남아 있으면 빌드 검증 실패다.
- Background와 Side Panel은 MV3가 지원하는 ES module로 배포한다.

## 7. 실행 수명주기

- 시작마다 RunContext와 AbortController를 새로 만든다.
- 자동 준비는 예약 CTA 5초, 목표 월·날짜 10초, 인원 3초의 제한된 관측 구간을 사용한다.
- 중지, 시간 초과, 인계, 실패 시 timer와 observer를 모두 해제한다.
- 날짜 토글 기본 간격은 150ms이며, 정밀 구간의 목표 날짜 클릭은 서버 오픈 시각 기준 150ms 격자에 고정한다.
- 장시간 대기는 원칙적으로 오픈 5초 전에 시계를 다시 측정한다. 사전 시작이 3초를 넘으면 토글 시작을 막지 않도록 `사전 시작 + 2초`보다 앞당기며, 재측정 실패 시 초기 오프셋을 유지한다.
- Side Panel 카운트다운은 최신 서버 오프셋을 별도 `performance.now()` 앵커에 결합해 표시하며, 패널 컨텍스트가 새로 열리면 앵커도 새로 만든다.
- 인접 날짜 클릭은 목표 날짜 클릭 40ms 전에 수행하며 목표 클릭 시각까지 5ms tick으로 대기한다.
- 슬롯이 없으면 종료 시각까지 반복하되, 루프마다 AbortSignal과 서버 현재 시각을 확인한다.
- `postSlotEnabled=false`면 actual click 직후 인계하고 후속 DOM을 판독하지 않는다.
- `postSlotEnabled=true`면 actual click 뒤 최대 5초 동안 테이블 타입, 메뉴, 추가 상품, 예약금 안내, 예약금 0원 결제 방법을 순서와 존재 여부에 관계없이 판독한다.
- dialog 전환 중 활성 선택지가 0개면 실패가 아니라 전환 중으로 판정하고 제한 시간 안에서 재시도한다.
- 수량형 메뉴는 진행 버튼이 항상 활성이므로 버튼 상태 대신 총수량(예약 인원수 도달)을 진행 조건으로 사용한다.
- 예약 폼 URL을 처음 관측하면 그 시점부터 1.5초 동안 늦게 렌더되는 홍보 안내(확인했어요)를 닫을 기회를 준 뒤 `HANDED_OFF` 이벤트를 발행한다. 폼이 일반 후속 처리 제한 시간 직전에 나타나도 이 유예는 단축하지 않으며, 인계 로그의 서버 시각과 오픈 대비 지연은 폼 최초 관측 시각을 사용한다.
- 지원하지 않는 화면을 만나면 `HANDED_OFF` 이벤트를 발행한다.

## 8. 저장 모델

Background가 다음 키를 단독 소유한다.

```text
schemaVersion
reservationConfig
activeRun
runEvents (최대 300개 링버퍼)
configHistory (최대 20개)
configFavorites (최대 20개)
```

최근 설정은 예약 의도 fingerprint로 중복을 대체한다. fingerprint에는 정규화 식당 URL, 예약 날짜·인원, 희망 시간·우선순위, 테이블 타입과 메뉴 키워드를 사용하고 오픈 시각·종료 시각·실행 모드는 포함하지 않는다. 히스토리 쓰기는 직렬화하되 오픈런 시작 경로를 기다리게 하지 않는다.

Side Panel은 `storage.onChanged`로 상태와 저장 목록을 갱신한다. 지난 오픈 일시를 포함한 snapshot 복원은 허용하고 실제 실행 직전에 현재 시각 검증을 다시 수행한다.

상세 실행 추적은 `chrome.storage.local` 배열과 분리해 IndexedDB `catchtable-reserve-telemetry`의 `runs`, `events` store에 저장한다. Content Script는 250ms 또는 20건 단위 Port batch를 보내고, Background는 수신 순서대로 한 transaction에 저장한 뒤 ACK한다. 최근 실행 20건을 보관하며 Side Panel은 live batch를 증분 표시한다.

## 9. 취소 스나이핑 확장점

향후 `RunMode = OPEN_RUN | CANCELLATION`을 추가하고, 취소 모드는 동일 adapter를 30초 이상 간격으로 호출한다. 현재 MVP 타입과 UI에는 노출하지 않는다.
