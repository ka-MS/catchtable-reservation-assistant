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
