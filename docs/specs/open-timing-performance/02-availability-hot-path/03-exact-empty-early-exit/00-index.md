# RT-14 - EXACT EMPTY cycle 조기 종료

**상태:** PROMOTED - 분석·설계 완료, 구현 대기
**상위 설계:** [3신호 슬롯 감지 구조와 EXACT EMPTY 조기 종료](../100-three-signal-and-empty-early-exit.md)

## 목표

현재 active cycle의 신뢰된 `EXACT EMPTY` 응답이 도착하면 남은 bounded DOM 대기를 끝내고, 기존 `nextTogglePlan()`의 다음 합법적 grid에서 재시도한다.

3신호 구조와 MutationObserver 제어 연결은 범위 밖이다.

## 문서 인덱스

1. [분석](10-analysis.md)
2. [설계](20-design.md)
3. [구현 계획](30-implementation.md)
4. `40-verification.md` - 자동·Chrome 검증
5. `50-adversarial-review.md` - race·운영 위험 재검토
6. `60-live-verification.md` - 정상 크기 전면 실오픈 결과

## 단계 gate

- 분석: 재현 가능한 스크립트와 제외 기준 고정
- 설계: 안전 불변식과 설정 호환 계약 확정
- 구현: 기본값 off, 기존 probe/polling fallback 보존
- 검증: 전체 check와 Chrome UI/E2E
- 운영: probe-on 실제 오픈 검증 전 기본 활성 금지
