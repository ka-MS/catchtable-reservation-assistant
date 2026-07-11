# Catchtable Reserve

예약 오픈 시각에 Catchtable DINING 예약 슬롯을 빠르게 감지하고, 목표 슬롯을 한 번 클릭한 뒤 사용자에게 제어권을 넘기는 개인용 Chrome Manifest V3 확장 프로그램입니다.

## 현재 범위

- 단일 식당·단일 탭 오픈런
- 설정한 식당으로 자동 이동한 뒤 예약창·목표 월·날짜·인원 준비
- 예약 오픈 일시와 예약 희망 시간 분리
- 같은 오리진 서버 Date 헤더 기반 시계 보정
- 기본 T-3초부터 `인접 날짜 -> 목표 날짜` 토글
- 시간 우선순위와 허용 범위 적용
- dry-run 무클릭 감지
- 선택적으로 테이블·메뉴·추가 상품·예약금 안내·0원 결제 방법 진행
- 예약 폼 도착 시 `HANDED_OFF`
- 사용자 중지와 감시 종료 시각 강제 종료

로그인, CAPTCHA, 유료 예약금 선택, 약관, 결제, 최종 예약 확정은 자동화하지 않습니다.

## 요구 환경

- Chrome 120 이상
- Node.js 22 이상
- npm
- Catchtable에 로그인된 사용자 Chrome 세션

## 설치와 검증

```bash
npm ci
npm run check
```

`npm run check`는 strict typecheck, 전체 테스트, 배포 번들, 외부 저장소 독립성을 검증합니다.

Chrome에서 확장을 로드합니다.

1. `chrome://extensions`를 엽니다.
2. 개발자 모드를 켭니다.
3. `압축해제된 확장 프로그램을 로드합니다`를 선택합니다.
4. `/home/developer/source/catchtable-reserve/dist`를 선택합니다.
5. 소스 변경 후 `npm run build`를 실행하고 확장 카드의 새로고침 버튼을 누릅니다.

Windows 파일 선택기에서는 다음 경로를 사용할 수 있습니다.

```text
\\wsl.localhost\Ubuntu\home\developer\source\catchtable-reserve\dist
```

## 사용

1. 확장 아이콘을 눌러 Side Panel을 엽니다.
2. 식당 URL, 예약 오픈 일시, 예약 날짜·인원, 희망 시간, 우선순위, 감시 종료 시각을 설정합니다.
3. `자동으로 식당 이동·날짜·인원 준비` 또는 `현재 준비된 예약 모달 사용`을 선택합니다.
4. 후속 선택 자동 진행 여부와 테이블·메뉴 조건을 설정합니다.
5. 첫 실행은 `Dry-run`을 켠 상태로 검증합니다.
6. 실제 실행은 목표 슬롯을 한 번 클릭하고 허용된 후속 단계를 진행한 뒤 예약 폼에서 종료됩니다.

감시 종료 시각은 예약 오픈 일시를 입력하거나 변경할 때마다 항상 `+10분`으로 다시 계산됩니다. 더 길게 감시하려면 오픈 일시를 정한 뒤 감시 종료 시각을 마지막에 수정하세요.

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
├─ background/     탭, 주입, storage, 알림
├─ content/        오케스트레이터와 실측 Site Adapter
├─ shared/         설정, 시간, 시계, 상태 머신, 스케줄러
└─ sidepanel/      설정, 상태, 이벤트 UI
```

공식 요구사항과 미실측 영역은 [문서 인덱스](docs/README.md), 현재 검증 상태는 [MVP 체크리스트](docs/verification/mvp-checklist.md)를 확인합니다.

## 알려진 제한사항

- 자동 페이지 준비는 매장 상세 `/ct/shop/<slug>` URL만 지원합니다.
- 웨이팅 전용, 목표 날짜·인원 미지원, 유료 예약금 전용 또는 알 수 없는 화면에서는 사용자에게 인계합니다.
- 취소 자리 스나이핑은 2단계 확장점만 정의되어 있고 구현되지 않았습니다.
- 실제 사이트 슬롯 클릭은 예약 자리를 점유할 수 있으므로 자동 테스트하지 않습니다.
