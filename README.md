# Catchtable Reserve

예약 오픈 시각에 Catchtable DINING 예약 슬롯을 감지하고, 사용자가 허용한
범위에서 약관 동의·CatchPay 결제·최종 예약 확정까지 진행하는 개인용
Chrome Manifest V3 확장 프로그램입니다.

## 현재 범위

- 단일 식당·단일 탭·단일 예약 날짜 오픈런
- 식당 이동, 예약창 진입, 목표 월·날짜·인원 자동 준비
- 같은 오리진 서버 Date 헤더 기반 기준 시계
- 예약 오픈 전 날짜 토글과 목표 시간 슬롯 선택
- 무클릭 dry-run
- 테이블·메뉴·추가 상품·예약금 안내·결제 방식 처리
- opt-in 예약 완주: 필수 입력·필수 약관, CatchPay, 최종 제출
- 저장 설정, 즐겨찾기, 예약 작업과 `chrome.alarms` 자동 실행
- 실행 이력, CSV와 진단 ZIP

예약 완주는 기본적으로 꺼져 있습니다. 켜면 매장·날짜·시간·인원·
결제금액 상한과 CatchPay 선택 상태를 최종 제출 직전에 다시 확인하며,
실측된 성공 후조건을 모두 확인한 경우에만 `COMPLETED`로 종료합니다.
로그인, CAPTCHA·대기열, 일반결제, 실측되지 않은 화면과 결과 불명
상태에서는 자동 제출하거나 재시도하지 않고 사용자에게 인계합니다.

## 요구 환경

- Chrome 120 이상
- Node.js 22 이상
- npm
- Catchtable에 로그인된 Chrome 세션

## 설치와 검증

```bash
npm ci
npm run check
```

Chrome에서 `dist/`를 압축해제된 확장 프로그램으로 로드합니다.

1. `chrome://extensions`를 엽니다.
2. 개발자 모드를 켭니다.
3. `압축해제된 확장 프로그램을 로드합니다`를 선택합니다.
4. `/home/developer/source/catchtable-reserve/dist`를 선택합니다.
5. 소스 변경 뒤 `npm run build`를 실행하고 확장을 새로고침합니다.

Windows 파일 선택기에서는 다음 경로를 사용할 수 있습니다.

```text
\\wsl.localhost\Ubuntu\home\developer\source\catchtable-reserve\dist
```

## 사용

1. 확장 아이콘을 눌러 Side Panel을 엽니다.
2. 식당, 예약 오픈 일시, 예약 날짜·인원과 희망 시간을 설정합니다.
3. 자동 준비 또는 현재 준비된 예약 모달 사용을 선택합니다.
4. 후속 선택과 결제 방식 정책을 확인합니다.
5. 실제 실행 전에 dry-run으로 슬롯 탐색과 타이밍을 검증합니다.
6. 예약 완주가 필요하면 결제 상한과 필수 입력 기본 답변을 확인한 뒤
   완주를 명시적으로 켭니다.
7. 유료 CatchPay 완주는 해당 수동 실행에만 사용할 4자리 PIN을
   입력합니다. PIN은 저장 설정·작업·로그·진단에 저장되지 않습니다.
8. `지금 시작` 또는 저장한 예약 작업으로 실행하고 결과와 상세 추적을
   확인합니다.

감시 종료 시각은 예약 오픈 일시를 변경할 때마다 기본 `+10분`으로
계산됩니다. 더 길게 감시하려면 오픈 일시를 정한 뒤 종료 시각을
마지막에 수정하세요.

## 개발 명령

```bash
npm run build
npm run typecheck
npm test
npm run check:dist
npm run check:independence
npm run check
```

## 구조

```text
src/
├─ background/     탭·작업·실행 감독, storage, 알림, telemetry
├─ content/        오케스트레이터, 준비·슬롯·완주 coordinator와 Site Adapter
├─ main-world/     opt-in availability XHR probe
├─ shared/         설정, 시간, 상태 머신, 제어 평면 계약
└─ sidepanel/      설정, 작업, 상태, 실행 이력 UI
```

공식 기준은 [문서 인덱스](docs/README.md), 현재 체크포인트는
[HANDOFF](docs/worklog/HANDOFF.md), 예약 완주 검증은
[CatchPay 예약 완주 패키지](docs/specs/catchpay-reservation-completion/00-index.md)를
확인합니다.

## 알려진 제한사항

- 자동 페이지 준비는 매장 상세 `/ct/shop/<slug>` URL만 지원합니다.
- 로그인·CAPTCHA·대기열과 실측되지 않은 화면은 자동화하지 않습니다.
- 일반결제와 CatchPay 미등록 변형은 지원하지 않습니다.
- 유료 예약 작업은 PIN을 저장하지 않으므로 최종 제출 전에 인계합니다.
- 잘못된 PIN, 사용자가 닫은 PIN 화면과 결과 불명 상태를 자동
  재시도하지 않습니다.
- 취소 자리 감시와 자동 예약 취소는 구현되지 않았습니다.
- 실제 슬롯 클릭과 최종 제출은 자리 점유·예약금 결제를 일으킬 수
  있으므로 통제된 조건에서만 검증합니다.
