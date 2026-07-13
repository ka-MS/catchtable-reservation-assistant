# Tier 2-1 — 검증

**상태:** 자동·live shadow·실제 오픈 검증 완료.
**일자:** 2026-07-13~14

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

body는 warm 실측에서 DOM보다 19.1~79.4ms 앞섰고 결과도 일치했다. 그러나 현재 안전한 actuator는 렌더된 슬롯 버튼뿐이다. 응답 기반 pre-DOM 클릭으로 승격하지 않고 MutationObserver 기반 DOM claim 가속만 검토한다.

실제 오픈 1회는 아래와 같이 통과했다. 장시간 활성화, 더 많은 매장·테이블/메뉴 조합과 반복 표본은 아직 검증하지 않았다.

## 7. 실제 오픈 empty→populated 검증 (2026-07-14, 조광201)

### 실행 무결성

- runId: `run-c5463a0b-ffe0-447b-a619-f9c545181ac0`
- 설정: 오픈 2026-07-14 00:00:00 KST, 예약일 2026-07-24, 2명, 18:30~21:00, 실제 클릭
- 최종 상태: `HANDED_OFF`
- 저장: 34/34 events, seq 1~34 연속, dropped 0
- terminal: `RUN_TERMINATED`, 예약 폼 도착 뒤 사용자 인계
- 화면 녹화 23.17초로 오픈 전 EMPTY, 날짜 토글, 20:00 슬롯 클릭, 0원 결제 안내와 사용자 인계를 교차 확인했다.

### 실제 오픈 시간축

아래 오픈 델타는 app 호스트 `HEAD Date`를 `performance.now()`에 앵커링한 ReferenceClock 기준이다. 감지 시점 시계 품질은 `MEDIUM`, uncertainty 125ms, wall offset -44ms였다. body 분류 시각은 bridge 수신 시각에서 `bridgeDelayMs`를 뺀 값이다.

| 단계 | 오픈 대비 | 근거 |
|---|---:|---|
| 슬롯 갱신 진입 | -832ms | `REFRESHING_SLOTS` |
| 오픈 전 target body `EMPTY` 분류 | 약 -553ms | sequence 4, status 200 |
| 성공 cycle target 날짜 클릭 | +854ms | cycle 4 |
| 성공 XHR 발사 | 약 +906ms | `requestSentMonoMs` 변환 |
| target body `POPULATED` 분류 | 약 +956ms | sequence 8, status 200, `1080,1200` |
| DOM 후보 관측·일치 | +1004ms | 20:00, agreement true |
| 20:00 슬롯 클릭 | +1011ms | `clickOk=true` |
| 예약 폼 최초 도착 | +1835ms | terminal 진단의 `timingServerAtMs` |
| 사용자 인계 이벤트 기록 | +3353ms | `RUN_TERMINATED.serverAt` |

- body는 DOM보다 **47.7ms** 선행했다.
- body와 DOM은 모두 20:00을 선택해 agreement가 `true`였다.
- target body 분류부터 슬롯 클릭까지 약 55ms, DOM 관측부터 클릭까지 약 7ms였다.
- 실제 클릭이 +1011ms였지만, 최초 확인된 `POPULATED` body 자체가 약 +956ms에 도착했다. 이 한 표본에서 약 1초의 대부분을 확장 DOM 폴링 지연으로 해석하면 안 된다.

### 상관관계 제한 발견

cycle 2·3은 DOM 기준 `NO_SLOT`이고 `PerformanceResourceTiming` 기반 `arrivalAt`은 남았지만, 같은 cycle의 목표 날짜·인원으로 검증된 target body 이벤트는 없다. URL에 날짜가 없는 resource arrival은 취소된 인접 날짜 요청에도 갱신될 수 있으므로 target 응답 증거로 사용할 수 없다.

Tier 2-2에서는 다음 제약을 유지한다.

1. 날짜 불문 `lastArrivalAt`만으로 body claim 또는 클릭을 활성화하지 않는다.
2. target 날짜·인원이 검증된 body 이벤트만 DOM 관측을 깨우는 상관 신호 후보로 사용한다.
3. 실제 클릭은 좁은 MutationObserver 또는 즉시 스캔 뒤 기존 SlotAdapter로 DOM을 재검증한다.
4. body 이벤트가 없거나 bridge가 실패하면 기존 bounded DOM 경로로 폴백한다.

## 8. 실제 오픈 판정

**PASS / REDUCE 유지.** 실제 `EMPTY → POPULATED`, body/DOM 일치, 단일 슬롯 클릭과 안전한 사용자 인계를 확인했다. 이 표본은 Tier 2-2 축소 설계 착수 근거로 충분하지만, pre-DOM 직접 클릭 승격이나 통계적 성능 결론의 근거로는 부족하다.
