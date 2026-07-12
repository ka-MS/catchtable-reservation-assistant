# 네비게이션 파이프라인 분석

**작성:** 2026-07-11
**실측 근거:** `docs/analysis/site-behavior.md` §1.1, `docs/worklog/2026-07-11-05-entry-recon.md`

## 목표 계층

```
[최종 비전]  예약 요청 리스트 등록 → 오픈 시각에 자동 실행 → 결제/완료까지
              └ 결제 자동화는 ADR-005 안전 경계와 충돌 → 별도 ADR로만 개방
[이번 범위]  자동 준비 = URL 자동 이동 → 예약창 진입 → 날짜 선택 → 인원 선택
             (기존 오픈런 앞에 붙는 선택 구간, entryMode=auto 시 실행)
```

## 현재 구조

- `OpenRunOrchestrator`는 `CalendarPort`/`SlotPort`/`PostSlotPort` 인터페이스만 알고 DOM 셀렉터는 어댑터에 격리된다. 이번 작업은 이 포트 패턴을 앞 단계(이동·진입·날짜)로 확장한다.
- background(`src/background/index.ts`)는 현재 활성 탭 URL이 설정 매장과 다르면 `sameRestaurant`로 실행을 거부한다. 이동 기능이 없다.
- 긴 대기(`WAITING_FOR_OPEN` 등)는 콘텐츠 스크립트가 담당한다.

## 실측으로 확정된 사실

- **예약창 진입은 완전 SPA다.** 매장 상세 하단 `aside#dock`의 `예약하기`(텍스트 판별, aria 없음) 클릭 → `history.replaceState`로 `date=YYMMDD` 부착 → 같은 문서에 달력 모달. 풀 리로드 없음. 스시서정·돗가비누각·도량 4회 교차 확인.
- **진입 성공 판정은 시간이 아니라 관측이다.** 달력 셀 렌더까지 287~350ms로 편차가 있어 날짜 셀(`div[role="button"][aria-label*="월"]`) 출현 폴링으로 판정해야 한다.
- **인원 선택은 달력과 같은 모달이다**(기본 2명 자동선택). 별도 화면 진입은 필요 없지만 정확한 라디오 선택과 확인은 독립 실행 상태로 기록한다.
- **다른 달 이동도 안정 앵커가 있다.** 월 머리글 `YYYY년 M월`과 `Previous page`/`Next page` button으로 목표 월까지 한 달씩 이동할 수 있다. 전환 완료를 현재 월 텍스트 변화로 확인해야 하며 같은 버튼을 연속 클릭하면 안 된다.
- **가게별 변형이 실재한다.** 돗가비누각은 모달에 테이블 타입 필터, 도량은 홈 탭에 예약/웨이팅 세그먼트·날짜 칩 위젯이 내장(단 ARIA 없는 순수 DIV라 앵커 부적합). 세 경우 모두 dock `예약하기`는 동일하게 달력 모달을 열어 진입 자동화를 dock CTA로 통일할 수 있다.
- **예약 불가 매장 판별 신호:** 웨이팅 전용 매장(런던베이글뮤지엄 안국)은 dock에 `예약하기`가 없고 disabled `현장 웨이팅만 가능`만 있으며 검색 진입 URL에 `type=WAITING`이 붙는다.

## 확인된 제약

- **MV3 서비스워커 수명:** 오픈까지 수 시간 대기를 background에 두면 SW가 죽는다. 긴 대기는 콘텐츠 스크립트에 유지해야 한다.
- **Chrome DevTools MCP로 확장 UI를 판독할 수 있다:** 확장 관리 페이지 target을 `chrome-extension://<id>/sidepanel/sidepanel.html`로 이동하면 Side Panel 조작, 실행 로그 판독, 동일 origin의 IndexedDB 검증이 가능하다. 구체 절차는 `$use-chrome-devtools`와 `docs/testing/chrome-devtools-mcp-ai-guide.md`를 따른다.

## 안전 경계 (기존 유지)

- 예약 확정·약관·결제 자동 진행 금지, 폼에서 인계.
- 계정 상태 변경(웨이팅 등록, 예약 오픈 알림, 빈자리 알림) 클릭 금지.
- 진단·기록에 개인정보/입력값/전체 DOM 미포함.
