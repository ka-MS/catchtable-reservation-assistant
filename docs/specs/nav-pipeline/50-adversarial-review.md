# 네비게이션 파이프라인 적대적 리뷰

**리뷰:** 2026-07-11

## 발견 및 수정

1. 탭 이동 중 중지 후 준비 상태가 되살아날 수 있음
   - pending run 취소 토큰과 navigation/injection 전후 storage 재검증을 추가했다.
   - pending 중지는 Content 응답과 무관하게 Background가 `STOPPED`를 확정한다.
2. 매장 URL 끝 슬래시 차이로 동일 매장을 거부할 수 있음
   - 비교 시 루트 외 trailing slash를 정규화했다.
3. 월 전환 렌더 전에 같은 버튼을 재클릭할 수 있음
   - 표시 월 텍스트가 바뀔 때까지 `waiting`을 반환한다.
4. `예약하기` 텍스트가 예약 폼에도 존재할 수 있음
   - `aside#dock` 내부 정확 텍스트 버튼으로 범위를 제한하고 fixture로 외부 버튼 무클릭을 검증했다.
5. 목표 인원이 없을 때 첫 옵션으로 대체할 위험
   - 정확한 value가 없으면 즉시 인계하며 대체 선택을 금지했다.

## 잔여 위험

- Catchtable이 dock ID, 월 이동 aria-label, 인원 input name을 바꾸면 자동 준비는 안전 인계한다.
- 실제 확장 Side Panel과 Background 탭 이동 회귀는 새 dist를 Chrome에서 재로드한 뒤 사용자 주도 dry-run이 필요하다.
- 실제 오픈 순간과 슬롯 클릭은 자리 점유 위험 때문에 자동 실사이트 검증하지 않는다.
