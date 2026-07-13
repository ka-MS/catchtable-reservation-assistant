# Tier 3 — 런타임 견고성 분석 (개요)

**상태:** 미착수. Tier 1·2 이후 착수하며, 실패 시나리오 목록을 근거로 채운다.
**우산 분석:** `../open-timing-performance-analysis.md` §4 Tier 3.

## 범위 (개요)

- **탭·창 관리:** 오픈 직전 예약 탭 활성화 + 창 포커스. 배경 탭 타이머 스로틀(Chrome 88+, 체인 타이머 ~1s+)로 마지막 몇 초 고빈도 감시가 묶이는 것을 방지. `visibilitychange`로 임계 구간 hidden 감지 시 focus 요청·degraded 표시.
- **Service Worker 재시작 reconcile:** SW가 30초 유휴로 종료됐다 재기동될 때 런 상태 복구. `chrome.alarms`(최소 30초, 지연 가능)는 정밀 실행이 아니라 조기 기동 스케줄러로만.
- **페이지 새로고침 재주입:** 런 중 새로고침 시 Content Script 재주입·재학습.
- **실패 주입 테스트 스위트.**

## 실패 시나리오 (테스트 대상 초안)

```text
표본 60%가 +1000ms 스큐 클러스터에 몰림
두 클러스터 50:50 (모호 → LOW confidence)
RTT 급증 (100ms → 800ms)
응답 순서 역전 (늦은 empty가 populated 뒤 도착)
HTTP Date가 1초 단위로 반복 (경계 미교차)
런 도중 로컬 Date.now 2초 변경 (단조 시계로 흡수 확인)
탭이 hidden으로 전환
페이지 새로고침
Service Worker 종료 후 재기동
populated 응답 3개 연속 도착 (claim guard 1회 보장 — Tier 2 연계)
예약 클릭 직후 DOM 재렌더링
```

## 최상위 불변식 (전 티어 공통 재확인)

```text
시계가 ±1초 틀려도 슬롯 응답 전에는 예약 실행하지 않는다.
슬롯 응답이 오면 시계가 틀려도 즉시 실행한다.
```
