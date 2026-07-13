# Tier 1 — 기준시계 신뢰성 적대적 리뷰

## 검토 항목

- `stop()`이 진행 중인 HEAD 요청을 abort할 때 `start()`의 fire-and-forget 프라미스가 안전한가
- FALLBACK(표본 전무) 추정치가 armLead 계산에 "모른다"를 실제로 반영하는가
- 재앵커 단위(monotonic vs wall clock)가 섞이지 않는가
- 새 런이 이전 런의 누적 표본·앵커를 물려받지 않는가
- `referenceClock.stop()`이 정상 경로·조기 종료 경로 양쪽에서 중복 없이 호출되는가
- 롤링 업데이트가 정밀 토글 그리드 진입 이후에도 앵커를 흔드는가
- 히스테리시스가 진짜 오프셋 변화(장비 재부팅 등)를 영구히 막지는 않는가
- `findMaxCoverageCluster`의 O(n²) 스윕이 정밀 구간에 영향을 주는가

## 리뷰 결과

1. **높음, 수정 완료:** `sampleOnce`가 `TypeError`만 무해한 네트워크 실패로 취급했다. `stop()`이 in-flight fetch를 abort하면 실제로는 `AbortError`(DOMException)가 던져지는데, 이건 재throw돼 `start()`의 반환 프라미스가 reject한다. `stopReferenceClock()`은 토글 루프 진입 직전 **항상** 호출되고 그 순간 표본 요청이 in-flight일 확률이 매 런마다 존재하므로, 사실상 매 런 unhandled promise rejection이 발생하는 구조였다. `signal.aborted`를 에러 타입 검사보다 먼저 확인하도록 수정했다(`f8d11a9`). 기존 샘플러 단위 테스트(1~3단계)는 stop이 콜백 안에서 호출돼 fetch가 이미 완료된 뒤였기 때문에 이 경로를 덮지 못했다 — 새 테스트는 abort 이벤트에 반응하는 fake fetch로 "아직 진행 중인 요청"을 재현한다.
2. **높음, 수정 완료:** `FALLBACK_ESTIMATE`가 `confidence:"LOW"`이면서 `uncertaintyMs:0`이었다. armLead 산식(`base + uncertainty + p95Rtt`)이 uncertainty만 보므로, "시계를 전혀 모른다"는 신호가 산술적으로 완전히 무시되고 `armLead === preOpenLeadMs`(확신 있는 것과 동일하게 행동)가 됐다. 표본 0개는 offset을 추측할 근거가 전혀 없는 상태이므로 uncertainty가 커야 정직하다. 큰 상수(24h)로 바꿔 orchestrator의 `MAX_ARM_LEAD_MS`(30s) 상한이 실제 클램프를 결정하게 했다(`8e1917d`) — 도메인 임계값(얼마나 일찍 감시할지)을 공유 시계 모듈이 아니라 오케스트레이터가 쥐는 계층 분리를 유지한다.
3. **낮음, 방지 확인:** 재앵커는 반드시 `monotonicClock.now() + offsetCenterMs`를 쓴다(`applyReferenceClockEstimate` 단일 지점). `deps.clock`(wall)을 쓰는 코드 경로가 남아있지 않음을 grep으로 확인했다 — 이건 애초에 구현 단계에서 설계 문서(20-design §3)에 명시적으로 남긴 주의사항이라 리뷰에서 재확인만 했다.
4. **낮음, 방지 확인:** `Dependencies.referenceClock`을 `(config) => ReferenceClockPort` 팩토리로 설계해 `RunSession`마다(=`start()` 호출마다) 새 포트 인스턴스를 받는다. 이전 런의 표본 배열은 그 포트 인스턴스와 함께 가비지컬렉트되며 새 런에 섞이지 않는다.
5. **낮음, 방지 확인:** `stopReferenceClock()`이 `this.referenceClockPort = null`로 참조를 비우므로, `waitForOpen()`의 명시적 호출과 `execute()` finally의 안전망이 겹쳐도 실제 `stop()` 호출은 정확히 1회다(통합 테스트로 확인).
6. **낮음, 의도된 동작:** 롤링 업데이트는 `waitForOpen()`이 `stopReferenceClock()`을 호출하는 순간(토글 그리드 진입 직전)까지 앵커를 계속 갱신한다. 이는 "관측이 가능한 한 늦게까지 계속되어 진입 순간 가장 신선한 추정치를 쓴다"는 설계 의도(20-design §3)이며, 토글 그리드 진입 이후에는 앵커가 완전히 동결되므로 정밀 구간엔 영향이 없다.
7. **낮음, 수용:** 히스테리시스는 직전이 HIGH이고 새 다수 클러스터의 지지 차가 근소(<2×)할 때만 이전 클러스터를 유지한다. 진짜 오프셋 변화(예: 재부팅 후 다른 서버 풀로 라우팅)가 일어나도 새 표본들이 쌓이며 다수가 되는 순간(지지 차 ≥2×) 정상 갱신되므로 영구 고착은 없다 — 단위 테스트("strong majority evidence overrides a HIGH prior")로 확인.
8. **낮음, 수용:** `findMaxCoverageCluster`는 표본 수(최대 64, 링버퍼 상한)의 제곱에 비례하지만 이는 대기 시간 중 ~1.75초 주기로만 실행되고 정밀 토글 루프와는 완전히 분리된 시점이다. 실측 없이도 무시 가능한 수준(64²=4096회 비교, JS 엔진에서 수 ms 이내)으로 판단해 별도 벤치마크는 만들지 않았다 — 실오픈 E2E에서 대기 구간 CPU 사용이 체감되면 재검토.

## 미해결

E2E 검증 미완료(40-verification 참고) — 이 리뷰는 코드·단위 테스트 레벨이며, 실측 스큐 패턴에서의 실제 armLead·confidence 거동은 다음 실오픈에서 확인해야 확정된다.
