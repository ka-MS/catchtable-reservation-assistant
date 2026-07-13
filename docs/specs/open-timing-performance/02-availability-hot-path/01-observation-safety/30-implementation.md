# Tier 2-1 — 구현 계획

**워크플로우:** 분석 → 설계 → 구현 → 검증 → 적대적 리뷰·수정

**상태:** Task 1~6 완료. 자동 228개 테스트와 live dry-run 통과.

## Task 1. 분류기와 계약

- `src/shared/availability-shadow.ts`에 타입·정규화·분류기 추가
- empty/populated/malformed/mismatch/HHmm/상한 테스트
- 검증: 순수 단위 테스트 통과

## Task 2. MAIN XHR probe

- `src/main-world/availability-probe.ts` 추가
- XHR 원본 의미 보존, target endpoint만 관찰, redacted event 전송
- 중복 설치·명시 종료·만료 원복 테스트
- build에 별도 IIFE와 dist 검증 추가
- 검증: target/non-target/throw/restore 테스트와 번들 검사 통과

## Task 3. ISOLATED bridge

- channel/schema/크기 검증과 ACTIVATE/DEACTIVATE 구현
- malformed·wrong channel·stale event 테스트
- 검증: 유효 이벤트만 callback에 전달

## Task 4. Shadow observer 배선

- background best-effort MAIN 주입과 START channel 추가
- `ShadowClaimCoordinator` 구현
- RunSession에서 body trace와 DOM 비교 trace 추가
- control path 무변경 assertion 추가
- 검증: probe가 없어도 기존 테스트 무수정 통과, shadow 이벤트가 클릭 수·결과를 바꾸지 않음

## Task 5. 통합 검증

- `npm run check`
- dist extension reload 후 최소 빈 응답/가용 응답 live dry-run
- trace에 body/DOM agreement와 lead 기록 확인
- 종료 뒤 prototype 원복 확인

## Task 6. 적대적 리뷰

- 원문·개인정보 누출, spoofed message, 응답 역전, 중복 설치, wrapper 잔존, control path 결합을 검토
- 발견 사항을 `50-adversarial-review.md`에 기록하고 수정 후 전체 게이트 재실행

## 완료 산출물

- 검증: `40-verification.md`
- 적대적 리뷰: `50-adversarial-review.md`
- 작업 로그: `docs/worklog/2026-07-13-05-tier2-1-shadow-observation.md`
