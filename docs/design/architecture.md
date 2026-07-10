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
                      -> CalendarAdapter
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
  pagePrepared: boolean;
  dryRun: boolean;
  preOpenLeadMs: number;
  toggleIntervalMs: number;
  clockSampleCount: number;
}
```

## 4. Clock 계층

```ts
interface Clock {
  now(): number;
}

interface ClockSyncAdapter {
  measure(url: string, signal: AbortSignal): Promise<ClockMeasurement>;
}
```

`ClockMeasurement`는 서버 Date 초 값, 로컬 요청 중간 시각, RTT를 포함한다. 연속 표본에서 서버 초 값이 바뀌면 그 로컬 구간의 중간점을 서버 초 경계로 사용한다. 경계를 관찰하지 못한 경우에만 최소 RTT 표본군의 중앙 오프셋을 선택한다. 비즈니스 로직은 직접 `Date.now()`를 호출하지 않는다.

## 5. Site Adapter 계약

```ts
interface ReservationSiteAdapter {
  inspectSetup(date: string): SetupInspection;
  refreshSlots(targetDate: string): Promise<void>;
  readAvailableSlots(): SlotCandidate[];
  clickSlot(slot: SlotCandidate): void;
}
```

- `inspectSetup`: 목표 날짜 선택 여부와 인접 가용 날짜를 반환한다.
- `refreshSlots`: 인접 날짜와 목표 날짜를 한 번씩 클릭한다.
- `readAvailableSlots`: 표시 중이고 `data-busy="false"`인 유니크 슬롯만 반환한다.
- `clickSlot`: 논리 후보를 DOM에 다시 매칭하고 연결·표시·가용 상태를 재검증한 뒤 한 번 클릭한다.
- `PostSlotAdapter`: 실측된 dialog aria-label과 radio/checkbox 상태만 사용해 선택적 중간 단계를 진행한다. 렌더된 dialog 중 마지막 항목을 현재 화면으로 사용하며 `다음/확인` 버튼 활성화를 제한 시간 안에서 기다린다.

인원 자동 설정은 안정 선택 상태가 미실측이므로 계약에 포함하지 않는다. Side Panel의 페이지 준비 확인으로 경계를 명시한다.

## 6. 주입과 번들

- manifest에는 `content_scripts`가 없다.
- Background는 START 전에 PING하고 응답이 없을 때만 `chrome.scripting.executeScript`를 호출한다.
- Content Script 전역 가드로 동일 프레임의 중복 부트스트랩을 막는다.
- Content Script는 esbuild IIFE 단일 번들로 만들며 정적 `import`가 남아 있으면 빌드 검증 실패다.
- Background와 Side Panel은 MV3가 지원하는 ES module로 배포한다.

## 7. 실행 수명주기

- 시작마다 RunContext와 AbortController를 새로 만든다.
- 중지, 시간 초과, 인계, 실패 시 timer와 observer를 모두 해제한다.
- 날짜 토글 기본 간격은 150ms이며, 정밀 구간의 목표 날짜 클릭은 서버 오픈 시각 기준 150ms 격자에 고정한다.
- 장시간 대기는 오픈 직전 시계를 다시 측정하고, 재측정 실패 시 초기 오프셋을 유지한다.
- 인접 날짜 클릭은 목표 날짜 클릭 40ms 전에 수행하며 목표 클릭 시각까지 5ms tick으로 대기한다.
- 슬롯이 없으면 종료 시각까지 반복하되, 루프마다 AbortSignal과 서버 현재 시각을 확인한다.
- `postSlotEnabled=false`면 actual click 직후 인계하고 후속 DOM을 판독하지 않는다.
- `postSlotEnabled=true`면 actual click 뒤 최대 5초 동안 테이블 타입, 메뉴, 추가 상품, 예약금 안내, 예약금 0원 결제 방법을 순서와 존재 여부에 관계없이 판독한다.
- dialog 전환 중 활성 선택지가 0개면 실패가 아니라 전환 중으로 판정하고 제한 시간 안에서 재시도한다.
- 예약 폼 URL에 도착하거나 지원하지 않는 화면을 만나면 `HANDED_OFF` 이벤트를 발행한다.

## 8. 저장 모델

Background가 다음 키를 단독 소유한다.

```text
schemaVersion
reservationConfig
activeRun
runEvents (최대 300개 링버퍼)
```

Side Panel은 `storage.onChanged`로 상태를 갱신한다.

## 9. 취소 스나이핑 확장점

향후 `RunMode = OPEN_RUN | CANCELLATION`을 추가하고, 취소 모드는 동일 adapter를 30초 이상 간격으로 호출한다. 현재 MVP 타입과 UI에는 노출하지 않는다.
