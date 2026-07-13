# Tier 2-1 — 적대적 리뷰·수정

**상태:** 완료. 미해결 고위험 finding 없음.
**일자:** 2026-07-13

## 1. 발견·수정

### A1. 관찰 코드가 원본 `send()`를 막을 수 있음 — 수정

listener 등록이나 내부 준비가 throw하면 사이트 XHR 호출 자체가 중단될 수 있었다. 관찰 준비를 격리하고 실패해도 원본 `send()`를 동일 인자·반환·예외 의미로 호출하도록 테스트를 추가했다.

### A2. 긴 만료 시간이 브라우저 timer 상한을 넘음 — 수정

단일 큰 timeout 대신 안전한 최대 지연으로 재무장하도록 바꿨다. 명시 종료와 만료 모두 자기 wrapper일 때만 원복한다.

### A3. 취소된 XHR을 malformed payload로 오분류 — 수정

빠른 날짜 토글에서 인접 날짜 요청이 `status=0`으로 취소될 수 있다. `responseStatus`를 계약에 추가하고 비-2xx·status 0은 `IRRELEVANT`로 분리했다. live no-match run에서 반복 확인했다.

### A4. 확장 reload 뒤 MAIN listener가 stale 상태로 남음 — 수정

페이지 전역 probe가 남아 있어도 새 bundle 주입 때 message listener는 항상 교체한다. 새 channel의 ACTIVATE/DEACTIVATE가 현재 content와 연결되는지 live로 재검증했다.

### A5. listener만 교체하면 구 bundle probe를 재사용함 — 수정

이벤트에 새 `responseStatus`가 없어서 stale 구현 재사용을 발견했다. registry에 `implementationVersion`을 두고 버전 불일치 시 이전 probe를 비활성화한 뒤 새 구현으로 교체한다.

### A6. 중복·역전 body 이벤트가 최신 claim을 덮을 수 있음 — 수정

sequence가 직전 이하인 이벤트는 stale 처리하고 claim은 런당 최초 한 번만 허용한다. 날짜·인원 불일치도 control 후보에서 제외한다.

## 2. 불변식 재검토

- MAIN probe는 사이트가 만든 XHR만 관찰하고 새 요청을 만들지 않는다.
- 요청 body를 읽지 않고 지정 header 두 개와 redacted response 요약만 전달한다.
- bridge 입력은 source/schema/channel/type/범위를 검증한다.
- probe·bridge 실패와 shadow claim은 클릭·토글·deadline·상태 전이를 바꾸지 않는다.
- 종료 후 wrapper를 원복한다.

## 3. 잔여 위험

1. **실제 오픈 전이 미실측:** 현재 자료는 warm 토글이다. 실제 empty→populated 순간의 선행 시간·응답 역전은 별도 표본이 필요하다.
2. **이미 렌더된 warm DOM:** 재실행 시 기존 target 슬롯 DOM이 남아 있으면 body 응답 전에 DOM 경로가 종료될 수 있다. 기존 제어 동작이며 Tier 2-1에서 변경하지 않았다.
3. **사이트 계약 변경:** endpoint, header, response shape, XHR transport가 바뀌면 shadow 관찰이 중단될 수 있다. 실패 시 기존 DOM 경로는 유지된다.
4. **`postMessage` spoofing:** channel은 인증이 아니다. 2-2에서도 shadow body만으로 클릭하지 않고 DOM 재검증을 유지해야 한다.

## 4. 결론

shadow 관찰 자체의 위험은 기존 예약 경로와 분리됐고 자동·live 검증을 통과했다. 제어 활성화는 바로 GO하지 않고 **REDUCE**로 제한한다.
