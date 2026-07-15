# RT-14 적대적 리뷰

## 결론

기본값 `off`와 기존 polling fallback을 보존하는 조건으로 구현을 수용한다. 실오픈 성능 이득과 요청 증가량은 아직 입증되지 않았으므로 기본 활성화는 승인하지 않는다.

## 공격 시나리오와 방어

| 시나리오 | 결과 |
|---|---|
| 이전 cycle EMPTY가 늦게 도착 | active cycle 불일치로 거부 |
| 같은 cycle의 오래된 sequence | stale/duplicate 검사로 거부 |
| marker 없는 `STRONG EMPTY` | `EXACT`가 아니므로 거부 |
| EMPTY와 슬롯 DOM 동시 관측 | DOM scan이 먼저 실행되어 후보 승리 |
| 최초 scan 직후 guard 사이에 슬롯 렌더 | guard 직후 최종 DOM scan에서 후보 승리 |
| 목표 날짜 selected 해제 | EMPTY 폐기, 기존 fallback 계속 |
| trace 또는 probe 오류 | 예외 격리, 기존 DOM 경로 유지 |
| stop/timeout 인접 EMPTY | 기존 deadline이 우선 |
| 구버전 저장값 | legacy `true`는 observe, 누락/false는 off |

## 리뷰 중 수정한 결함

초기 구현은 DOM scan 뒤 목표 날짜 선택을 재확인하고 즉시 EMPTY를 적용했다. 두 동작 사이에 슬롯이 렌더되면 다음 날짜 토글이 새 후보를 덮을 가능성이 있었다.

다음 순서로 수정했다.

```text
DOM scan
→ EXACT EMPTY 확인
→ 목표 날짜 selected 확인
→ 최종 DOM scan
→ 후보가 없을 때만 cycle 종료
```

해당 race를 재현하는 오케스트레이터 테스트를 추가했고 `finalDomCandidateFound=true`, `emptyEarlyExitApplied=false`, cycle 결과 `SLOT_FOUND`를 고정했다.

## 잔여 위험

1. 조기 종료는 다음 요청을 이론상 약 281ms 앞당기지만 서버 응답 위상 변화 때문에 실제 이득이 같다고 보장할 수 없다.
2. EMPTY가 빠른 환경에서는 요청 빈도가 증가할 수 있다. 실오픈에서 cycle 수와 요청 수를 함께 비교해야 한다.
3. `EXACT`의 안전성은 MAIN marker와 현재 correlation 구현에 의존한다. marker 계약이 바뀌면 재검토해야 한다.
4. 최소화·4분할·background throttling 환경은 이번 기능 검증 범위가 아니다.
5. Catchtable 서버 운영정책과 부하 제한을 우회하는 방식으로 cadence를 추가 축소하지 않는다.

## 운영 gate

- 정상 크기 전면 창
- 비중요 실제 오픈
- `EMPTY → EMPTY_EARLY_EXIT → 다음 target` trace 확보
- stale/inactive 오수용 0건
- DOM 후보 손실 0건
- 기존 설정 대비 cycle·요청 증가량 기록

이 gate를 통과하기 전 `empty_exit`은 사용자 명시 선택 기능으로만 유지한다.
