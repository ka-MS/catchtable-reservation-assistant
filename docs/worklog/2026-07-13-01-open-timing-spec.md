# 2026-07-13-01 오픈 타이밍 성능 패키지 설계

## 개요

에스콘디도 실오픈(9:00) 판독에서 "서버가 슬롯을 1.3초 늦게 열었다"는 초기 해석이 오판임을 밝혔다. 실제 원인은 **기준시계가 서버 풀 스큐에 락돼 오프셋을 ~+1초 과대추정**한 것. 네이비즘 교차검증 + HEAD 오프셋 클러스터 측정으로 진짜 오프셋 ~0을 3중 확인했다.

## 산출물 (문서만, 코드 무변경)

- `docs/specs/open-timing-performance/` 우산 패키지 신설.
  - 우산 analysis: 사고 전말·실측 제약(P1~P4)·응답주도 원칙·3티어 근거·재현 레시피·거부한 대안·잔여 미지수·용어 계약.
  - Tier 1 `01-reference-clock-reliability`: 10-analysis, 20-design(구간 최대피복 estimator, `ReferenceClockEstimate` 타입, adaptive armLead, 3-프레임 로그), 30-implementation(6단계 TDD).
  - Tier 2/3: 개요 스텁.
- `docs/specs/README.md`에 우산+3티어 인덱스 추가.

## 핵심 설계 결정

- **응답 주도, 시계 보조.** 시계 ±1초 틀려도 슬롯 응답 전엔 클릭 안 함, 응답 오면 즉시 클릭.
- **버스트 → rolling 분산 샘플링 + 구간 최대피복.** 스큐 풀을 표본 창 편향으로 물지 않게. 모호하면 LOW confidence + 넓은 uncertainty(틀린 값 자신 있게 안 냄).
- **uncertainty 기반 adaptive armLead.** 시계 불확실할수록 감시를 일찍 시작(클릭은 앞당기지 않음).
- **ReferenceClock 네이밍.** app HEAD Date는 예약 서버 절대시각이 아님(CDN/프록시 가능).

## 다음

Tier 1 구현 착수(30-implementation 6단계). HANDOFF 참조. 이 세션은 토큰 소진으로 문서까지만; 구현은 다른 세션이 이어받는다.

## 검증

문서 추가만. `npm run check` 203 테스트 green 유지(코드 무변경).
