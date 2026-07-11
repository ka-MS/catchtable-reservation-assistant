# HANDOFF

**갱신:** 2026-07-11  
**브랜치:** `main`
**작업 로그:** `docs/worklog/2026-07-11-04-post-slot-resilience.md`

## 현재 상태

후속 dialog 판별을 안전한 구조 snapshot과 `exact | supported | unknown` 전략으로 강화했다. 정확 aria-label 경로는 유지하고, 라벨이 바뀐 경우 제목과 단계 고유 control 구조가 함께 맞을 때만 지원 화면으로 판별한다. 행동 직전에 kind와 fingerprint를 재검증하며 hidden control과 stale inspection은 클릭하지 않는다. unknown 화면은 입력값이나 전체 HTML 없이 제목·버튼·control 개수·strategy·fingerprint를 실행 기록에 남기고 사용자에게 인계한다.

## 다음 작업

1. `chrome://extensions`에서 확장 카드를 새로고침한다.
2. 기존 정확 라벨 식당에서 테이블·메뉴·추가 상품·예약금 흐름이 유지되는지 확인한다.
3. 새로운 unknown 화면이 나오면 실행 기록의 제목·버튼·control 정보를 fixture로 이관한다.

## 검증

```bash
npm test
git status --short --branch
```

실행 기록은 밀리초까지 표시하며 시간 슬롯 클릭 성공과 예약 폼 최초 관측 시 서버 보정 시각과 오픈 대비 지연을 함께 표시한다. 후속 단계는 정확 라벨과 제한된 제목+구조 fallback, 메뉴 `다음/확인`, 추가 상품 무선택 진행, 예약금 안내 `확인`, 전환 중 일괄 비활성 대기, 최신 visible dialog 우선 판정을 지원한다. 현재 전체 코드 기준 `npm run check`: 78 tests pass + dist/independence pass.
