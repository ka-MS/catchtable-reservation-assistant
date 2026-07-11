# 예약 작업 스케줄러 설계

**기준일:** 2026-07-11
**출처:** `docs/plans/next-development.md` #1

## 목표

여러 예약 작업을 저장하고, 오픈 시각이 되면 사람 없이 자동으로 실행한다. 정각 정밀 타이밍은 기존 서버 시계와 Content Script 스케줄러가 그대로 담당하고, 이 기능은 "정확한 시각에 실행을 켜는" 게이트만 책임진다.

## 확정된 결정

1. **완전 무인 실행.** 알람이 발화하면 Background가 대상 식당 탭을 스스로 열고 실행까지 시작한다.
2. **포커스 탭 정공법.** Chrome은 숨겨진 탭의 타이머를 스로틀링하므로(기본 1초, 최대 분당 1회), 오픈 정각의 10ms/5ms tick을 지키기 위해 탭을 활성 상태로 열고 창을 포커스한다. Web Worker 틱 우회는 채택하지 않는다.
3. **작업별 알람.** 활성 작업마다 `chrome.alarms` 1개를 등록한다(주기 폴링 없음).
4. **등록 시 충돌 차단.** 점유 구간이 겹치는 작업은 저장 단계에서 거부한다.
5. **UI는 목록 홈 + 화면 전환.** 홈=작업 목록, 폼 화면=새 작업/편집, 실행 화면=기존 카운트다운·이벤트 로그.

## 데이터 모델

```ts
type ScheduledJobStatus = "scheduled" | "running" | "finished" | "missed";

interface ScheduledJob {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: ScheduledJobStatus;
  config: ReservationConfig;
  result: { state: RunState; message: string; finishedAt: number } | null;
}
```

- 저장 위치: `chrome.storage.local`의 `scheduledJobs: ScheduledJob[]`.
- `finished`는 실행이 터미널 상태에 도달한 작업이며 `result.state`로 성공·인계·실패를 구분한다.
- `missed`는 오픈 창(stopAtMs)이 지나도록 실행되지 못한 작업이다.
- 작업 한도 `SCHEDULED_JOB_LIMIT = 10`.
- 스케줄 작업의 `entryMode`는 `auto`만 허용한다(`prepared`는 사람이 준비한 탭을 전제하므로 무인과 모순).

## 점유 구간과 충돌

```
occupancy(job) = [config.openAtMs - ALARM_LEAD_MS, config.stopAtMs]
ALARM_LEAD_MS = 75_000
```

- 알람은 `openAtMs - ALARM_LEAD_MS`에 발화한다(`chrome.alarms` 최소 해상도 30초의 오차 흡수 여유 포함).
- 신규·수정 작업의 점유 구간이 다른 `scheduled`/`running` 작업과 겹치면 저장을 거부하고 겹친 작업을 오류 메시지에 명시한다.
- 이미 실행 중인 즉시 실행(activeRun)은 충돌 검사 대상이 아니다. 알람 발화 시점에 activeRun이 비터미널이면 해당 작업은 `missed` 처리하고 알림한다.

## 실행 흐름

```
알람 발화 (T-75s)
→ 작업 로드, status가 scheduled인지 확인
→ status = running 저장
→ chrome.tabs.create({ url: config.targetUrl, active: true })
→ chrome.windows.update(windowId, { focused: true })
→ 탭 로드 완료 대기 → content 주입(ensureContent) → START 전송
→ 이후는 기존 오케스트레이터가 담당 (SYNCING_CLOCK → … → 터미널)
→ 터미널 이벤트 수신 시 작업을 finished로 갱신하고 result 기록
```

- 기존 `startRun`(활성 탭 요구)과 스케줄 경로의 공통부(주입·START·pending 관리)를 추출해 재사용한다.
- 실행 귀속: `ActiveRun`에 `scheduledJobId?: string`을 추가하고 `recordEvent`가 이를 승계한다. 터미널 상태 도달 시 해당 작업의 status/result를 갱신한다.
- 시작 실패(탭 생성 실패, 주입 실패, START 거부)는 작업을 `finished`(`result.state = "FAILED"`)로 기록하고 OS 알림을 띄운다.

