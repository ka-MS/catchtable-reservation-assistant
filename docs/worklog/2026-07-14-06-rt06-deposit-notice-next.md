# 2026-07-14 RT-06 deposit notice next

## 목표

비스트로 꼬꼬뜨에서 관측된 `예약금 안내 + 이전/다음` 변형을 기존 안전 경계 안에서 지원한다.

## 수행

1. 분석·설계·TDD 계획을 `docs/specs/deposit-notice-next/`에 작성했다.
2. exact와 supported `다음` fixture, unknown 오탐 방지 테스트를 추가했다.
3. supported 진행 증거와 예약금 안내 action에 `다음`을 추가했다.
4. 적대적 리뷰에서 선택 control 오인 위험을 찾아 blocked guard를 추가했다.
5. 전체 자동 게이트와 비스트로 꼬꼬뜨 live 비최종 흐름을 확인했다.

## 결과

- `확인`과 `다음` 두 실측 변형을 지원한다.
- `이전`, unknown의 `다음`, 선택 control이 있는 안내는 클릭하지 않는다.
- 테스트 242/242 통과

## 다음 작업

별도 브랜치에서 RT-07 야키토리묵 신규 후속 단계의 저장 trace와 live 화면 증거를 조사한다.
