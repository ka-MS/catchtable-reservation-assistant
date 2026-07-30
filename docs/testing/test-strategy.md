# 테스트 전략

## 원칙

- 실측되지 않은 DOM 가정을 fixture로 정당화하지 않는다.
- Site Adapter fixture는 출처와 관측 변형을 가진다.
- shared 정책과 상태 전이는 Chrome·DOM 없이 단위 테스트한다.
- dry-run, 폼 도착 호환성, 예약 완주 검증을 서로 다른 위험
  단계로 분리한다.
- 결제·최종 제출 변경은 자동 테스트만으로 완료하지 않는다.
- 결과 불명, 중복 제출과 credential 유출을 성공 경로보다 먼저
  공격한다.

## 자동 테스트

### 순수 로직

- 설정 정규화·검증과 로컬 시간 변환
- 슬롯 시간 범위·우선순위와 논리 중복 방지
- 서버 Date 표본, ReferenceClock과 토글 계획
- 상태 전이와 terminal 불변식
- saved config, scheduled job과 fingerprint
- 준비 사실 분류, bounded policy와 LogicalRun 전이
- attempt ACK replay·conflict·stale 판정
- outer/PIN durable claim 순서와 stop 경쟁

### Fixture 통합

- 예약 CTA, 달력 월·날짜, 정확한 인원 선택
- hidden·duplicate 슬롯 제거와 click 직전 재검증
- 테이블, 메뉴, 추가 상품, 예약금·결제 방식 변형
- unknown·전환 중·stale fingerprint의 click 0회
- 예약 폼 필수 입력·필수 약관과 선택 약관 보존
- 매장·날짜·시간·인원·금액 변경 시 submit 0회
- CatchPay/일반결제 판정과 PIN surface 변형
- outer/PIN claim별 dispatch 최대 1회
- 성공 path·문구·방문예정 세 조건이 모두 있어야 `COMPLETED`
- 예약 폼·PIN 진단의 credential redaction

### Background·UI·telemetry

- on-demand injection과 중복 START 거부
- 예약 작업 저장·복구·충돌·알람 실행
- RESET_PAGE와 service worker reconcile
- terminal 효과의 멱등성
- Port batch, ACK, durable flush와 IndexedDB 저장
- Side Panel 설정 복원·초기화·버튼 실행 중 비활성화
- PIN 즉시 비움과 config·storage·trace key 부재
- 실행 이력, CSV와 진단 ZIP 정제

## 빌드 회귀

- Manifest V3이며 `content_scripts`가 없다.
- 필요한 manifest 권한과 배포 파일이 존재한다.
- Content IIFE에 정적 import가 남지 않는다.
- MAIN·ISOLATED bundle 경계가 독립적이다.
- raw PIN 상수·secret key·민감한 진단 필드가 dist에 없다.
- Side Panel에 현재 설정·완주·작업·로그 control이 존재한다.
- 무기한 `PAUSED` 상태가 없다.

## Chrome 검증 단계

### Dry-run

슬롯 탐색·타이밍·중지·종료 검증은 dry-run으로 수행한다.

1. 확장 reload와 Side Panel 설정을 확인한다.
2. 목표 매장·날짜·인원과 오픈 시각을 설정한다.
3. 날짜 토글과 슬롯 후보 trace를 확인한다.
4. 슬롯 click 0회와 `DRY_RUN_COMPLETED`를 확인한다.
5. 중지·종료 뒤 새 DOM action이 없는지 확인한다.

### 실제 폼 도착

새 예약창·슬롯 이후 화면을 지원할 때는 통제된 actual 실행으로 목표
슬롯 click 1회와 알려진 후속 단계를 확인한다. 예약 완주 opt-in은
끄고 `/ct/reservation/form`의 `HANDED_OFF`까지 검증한다.

### 예약 완주

예약 폼·결제·제출 변경은 사용자가 승인한 매장·날짜·인원·금액 범위와
전용 Chrome 프로필에서만 검증한다.

1. 0원, 유료, 비로그인 대조 시나리오를 분리한다.
2. 유료 PIN은 Side Panel의 일회성 input으로만 입력한다.
3. outer/PIN claim·dispatch 횟수와 success 후조건을 대조한다.
4. Side Panel terminal, IndexedDB eventCount·seq·finalState를
   대조한다.
5. storage, telemetry와 diagnostic에 raw PIN이 없는지 확인한다.
6. 생성된 실제 예약의 취소는 사용자가 직접 수행한다.

실제 검증 계약과 최신 증거는
`docs/specs/catchpay-reservation-completion/40-verification.md`를
따른다.

## 완료 게이트

```bash
npm run typecheck
npm test
npm run check:dist
npm run check:independence
git diff --check
```

모든 자동 명령이 성공하고, 실사이트 동작 변경에는 해당 위험 단계의
Chrome 증거가 있어야 한다. 신규 화면은 fixture만으로 실제 호환성
완료를 선언하지 않는다.