## 복구 (Chrome 재시작)

`chrome.runtime.onStartup`과 `onInstalled`에서 reconcile을 수행한다.

```
각 작업에 대해:
- status가 scheduled 또는 running이고 now < stopAtMs
  → 알람 재등록 at max(now, openAtMs - ALARM_LEAD_MS)  (과거면 즉시 발화)
- status가 scheduled 또는 running이고 now >= stopAtMs
  → missed 처리 + OS 알림
- finished / missed → 변경 없음
```

- `running`이었다가 재시작된 작업도 오픈 창이 남아 있으면 즉시 재실행한다(슬롯이 남아 있을 수 있음).
- reconcile 판단은 순수 함수 `reconcileJobs(jobs, nowMs)`로 분리해 단위 테스트한다.

## 메시지 계약

```ts
type PanelCommand =
  | … 기존 …
  | { type: "SCHEDULE_JOB"; id: string | null; config: ReservationConfig }  // null이면 신규
  | { type: "DELETE_JOB"; id: string };
```

- `SCHEDULE_JOB`: 설정 검증 → entryMode 검사 → 충돌 검사 → 저장 → 알람 등록. 실패 시 `{ ok: false, error }`. `running` 작업의 수정은 거부한다.
- `DELETE_JOB`: `running` 작업은 거부한다("실행 중인 작업은 먼저 중지"). 그 외에는 알람 제거 후 삭제.
- 사이드패널은 `scheduledJobs`를 storage에서 직접 읽고 `chrome.storage.onChanged`로 갱신한다(기존 activeRun·runEvents 패턴과 동일).

## UI

세 화면을 `<section>` 전환으로 구성한다. 상태는 `currentView: "home" | "form" | "run"` 하나로 관리한다.

**홈(작업 목록)** — 기본 화면
- 작업 카드: 식당(URL 축약), 예약 날짜·인원·시간대, 오픈 시각과 남은 시간, 상태 배지(예정/실행 중/완료/놓침), 결과 한 줄(result.message).
- 카드 동작: 편집(폼 화면으로), 삭제(확인 후). 실행 중 카드는 "로그 보기"(실행 화면으로).
- 상단: "새 예약 작업" 버튼. 카운트다운 배너는 홈에서는 가장 이른 `scheduled` 작업의 오픈 시각을, 실행 화면에서는 활성 실행의 오픈 시각을 보여준다.

**폼 화면(새 작업/편집)**
- 기존 설정 폼과 저장 설정(히스토리·즐겨찾기) 섹션을 이 화면으로 이동한다.
- 동작: "예약 저장"(SCHEDULE_JOB), "지금 시작"(기존 PANEL_START, 즉시 실행 경로 유지), "뒤로".
- 편집 진입 시 대상 작업의 config로 폼을 채운다.

**실행 화면**
- 기존 상태 배지, 카운트다운 배너, 이벤트 로그, 중지 버튼을 이동한다.
- 실행이 시작되면(activeRun 비터미널 감지) 자동으로 이 화면으로 전환한다.

## 권한

`manifest.json` permissions에 `alarms`를 추가한다.

## 테스트 전략

- `shared/scheduled-jobs.ts`(신규): sanitize, upsert(한도·충돌), `findScheduleConflict`, `reconcileJobs` — 순수 함수 단위 테스트.
- `background`: SCHEDULE_JOB/DELETE_JOB 처리와 알람 발화 핸들러는 기존 background 테스트 패턴(의존성 주입)으로 검증.
- `sidepanel`: 작업 카드 뷰 모델(`jobCardModel(job, nowMs)`)을 순수 함수로 분리해 테스트.
- 탭 생성·포커스·주입 등 Chrome API 경계는 기존 관례대로 수동 검증 항목으로 남긴다.

## 범위 제외

- 사전 점검(로그인·CTA 확인)은 next-development #2로 분리한다.
- 멀티 탭 병렬 실행은 하지 않는다(단일 activeRun 유지).
- 작업 일시정지(enabled 토글)는 넣지 않는다. 삭제·재등록으로 충분하다.
