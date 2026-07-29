# Architecture

현재 실행 구조, 상태, 결정 기록과 시각화를 한곳에서 찾기 위한
아키텍처 인덱스다.

## 기준 문서

- [예약 자동화 아키텍처 개요](overview.md)
- [예약 실행 상태 머신](state-machine.md)

## 결정 기록

- [ADR-001: Chrome Manifest V3 확장](decisions/ADR-001-chrome-mv3.md)
- [ADR-002: 날짜 토글로 슬롯 갱신](decisions/ADR-002-date-toggle-refresh.md)
- [ADR-003: 서버 Date 헤더 기반 시계 보정](decisions/ADR-003-server-clock.md)
- [ADR-004: Content Script on-demand 단일 주입](decisions/ADR-004-on-demand-content.md)
- [ADR-005: 슬롯 클릭 직후 사용자 인계](decisions/ADR-005-slot-handoff.md)
  — 대체된 초기 MVP 결정
- [ADR-006: 명시적 진입 모드와 2층 내비게이션](decisions/ADR-006-entry-pipeline.md)

## 시각화

- [폴링 기준 하이브리드 슬롯 획득 파이프라인](visualizations/slot-acquisition-pipeline/README.md)

시각화는 기준 아키텍처를 설명하는 파생 모델이다. 현재 구현과 운영
기본값은 개요와 각 시각화가 연결한 현재 기준 문서를 따른다.
