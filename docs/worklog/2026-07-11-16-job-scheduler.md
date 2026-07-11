# 2026-07-11 예약 작업 스케줄러

## 수행

- 예약 작업 모델(`ScheduledJob`)과 순수 스케줄 로직(충돌 검사·한도·reconcile)을 추가했다.
- 작업별 `chrome.alarms`(오픈 75초 전 발화)로 무인 실행을 구현했다. 알람 발화 시 Background가 대상 식당 탭을 활성 탭 + 포커스 창으로 열고 실행을 시작한다(숨김 탭 타이머 스로틀링 회피).
- Chrome 재시작 시 `onStartup`/`onInstalled` reconcile로 알람을 재등록하고, 오픈 창이 지난 작업은 `missed` 처리 후 알림한다.
- 실행 결과를 `scheduledJobId`로 작업에 귀속해 터미널 상태를 `result`에 기록한다.
- 사이드패널을 홈(작업 목록)·폼(새 작업/편집)·실행(로그) 3화면으로 분리했다. 등록 시 점유 구간이 겹치는 작업은 저장 단계에서 차단한다.
- `manifest.json`에 `alarms` 권한을 추가했다.

## 검증

- 단위·fixture 테스트 146개 통과 (신규 28개: scheduled-jobs 11, repository 3, scheduler 9, job-card 5)
- 타입 검사, `dist` 검증, 모듈 독립성 검증, `git diff --check` 통과

## 사용자 확인

1. `chrome://extensions`에서 확장을 새로고침하고 사이드패널 홈에서 "새 예약 작업"으로 작업을 등록한다.
2. 서비스워커 콘솔에서 `chrome.alarms.getAll(console.log)`로 `job:<id>` 알람 등록을 확인한다.
3. 2~3분 뒤 오픈 시각의 dry-run 작업을 등록하고 무인 탭 생성·포커스·실행·결과 기록을 관찰한다.
4. Chrome을 재시작해 작업이 복구(알람 재등록)되는지 확인한다.
5. 점유 구간이 겹치는 두 번째 작업 등록 시 차단 메시지를 확인한다.
6. 3화면 전환(홈 ↔ 폼 ↔ 실행)과 실행 시작 시 자동 전환을 확인한다.

## 비고

- 설계·계획: `docs/specs/scheduler/20-design.md`, `docs/specs/scheduler/30-implementation.md`
- 종료 작업 이력은 최근 20개까지 보관한다(`FINISHED_JOB_KEEP`).
- 사전 점검(로그인·CTA 확인)은 next-development #2로 남긴다.
