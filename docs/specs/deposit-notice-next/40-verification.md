# RT-06 예약금 안내 다음 버튼 검증

## 자동 검증

- exact `예약금 안내 + 이전/다음`에서 `다음`만 클릭
- supported 제목 구조의 `다음`을 `deposit_notice`로 분류하고 클릭
- 기존 exact `예약금 안내 + 이전/확인` 회귀 통과
- unknown dialog의 일반 `다음`은 unknown 유지, 클릭하지 않음
- 예약금 안내에 radio가 있으면 진행하지 않고 blocked
- disabled 진행 버튼과 fingerprint 변경 재검증 유지

```text
npm run check
TypeScript: PASS
Tests: 242/242 PASS
dist validation: PASS
module independence: PASS
git diff --check: PASS
```

## Chrome live 확인

2026-07-14 unpacked extension `0.2.0`을 새 dist로 다시 로드했다. 비스트로 꼬꼬뜨 `2026-07-31`, 2명, 18:00 흐름에서 다음 순서를 비최종으로 확인했다.

```text
테이블 타입 선택(홀)
-> 추가 상품(무선택 다음)
-> 예약금 안내
```

현재 live 예약금 안내는 `이전/확인`, 금액 20,000원 변형이었다. 과거 진단의 `이전/다음`, 금액 20,000원 변형과 제목·구조가 같고 진행 label만 다르다. 확인 버튼 이후로는 진행하지 않고 탭을 닫았다. 결제 수단, 약관, 최종 예약은 조작하지 않았다.

## 판정

현재 `확인` 변형을 보존하면서 수집된 `다음` 변형을 정확한 화면 범위에서 지원한다. RT-06 완료 조건을 충족한다.
