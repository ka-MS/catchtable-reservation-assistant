# 실행 진단 적대적 리뷰

## 발견 1 - 클릭 전 hot path 지연

초기 구현은 모든 비터미널 상태에 breadcrumb를 만들 수 있어 `REFRESHING_SLOTS`와 `SLOT_DETECTED`에서 DOM 조회가 슬롯 클릭을 늦출 위험이 있었다.

조치:

- breadcrumb 상태를 명시적 허용 목록으로 제한했다.
- `REFRESHING_SLOTS`, `SLOT_DETECTED`, cycle/XHR/mutation/polling에서는 캡처하지 않는다.
- `SLOT_CLICK_DISPATCHED` 캡처는 실제 클릭 전달 후에만 수행한다.

## 발견 2 - 서비스 워커 재시작 시 진단 유실

실패 직후 `runtime.sendMessage` 채널이 끊기면 유일한 failure batch가 유실될 수 있었다.

조치:

- 채널 예외에 한해 한 번 재시도한다.
- ACK 거부는 반복하지 않는다.
- `snapshotId` key put으로 중복 저장을 무해하게 만들었다.
- 진단 실패는 예약 결과를 변경하지 않는다.

## 발견 3 - fragment 상한 표시의 불완전성

노드 수 상한으로 잘린 경우 64KiB 잘림과 달리 `data-truncated`가 없을 수 있었다.

조치:

- 노드 또는 byte 상한 어느 쪽이든 잘림 표시를 남긴다.
- 표시를 넣은 최종 HTML 자체가 64KiB 이하가 될 때까지 완전한 요소 단위로 줄인다.

## 발견 4 - 테스트 worker 자원 과다

전체 테스트의 jsdom worker 동시 실행이 WSL 메모리를 소진해 배포 산출물 생성 중 환경 재시작을 일으켰다.

조치:

- `node --test --test-concurrency=8`로 상한을 고정했다.
- 테스트 의미와 production runtime에는 영향이 없다.

## 남은 제한

- post-slot 외 Adapter는 아직 정량 confidence를 제공하지 않아 `null`로 정직하게 기록한다.
- fragment는 실행 가능한 완전 페이지가 아니라 허용 목록으로 정제된 진단 증거다.
- 전화·이메일·카드형 숫자를 마스킹하고 예약 폼 fragment를 금지하지만, 매장 화면의 일반 문구까지 익명화하지는 않는다. bundle은 로컬 저장 및 사용자 수동 내보내기 전용이다.
- Content 문서가 저장 완료 전에 강제로 종료되고 재시도도 실패하면 terminal Trace만 남을 수 있다. 이 경우 진단 기능이 예약 제어를 막지 않는 원칙을 우선한다.

## 결론

기능은 실패 분석 정보를 늘리면서 슬롯 탐색·클릭 hot path와 정상 실행 저장량을 건드리지 않는다. 현재 범위에서 배포 가능하다.
