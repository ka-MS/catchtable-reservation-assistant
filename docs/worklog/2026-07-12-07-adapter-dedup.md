# 2026-07-12 어댑터 DOM 중복 제거 (D)

## 배경

entry/calendar/person/post-slot/snapshot 어댑터에 보이는 요소 조회, disabled 판정, 안전 텍스트, FNV 해시가 중복돼 있었다. entry와 snapshot은 post-slot-inspection의 화면 파인더를 가져와 어댑터 간 교차 의존도 생겼다.

## 수행

- `adapter/dom.ts`에 리프 헬퍼 `visibleAll`, `isDisabled`, `safeText`, `fnvHash`를 추가했다.
- `adapter/dialog.ts`를 만들고 dialog·승인제 시트·범용 presentation 시트·홍보 닫기 버튼 파인더를 이동했다.
- post-slot inspection의 로컬 보이는 요소·텍스트·정규화·해시 구현을 공통 헬퍼로 교체했다.
- entry/calendar/person/post-slot/snapshot을 공통 DOM·dialog 모듈로 전환했다.
- entry와 snapshot의 post-slot-inspection import를 제거했다.
- `slots.ts`의 busy/duplicate 전용 필터와 calendar 날짜 셀의 `aria-disabled`·`aria-pressed` 의미 판정은 의도적으로 유지했다.

## 동작 보존 근거

- FNV-1a 고정값 3개를 테스트로 잠갔다. post-slot은 `ps-`, snapshot은 숫자 정규화 후 `ss-` 접두사를 기존 호출부에서 그대로 적용한다.
- `visibleAll`·`isDisabled`·`safeText`를 fixture로 검증했다.
- 기존 어댑터 fixture와 오케스트레이터 테스트를 수정하지 않고 통과했다.
- 단계마다 전체 게이트를 실행해 파인더 이동과 소비자 전환을 분리 검증했다.

## 검증

- 전체 185개 테스트 통과.
- strict typecheck, dist 검증, 외부 저장소 독립성, `git diff --check` 통과.
- content bundle은 작업 전 86.6KB에서 84.8KB로 감소했다.
- `0x811c9dc5`, `function isDisabled`, `slice(0, 80)` 인라인 중복은 `dom.ts` 외부에서 제거됐다.
- entry·snapshot에서 `post-slot-inspection` import가 사라졌다.

## 다음 작업

- 실제 확장 재로드 후 예약창 진입·날짜 준비·후속 선택 정상 실행 1회 확인.
- 이후 후보: XHR 응답 기반 슬롯 감지 조사, 실행 상세 로그 JSONL 내보내기.
