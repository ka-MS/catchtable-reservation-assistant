# ADR-001: Chrome Manifest V3 확장

**상태:** 채택  
**일자:** 2026-07-10

## 결정

TypeScript strict, 순수 HTML/CSS, Chrome MV3 확장으로 구현한다. 런타임 UI 프레임워크는 사용하지 않는다.

## 근거

사용자의 로그인된 Chrome 세션과 DOM에 가장 가까운 위치에서 짧은 지연으로 반응할 수 있다. 외부 데스크톱 제어는 브라우저 IPC와 화면 인식 지연이 추가된다.

## 영향

Content Script 번들과 MV3 Service Worker 수명주기를 별도로 검증해야 한다.
