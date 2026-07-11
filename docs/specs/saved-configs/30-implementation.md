# 설정 히스토리·즐겨찾기 구현

## 구현 범위

1. `shared/saved-configs.ts`에 fingerprint, upsert, 삭제, 저장 데이터 정제를 순수 함수로 구현했다.
2. `background/saved-config-repository.ts`에 두 storage key의 읽기-수정-쓰기를 캡슐화했다.
3. Background가 유효한 START를 접수하면 히스토리를 자동 저장하고, 즐겨찾기·삭제 명령은 직렬 처리한다.
4. `sidepanel/saved-configs-view.ts`가 탭, 목록, 복원, 저장과 삭제 UI를 담당한다.
5. 폼 모델은 지난 시각도 보존하는 snapshot 변환과 실제 실행 검증을 분리했다.

## 핵심 제약

- 히스토리 저장 실패는 예약 실행을 중단하지 않는다.
- 히스토리 storage 쓰기는 예약 페이지 이동과 Content Script 시작을 기다리게 하지 않는다.
- 손상된 저장 데이터는 렌더링 전에 폐기하고 fingerprint는 현재 규칙으로 다시 계산한다.
- 저장 설정 복원은 폼만 변경하며 자동 실행하지 않는다.
