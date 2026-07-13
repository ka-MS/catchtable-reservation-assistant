# HANDOFF

**갱신:** 2026-07-13
**브랜치:** `main`
**작업 로그:** `docs/worklog/2026-07-13-01-open-timing-spec.md`

## 현재 상태

에스콘디도 실오픈(7/13 9:00) 판독으로 **기준시계가 서버 풀 스큐에 락돼 ~1초 틀렸던 것**을 확정했다(서버가 늦게 연 게 아님). 이 진단을 바탕으로 **오픈 타이밍 성능 패키지(우산)**를 설계했고, **Tier 1(기준시계 신뢰성)의 구현 계획까지 문서화**했다. 코드 구현은 아직 시작 안 함.

- 스펙(전부 커밋): `docs/specs/open-timing-performance/`
  - `open-timing-performance-analysis.md` — 사고 전말·재현 레시피(§6)·거부한 대안(§7)·잔여 미지수(§8)·용어 계약(§9)
  - `01-reference-clock-reliability/` — `10-analysis` · `20-design`(구간 최대피복 estimator·타입·armLead) · `30-implementation`(6단계 TDD)
  - `02-availability-hot-path/`, `03-runtime-resilience/` — 개요만(미착수)
- 진단 근거: worklog 12·13, site-behavior §8·§8.1
- 직전 완료(main 병합됨): XHR 슬롯 감시(콰이어스+도착 버스트, 203 테스트 green). 이 감지 기계는 **진짜 프레임 기준 잘 작동**했고, 이번 사고의 원인은 오직 시계였다.

## 다음 작업 — Tier 1 구현 착수 (여기서부터 시작)

`docs/specs/open-timing-performance/01-reference-clock-reliability/30-implementation.md`의 6단계를 TDD로:

1. 구간 최대피복 estimator(순수) — 스큐 60%→LOW confidence가 핵심 테스트
2. 연속성 히스테리시스
3. Rolling 샘플러(대기 시간 저빈도 학습)
4. 오케스트레이터 통합(버스트 2회 제거·uncertainty 기반 armLead) — **고정 estimate 주입 시 기존 타이밍 테스트 무수정 통과가 폴백 가드**
5. 3-프레임 텔레메트리
6. E2E + 실오픈 검증 + 40/50 문서

착수 전 우산 analysis + Tier 1 20-design을 먼저 읽는다. 네이밍은 `ReferenceClock*`(`ServerClock` 금지). 클릭·감지·토글 산식·자동화 경계는 변경 금지(behavior-neutral, 진입 시점만 바뀜).

이후: Tier 2(availability 핫패스), Tier 3(런타임 견고성). 기타 후보: JSONL 내보내기.

## 검증

```bash
npm run check   # WSL: wsl.exe -d ubuntu -e bash -lc "cd ~/source/catchtable-reserve && npm run check"
git status --short --branch
```

단위·fixture 테스트 203개와 전체 자동 게이트가 통과한다(문서만 추가됨, 코드 무변경).
