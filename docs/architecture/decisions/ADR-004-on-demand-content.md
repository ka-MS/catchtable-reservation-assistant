# ADR-004: Content Script on-demand 단일 주입

**상태:** 채택  
**일자:** 2026-07-10

## 결정

manifest 상시 주입을 사용하지 않는다. Background가 START 시 PING하고 응답이 없을 때만 Content Script를 주입한다.

## 근거

상시 주입과 동적 주입을 병용하면 동일 탭에 엔진이 둘 생겨 중복 클릭할 수 있다.

## 영향

manifest에 `scripting` 권한이 필요하고 Content Script에도 전역 주입 가드를 둔다.
