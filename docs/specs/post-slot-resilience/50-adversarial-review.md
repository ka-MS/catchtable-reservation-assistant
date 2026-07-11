# 후속 화면 복원력 적대적 리뷰 기준

구현 후 다음 공격 사례를 검토하고 결과를 기록한다.

- 다른 dialog로 교체된 뒤 오래된 inspection으로 클릭 시도
- 제목만 같은 모호한 dialog
- hidden 복제 dialog와 최신 dialog의 충돌
- 모든 control이 disabled인 전환 상태
- 유료 메뉴·유료 예약금을 안전 단계로 오인
- 버튼 텍스트의 우연 일치
- 진단 정보의 개인정보 또는 과도한 DOM 유출
- fingerprint에 동적 입력값이 포함되어 불필요하게 변경되는 문제

높음 이상의 문제가 남으면 분석 또는 설계 단계로 돌아간다.

## 리뷰 결과

1. **높음, 수정 완료:** visible dialog 내부의 hidden 버튼과 control이 판별·행동 후보에 포함될 수 있었다. snapshot과 모든 행동 후보에서 hidden 요소를 제외했다.
2. **중간, 수정 완료:** 예약 폼의 숨겨진 `확인했어요` 버튼을 안내창으로 오인할 수 있었다. visible·enabled 조건을 추가했다.
3. **중간, 수정 완료:** 0원 예약금 radio의 설명형 라벨은 supported 판별 후 행동 단계에서 찾지 못했다. 필수 토큰 세 개를 모두 요구하는 제한된 matcher로 통일했다.
4. **중간, 수정 완료:** CSS로 숨겨진 조상 아래 control과 `aria-disabled` 진행 버튼이 행동 후보가 될 수 있었다. 조상 computed style과 native/ARIA disabled를 모두 검사한다.
5. **중간, 수정 완료:** hidden 상태로 남은 구형 checkbox가 visible 수량형 메뉴 분기를 가릴 수 있었다. control 유형 분기도 visible 요소만 사용한다.
6. **낮음, 수용:** 폼 프로모션은 dialog DOM이 미실측이므로 활성 `확인했어요` 정확 문구만 사용한다. 문구를 임의 확장하지 않는다.

입력값, body text, 전체 HTML은 diagnostics와 fingerprint에 포함되지 않는다. 유료 전용 예약금, unknown, 구조가 변경된 화면은 click 0회를 유지한다. 치명적·높음 미해결 문제는 없다.
