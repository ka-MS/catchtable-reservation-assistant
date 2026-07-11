# 후속 화면 복원력 검증 기준

## 자동 검증

- 정확 라벨 기반 기존 화면의 행동이 유지된다.
- `aria-label`이 바뀌어도 제목과 control 구조가 일치하면 `supported`로 판별한다.
- 제목만 우연히 일치하고 필수 구조가 없으면 자동 클릭하지 않는다.
- inspect 이후 dialog 구조가 바뀌면 클릭하지 않고 `waiting`을 반환한다.
- unknown은 URL 종류, 제한된 제목·버튼, control 개수와 fingerprint를 제공한다.
- 진단에 input value와 전체 HTML이 포함되지 않는다.
- hidden/stale dialog보다 최신 visible dialog를 우선한다.
- 유료 전용 예약금과 최종 예약은 클릭하지 않는다.

## 완료 게이트

```bash
npm run check
git diff --check
```

## 검증 결과

- 신규 핵심 테스트 3개를 기존 구현에서 실패시켰다: 라벨 변경 fallback, stale inspection 차단, unknown 안전 진단.
- 적대적 리뷰 테스트 6개를 추가했다: hidden control·CSS-hidden 조상 제외, hidden 폼 버튼 제외, `aria-disabled` 진행 차단, 0원 라벨 변화, Side Panel 진단 표시.
- 전체 자동 검증은 78 tests와 dist/independence 검사를 기준으로 수행한다.
