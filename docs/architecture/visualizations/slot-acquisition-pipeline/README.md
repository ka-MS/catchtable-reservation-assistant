# 폴링 기준 하이브리드 슬롯 획득 파이프라인

현재 슬롯 획득 구조와 미구현 3신호 슬롯 감지 후보를 통신 이동으로
비교하는 아키텍처 시각화다. 공식 구조와 실행 상태는
[아키텍처 개요](../../overview.md)와
[상태 머신](../../state-machine.md)을 기준으로 판단한다.

## 실행

[시각화 열기](index.html)

별도 서버나 빌드가 필요 없다. `index.html`을 브라우저에서 직접 열면 된다.

## 포함 범위

- 서버 시각 기반 `nextTogglePlan()`
- 인접 날짜 → 목표 날짜의 `runToggleCycle()`
- Catchtable XHR 응답과 MAIN-world probe
- Content bridge와 cycle/request correlation
- `AvailabilityDomWake`의 `scan_wake`와 `empty_exit`
- 기본 25ms polling과 POPULATED 이후 10ms bounded burst
- DOM 렌더와 `SlotAdapter`의 최종 재검증·단일 클릭
- 미구현 3신호 coordinator의 XHR, MutationObserver, polling 병합

## 시각화와 실제 구현의 경계

현재 구조 탭은 실제 구현 계약을 설명한다.

- `off`: probe 없이 25ms DOM polling만 사용
- `observe`: 검증된 POPULATED가 polling wait를 깨우고 최대 250ms 동안 10ms burst 허용
- `empty_exit`: POPULATED wake에 더해 current `EXACT EMPTY`가 현재 cycle을 조기 종료
- MutationObserver는 현재 generation·시각 계측 전용이며 제어 wake가 아님
- 최종 클릭 소유권은 항상 `SlotAdapter.clickSlot()` 하나에만 있음

3신호 구조 탭은 설계 후보이며 아직 구현되지 않았다.

- XHR POPULATED, narrow MutationObserver, 25ms polling이 하나의 coordinator에 scan 요청
- callback과 XHR handler는 직접 슬롯을 클릭하지 않음
- single-flight scan과 single-click claim으로 중복 실행 방지
- probe나 observer 실패 시 polling fallback 유지
- `EXACT EMPTY`는 3개의 양성 감지 신호가 아니라 별도의 음성 cycle 제어 신호

## 근거

- [Tier 2-2 Availability DOM wake-up 설계](../../../specs/open-timing-performance/02-availability-hot-path/20-design.md)
- [3신호 슬롯 감지 구조와 EXACT EMPTY 조기 종료](../../../specs/open-timing-performance/02-availability-hot-path/100-three-signal-and-empty-early-exit.md)
- [RT-14 EXACT EMPTY cycle 조기 종료](../../../specs/open-timing-performance/02-availability-hot-path/03-exact-empty-early-exit/00-index.md)

## 파일

- `index.html`: 문서 화면과 접근 가능한 컨트롤
- `styles.css`: 반응형 swimlane·상태 표현
- `app.js`: 시나리오, 연결선, 패킷 이동, 구성요소 설명
