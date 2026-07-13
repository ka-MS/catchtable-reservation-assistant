# Tier 2 — Availability 핫패스 분석 (개요)

**상태:** 미착수. Tier 1(`../01-reference-clock-reliability/`) 실오픈 검증 후 세부 계측으로 필요성을 확정하고 채운다.
**우산 분석:** `../open-timing-performance-analysis.md` §4 Tier 2.

## 범위 (개요)

클릭 경로를 응답 body 직접 감지로 승격해 DOM 렌더 지연(실측 56~182ms)을 건너뛴다. 기존 `xhr-slot-watch` 패키지(도착 신호+DOM 스캔, worklog 13)의 연장선.

- **MAIN-world fetch/XHR 후킹**으로 응답 body의 빈→채워짐 전이를 직접 판정.
- 기존 PerformanceObserver 도착 감지·DOM 스캔은 폴백으로 유지(다중 감지기).
- **원자적 claim guard**(런당 OBSERVING→CLAIMING 1회) — 다중 감지기 도입으로 필수화. 현재 코드엔 중복 클릭 위험 없음(단일 루프).
- 응답 순서 역전·중복 populated 처리.

## 착수 전 확정할 것

Tier 1 배포 후 실오픈 3-프레임 로그에서 다음 구간을 쪼개 계측:

```text
response body 완료 → payload 파싱 → 전이 판정 → (world 전달) → 클릭 dispatch
```

world 간 전달 지연이 실제 병목인지 확인 후, MAIN-world actuator 즉시 클릭(초저지연 모드) 여부를 결정한다.

## 제약

- P1(우산 §2): availability 직접 호출 불가(암호화). 감지만 하고 트리거는 UI 토글이 유발한 사이트 자체 요청.
- MAIN-world 주입은 ADR-004(on-demand content) 및 사이트 간섭 위험과 함께 검토.
- 자동화 경계(예약 최종 제출·약관·알림 금지) 불변.

## 현재 코드 기준선 (Tier 1 완료 후, 2026-07-13 main 병합됨)

Tier 2가 얹힐 토대. 새 세션은 이걸 먼저 파악한다:

- **감지 파이프라인**: `src/content/adapter/slot-refresh-watch.ts`(PerformanceObserver로 `/dining/time-slots` 도착 신호, ISOLATED world), `orchestrator.ts`의 3-모드 감지(신호 없으면 그리드 폴백 / live+도착 전 콰이어스 700ms / 도착 후 버스트 250ms). worklog 12·13.
- **현재 감지 = "네트워크 도착 신호로 가속된 DOM 스캔"**(응답 body 직접 판정 아님). 불변식: 슬롯 DOM이 뜨기 전엔 클릭 안 함. → Tier 2가 body 직접 판정으로 승격.
- **기준시계**: `reference-clock-sampler.ts` + `estimateReferenceClock`(shared/clock.ts). SLOT_DETECTED/SLOT_SELECTED가 `monoFromRunStartMs`·`clockConfidence`·`clockUncertaintyMs`·`clockOffsetMs`·`arrivalToDetectMs`·`arrivalToClickMs`를 실음(Tier 2 지연 계측의 기반 프레임).
- **런 이벤트 전송**: `src/content/dispatch.ts`(`dispatchRunEvent`, 무효 컨텍스트 동기 throw 삼킴).
- **claim guard 아직 없음**: 현재는 단일 `searchAndReserve` 루프라 중복 클릭 위험 0. Tier 2에서 MAIN-world detector를 추가하면 다중 감지기가 되므로 그때 원자적 claim guard가 **필수**가 된다.

## 프로세스 (새 세션 주의)

Tier 2는 신규 창작 작업이므로 **brainstorming 스킬로 시작**한다(구현 전 설계 승인 게이트). 착수 순서: 우산 analysis 읽기 → 이 문서 읽기 → 실오픈 3-프레임 로그로 지연 구간 계측(위 "착수 전 확정할 것") → brainstorming → 20-design → 30-implementation(TDD). 네이밍·실측 원칙·behavior-neutral 가드는 Tier 1과 동일.
