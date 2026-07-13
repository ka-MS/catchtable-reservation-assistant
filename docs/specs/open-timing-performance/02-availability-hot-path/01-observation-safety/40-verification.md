# Tier 2-1 — 검증

**상태:** 자동·live shadow 검증 완료.
**일자:** 2026-07-13

## 1. 자동 게이트

```bash
npm run check
```

- TypeScript 검사, 빌드, dist 독립성·import 검사 통과
- 228개 테스트 통과
- classifier, XHR 원본 의미 보존, bridge 검증, claim 단일성, control path 불변 테스트 포함

## 2. Chrome 환경

- 기존 사용자 Chrome 프로필에 Chrome DevTools MCP로 연결
- 확장 ID: `olbclnjiehfelpfmgmdphfmenapmpaal`
- 버전: `0.2.0`
- 로드 위치: 저장소의 `dist`
- 갱신 방식: 확장 상세의 `새로고침`
- 대상: `ishizue`, 예약일 2026-07-14, 2명

요청 body, cookie, 전체 response, 결제·사용자 정보는 조회하거나 저장하지 않았다. trace에는 날짜·인원·응답 status·가용 분 목록과 monotonic mark만 남겼다.

## 3. No-match live dry-run

- runId: `run-facf0639-14eb-49f5-8875-cd4fb48a2dbb`
- 시간 범위: 00:00~00:10
- 최종 상태: `TIMED_OUT` — 의도한 no-match 종료
- 저장: 24/24 events, seq 연속, dropped 0
- `AVAILABILITY_SHADOW`: 8건
- target 응답: `status=200`, `POPULATED`, `1110,1140`
- 토글로 취소된 인접 날짜 요청: `status=0`, `IRRELEVANT`

취소된 XHR을 payload 손상인 `UNPARSABLE`로 오분류하지 않으며 반복 토글 중에도 기존 timeout 제어 경로가 유지됐다.

## 4. Match live dry-run

- runId: `run-ef68aaa8-9633-4bd5-9261-13dec784f885`
- 시간 범위: 18:30~19:01, 우선 시간 18:30
- 최종 상태: `DRY_RUN_COMPLETED`
- 저장: 16/16 events, seq 연속, dropped 0
- body: `status=200`, `POPULATED`, 선택 후보 18:30
- DOM: 선택 후보 18:30
- agreement: `true`
- body 분류 선행: 79.4ms
- MAIN→ISOLATED bridge 지연: 29.2ms

Dry-run이므로 실제 슬롯 클릭·후속 예약 진행은 수행하지 않았다. shadow claim은 body였지만 기존 DOM 제어 결과와 종료 상태를 바꾸지 않았다.

## 5. 수명과 오류

- 종료 뒤 `XMLHttpRequest.prototype.send`는 probe wrapper가 아니었다.
- MAIN registry는 `implementationVersion=2`였다.
- Catchtable 페이지 Console error/warn은 없었다.
- 확장 reload 뒤 stale listener와 stale probe 구현 교체를 재검증했다.

## 6. 판정

**REDUCE**

body는 warm 실측에서 DOM보다 19.1~79.4ms 앞섰고 결과도 일치했다. 그러나 현재 안전한 actuator는 렌더된 슬롯 버튼뿐이다. 응답 기반 pre-DOM 클릭으로 승격하지 않고, 실제 오픈 empty→populated 표본을 더 수집한 뒤 MutationObserver 기반 DOM claim 가속만 검토한다.

실제 오픈 전이, 장시간 활성화, 더 많은 매장·테이블/메뉴 조합은 아직 검증하지 않았다.
