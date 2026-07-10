# 30. 구현 - Manifest V3 1차 확장 프로그램

**상태:** active  
**작성:** 2026-07-10  
**근거:** [20-design.md](20-design.md)

## 구현 파일

| 영역 | 파일 | 내용 |
| --- | --- | --- |
| 확장 정의 | `manifest.json` | MV3, Side Panel, `document_start` Content Script, Catchtable 호스트 권한 |
| 공유 계약 | `src/shared/types.ts` | 예약 조건, 상태, 메시지 타입 |
| 페이지 어댑터 | `src/content/adapter.ts` | 표시 슬롯·날짜/인원·테이블 타입·예약금 안내·사용자 인계 판별 |
| 자동화 엔진 | `src/content/engine.ts` | DOM 변이 감시, 단일 클릭, 조건부 전이, 재시도, 사용자 인계 |
| Content Script | `src/content/index.ts` | 시작·중지 명령 수신 |
| Service Worker | `src/background.ts` | Side Panel 명령 중계, 설정·상태 저장, 감시 탭 중지 |
| Side Panel | `src/sidepanel/*` | 조건 입력, 시작/중지, 상태 표시 |
| 도구 | `package.json`, `tsconfig.json`, `scripts/copy-static.mjs` | TypeScript 검사, Content Script IIFE 번들, 정적 파일 복사 |

## 구현된 동작

- `main button[aria-disabled]` 중 표시되고 `aria-disabled="false"`, `data-busy="false"`인 시간만 후보로 본다.
- 현재 URL의 식당 경로, `date`, `personCount`가 Side Panel 설정과 맞을 때만 클릭한다.
- 후보 발견부터 `click()` 호출까지 Content Script 안에서 동기 실행한다.
- 후보 슬롯, 테이블 타입 `다음`, 예약금 안내 `확인`은 DOM 노드 기준으로 한 번만 클릭한다.
- 테이블 타입 대화상자가 없으면 건너뛴다. 나타났을 때 선호가 없거나 선호 타입을 찾지 못하면 사용자 인계한다.
- 예약금 안내의 검증된 비최종 `확인`은 자동 진행한다.
- `자동결제로 예약하기` 또는 약관 UI를 발견하면 자동화를 멈추고 사용자 인계한다.
- 10초 내 다음 화면을 판별하지 못하면 250ms 후 재감시한다. 자동 새로고침과 반복 클릭은 하지 않는다.
- 감시 탭이 새로고침되면 Content Script의 `CONTENT_READY` 신호를 통해 같은 탭에만 저장된 조건을 다시 전달한다.
- 확장을 이미 열린 탭에 설치한 경우에는 `START` 메시지 실패 시 현재 감시 탭에만 Content Script를 즉시 주입하고 같은 명령을 재전달한다.

## 의도적으로 제외한 동작

- 날짜·인원 선택 UI 조작
- 로그인, CAPTCHA, 최종 약관 동의, 최종 예약·결제 클릭
- 쿠키, 비밀번호, 카드 정보의 읽기·저장
- 다중 탭 및 다중 식당 감시

## 빌드 결과

`npm run build`는 `dist/`에 Chrome에서 언패킹 로드할 수 있는 `manifest.json`, Service Worker, 단일 IIFE Content Script, Side Panel 정적 파일을 생성한다. Content Script는 Manifest V3의 일반 스크립트 로더가 ES module `import`를 해석하지 못하므로 번들 파일로 만든다. 실제 Chrome 개발자 모드 로드는 검증 단계에서 수행한다.
