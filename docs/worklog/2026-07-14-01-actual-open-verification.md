# 2026-07-14-01 실제 오픈 검증

## 목적

Tier 1 ReferenceClock과 Tier 2-1 availability shadow를 코드 변경 없이 실제 예약 오픈에서 검증한다.

## 증거

- 매장: 조광201 (`cho__kwang`)
- 오픈: 2026-07-14 00:00:00 KST
- 예약일: 2026-07-24, 2명, 18:30~21:00
- runId: `run-c5463a0b-ffe0-447b-a619-f9c545181ac0`
- 외부 화면 녹화: `녹음 2026-07-14 000157.mp4`, 23.17초
- 확장: `olbclnjiehfelpfmgmdphfmenapmpaal`, 0.2.0

요청 body, cookie, 전체 response와 결제·사용자 정보는 저장하거나 문서화하지 않았다.

## 저장 무결성

- finalState: `HANDED_OFF`
- events: 34/34
- seq: 1~34 연속
- dropped: 0
- first/last: `RUN_STARTED` / `RUN_TERMINATED`
- scheduled job: `finished`

## 실제 오픈 시간축

app 호스트 HEAD ReferenceClock 기준이며 감지 시점 품질은 MEDIUM, uncertainty 125ms, offset -44ms다.

| 단계 | 오픈 대비 |
|---|---:|
| 슬롯 갱신 진입 | -832ms |
| 오픈 전 target body EMPTY 분류 | 약 -553ms |
| 성공 target 날짜 클릭 | +854ms |
| 성공 XHR 발사 | 약 +906ms |
| target body POPULATED 분류 | 약 +956ms |
| DOM 20:00 후보 관측 | +1004ms |
| 20:00 슬롯 클릭 | +1011ms |
| 예약 폼 최초 도착 | +1835ms |
| 사용자 인계 이벤트 | +3353ms |

- body 후보와 DOM 후보는 20:00으로 일치했다.
- body가 DOM보다 47.7ms 선행했다.
- body 분류→클릭은 약 55ms, DOM 관측→클릭은 약 7ms였다.
- 화면 녹화에서 오픈 전 EMPTY, 날짜 토글, 슬롯 클릭, 0원 결제 안내와 사용자 인계를 확인했다.

## 시계 판독

- armed: LOW, uncertainty 약 500ms, offset -174ms, armLead 837ms
- detection: MEDIUM, uncertainty 125ms, offset -44ms
- offset 변화는 130ms이며 우려했던 약 1초 점프는 재현되지 않았다.
- NO_SLOT 3회 뒤 SLOT_FOUND로 전이했고 감지·클릭은 모두 양수 open delta였다.

## 새로 발견한 제한

cycle 2·3은 `PerformanceResourceTiming` arrival과 DOM `NO_SLOT`을 기록했지만 같은 목표 날짜·인원으로 검증된 body 이벤트가 없다. URL에 날짜가 없어 canceled 인접 요청도 `lastArrivalAt`을 갱신할 수 있으므로 resource arrival만으로 target 응답을 주장할 수 없다.

Tier 2-2는 target 날짜·인원이 검증된 body 이벤트로만 DOM 관측을 깨우고, MutationObserver 또는 즉시 스캔 뒤 기존 SlotAdapter로 재검증해야 한다. body 신호만으로 직접 클릭하지 않는다.

## 판정

- Tier 1 실제 오픈 검증: PASS
- Tier 2-1 실제 empty→populated 검증: PASS
- Tier 2-2 진입 판정: REDUCE 유지
- pre-DOM 직접 actuator: 근거 부족, 진행하지 않음

한 표본은 축소 설계 착수 근거로 충분하지만 통계적 성능 결론이나 DOM 폴백 제거 근거로는 부족하다.

## 자동 게이트

```bash
npm run check
```

TypeScript, build, 228 tests, dist validation, module independence가 모두 통과했다. 이번 작업은 문서만 변경했고 실행 코드는 변경하지 않았다.
