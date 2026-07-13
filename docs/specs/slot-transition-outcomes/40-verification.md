# 슬롯 클릭 전환 결과 검증

## 자동 검증

새 테스트는 다음 계약을 고정한다.

- 정상 경로: `SLOT_DETECTED -> SLOT_CLICK_DISPATCHED -> SLOT_TRANSITION_CONFIRMED`
- dispatch 전 후보 소실: `contention_before_dispatch` 후 슬롯 탐색 재개
- 클릭 뒤 unknown: 자동 클릭 없이 `unknown` 인계
- 클릭 뒤 5초 동안 waiting: `timed_out` 인계
- 후속 자동 진행 비활성: 알려진 화면을 한 번 확인한 뒤 추가 행동 없이 인계
- dry-run: 신규 dispatch·confirmed 상태와 과거 `SLOT_SELECTED`에 진입 불가
- dispatch 시각은 `slot_click_dispatched`로 표시하고 monotonic 경과·기준시계 스냅샷을 유지

```text
npm run check
TypeScript: PASS
Tests: 229/229 PASS
dist validation: PASS
module independence: PASS
git diff --check: PASS
```

## Chrome live 확인

2026-07-14 unpacked extension `0.2.0`을 `dist`에서 다시 로드했다.

- 확장 ID: `olbclnjiehfelpfmgmdphfmenapmpaal`
- 로드 위치: `\\wsl.localhost\Ubuntu\home\developer\source\catchtable-reserve\dist`
- 활성 상태와 service worker 재기동 확인
- 실제 실행 두 건은 야키토리묵 페이지의 중복 달력 상태 때문에 슬롯 단계 전 `HANDED_OFF`됨
  - `run-b44959c8-c1e7-4260-a298-316b0d30d134`: auto entry에서 달력 확인 실패
  - `run-912ba6b2-d855-4530-86ea-ce5515e9f23b`: prepared 검사에서 목표·인접 날짜 확인 실패
- 두 실패 모두 stage snapshot과 함께 안전 인계됐고 결제·약관·최종 예약 동작은 없었다.

같은 live 페이지에서 17:00 가시 슬롯을 수동으로 한 번 클릭해 알려진 후속 화면이 실제로 나타나는 것을 확인했다. 후속 화면은 테이블/카운터 메뉴 선택과 `취소`·`확인` 버튼을 포함했다. 즉 click dispatch 뒤 inspect 가능한 known 화면이 도착한다는 전제는 live DOM에서도 성립했다. 즉시 `취소`해 예약을 진행하지 않았다.

확장 오케스트레이터가 신규 두 상태를 실제 live 실행에서 연속 기록하는 positive 표본은 이번 페이지의 사전 준비 실패 때문에 확보하지 못했다. 이 제한은 자동 계약의 통과와 구분해 유지한다.

## 판정

RT-01의 상태·로그·timeout·unknown·dispatch 전 경합 계약은 자동 검증을 통과했다. live에서는 확장 재로드, 안전 실패 경로, 클릭 뒤 known 화면 출현을 확인했으며 좌석 hold는 주장하지 않는다.
