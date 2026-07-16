# RT-16A 설계 — 준비 단계 관측성

## 범위

행동을 바꾸지 않고 준비 단계의 원인 재구성에 필요한 change-based trace를 추가한다.

- Background START 경계: tabId, windowId, tab active, window focused, 캡처 시각
- stage 시작과 관측 가능한 후조건 변화
- CTA·날짜·인원 dispatch 직전·직후
- 정체 판정과 recovery decision
- Content 환경: visibility, focus, viewport, active element, URL kind, 구조 fingerprint

## 계약

- 새 code `PREPARATION_OBSERVED`를 사용한다.
- runId는 기존 trace envelope를 사용하고 Background 문맥은 START 메시지로 Content에 전달한다.
- poll마다 기록하지 않고 상태·dispatch·decision이 바뀔 때만 기록한다.
- 개인정보가 될 수 있는 입력값·본문은 기록하지 않는다.
- 관측 실패와 trace 실패는 준비·예약 결과를 변경하지 않는다.
