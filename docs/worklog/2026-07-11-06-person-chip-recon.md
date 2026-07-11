# 2026-07-11 인원 칩 실측 작업 로그

## 목적

이동모드의 `select_person` 단계 구현 가능성 확인. 기존 site-behavior §5는 "인원 칩에 안정 선택 속성 없음"으로 자동화 미지원이었다.

## 방법

catchtable-recon 워크플로 A. 도량·스시서정에서 `예약하기`로 모달을 연 뒤 인원 칩의 DOM을 leaf가 아니라 상위 컨테이너까지 파고들어 조사했다.

## 결과 (상세는 site-behavior §5.1)

- 기존 "속성 없음" 판단은 leaf span/`div[role=button]`만 본 오판이었다. 칩은 네이티브 라디오를 감싼 `label`이다.
- 안정 앵커: `input[type="radio"][name="personCount"][value="<N>"]`, 상태는 네이티브 `input.checked`.
- 모달 기본 선택은 `2명`. `personCount=2`는 무동작으로 충족.
- 도량에서 3명 선택 → 2명 복원까지 실측. label 클릭이 `checked`를 전환하고 URL에 `personCount=<N>`을 붙인다.
- 복제 노드 다수(도량 21+, 스시서정 80) — 슬롯과 같은 캐러셀 패턴이라 visible 스코핑 + value 중복 제거 필요.

## 설계 반영

`docs/specs/nav-pipeline/20-design.md` D3의 `select_person`을 "미결"에서 실측 완료로 갱신했다. 이동모드 4단계(navigate·enter·date·person) 모두 실측 근거를 확보했다.

## 안전 준수

인원 라디오 선택(파티 크기 변경, 가역)과 `예약하기`(모달 열기)만 클릭했다. 예약 확정·결제·알림 버튼은 건드리지 않았고, 인원은 원래값 2명으로 복원했다.
