# 재구축 결과 보고서

## 결과

재구축 전 구현은 `cb15c27`에 보존했고, 공식 문서와 오픈런 MVP 코드를 현재 저장소 안에서 독립적으로 다시 구성했다.

## 구현됨

- 예약 오픈 일시 중심 Side Panel
- 오픈+10분 감시 종료 기본값
- epoch ms 기반 설정과 시간 변환
- 서버 Date 헤더 다중 표본 시계 보정
- 명시적 상태 머신과 AbortSignal Scheduler
- 실측 Calendar/Slot Adapter
- 날짜 토글과 우선순위 슬롯 선택
- dry-run, 실제 슬롯 1회 클릭, 즉시 사용자 인계
- on-demand Content Script 단일 주입
- Background storage 이벤트 링버퍼·배지·알림

## 검증됨

- `npm run check` 통과
- 34개 단위·fixture·통합·회귀 테스트 통과
- dist 구조와 IIFE 검증 통과
- 외부 저장소 독립성 검증 통과
- 현재 실사이트 슬롯 선택자 읽기 전용 재확인
- Side Panel 정적 렌더링 확인

## 미완료 게이트

새 `dist/`의 Chrome 확장 재로드와 실제 사이트 dry-run은 Chrome 특수 페이지 자동 제어 제한으로 수행하지 못했다. `docs/verification/mvp-checklist.md`의 수동 항목을 완료하기 전에는 실사이트 MVP 완료로 선언하지 않는다.

## 2단계

오픈런 MVP 안정화 뒤 같은 Clock·StateEvent·SiteAdapter 경계를 사용해 30초 이상의 취소 자리 감시 모드를 추가할 수 있다. 인원 자동 설정과 슬롯 이후 단계는 후속 실측·spec·ADR을 거쳐 구현됐다.
