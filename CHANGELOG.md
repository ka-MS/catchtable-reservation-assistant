# Changelog

## [1.1.3](https://github.com/ka-MS/catchtable-reservation-assistant/compare/v1.1.2...v1.1.3) (2026-08-07)


### Bug Fixes

* 관측 실패가 예약 실행을 중단시키지 않도록 통일 (SP-026) ([#22](https://github.com/ka-MS/catchtable-reservation-assistant/issues/22)) ([0d2463a](https://github.com/ka-MS/catchtable-reservation-assistant/commit/0d2463ad67dba5f602d9db1d69828633076ec16b))
* 흐름 cleanup 실패가 커널 정리와 flush를 막지 않도록 ([#28](https://github.com/ka-MS/catchtable-reservation-assistant/issues/28)) ([7c97ab1](https://github.com/ka-MS/catchtable-reservation-assistant/commit/7c97ab125e0c7b22eecb25e226e02d75c1392e90)), closes [#27](https://github.com/ka-MS/catchtable-reservation-assistant/issues/27)


### Code Refactoring

* orchestrator 관측 분리 (SP-025/01) ([#21](https://github.com/ka-MS/catchtable-reservation-assistant/issues/21)) ([13027bf](https://github.com/ka-MS/catchtable-reservation-assistant/commit/13027bf155c9a8a7bc188e840dcb15cc1226d186)), closes [#20](https://github.com/ka-MS/catchtable-reservation-assistant/issues/20)
* 오픈런 핫패스 전략 추출 (SP-025/03) ([#30](https://github.com/ka-MS/catchtable-reservation-assistant/issues/30)) ([95f3319](https://github.com/ka-MS/catchtable-reservation-assistant/commit/95f3319ce5c6c96044239098fe5f2598db329c7d))
* 커널·흐름 경계 (SP-025/02) ([#25](https://github.com/ka-MS/catchtable-reservation-assistant/issues/25)) ([ae992c5](https://github.com/ka-MS/catchtable-reservation-assistant/commit/ae992c55e18b1cc7d65889609cacae1acc0385d3))

## [1.1.2](https://github.com/ka-MS/catchtable-reservation-assistant/compare/v1.1.1...v1.1.2) (2026-08-06)


### Bug Fixes

* form_ready에 필수 입력 기본 답변 설정 여부 기록 ([#18](https://github.com/ka-MS/catchtable-reservation-assistant/issues/18)) ([76fab18](https://github.com/ka-MS/catchtable-reservation-assistant/commit/76fab180c92307e44caba9969100bdf0e076c052))
* 예약 폼·완료 화면 문구 변형 대응과 실패 근거 관측 ([#16](https://github.com/ka-MS/catchtable-reservation-assistant/issues/16)) ([413f9d1](https://github.com/ka-MS/catchtable-reservation-assistant/commit/413f9d1f46c976698d8b0fafdc4d3073468ca0f6))

## [1.1.1](https://github.com/ka-MS/catchtable-reserve/compare/v1.1.0...v1.1.1) (2026-08-05)


### Bug Fixes

* 애플리케이션 명칭을 Reservation Assistant로 수정 ([#14](https://github.com/ka-MS/catchtable-reserve/issues/14)) ([1f99586](https://github.com/ka-MS/catchtable-reserve/commit/1f9958602b1dc9696aeab5b84267564a19614a03))

## [1.1.0](https://github.com/ka-MS/catchtable-reserve/compare/v1.0.1...v1.1.0) (2026-08-05)


### Features

* Side Panel 온보딩 투어 추가 ([#12](https://github.com/ka-MS/catchtable-reserve/issues/12)) ([8c4ab8f](https://github.com/ka-MS/catchtable-reserve/commit/8c4ab8f91abd53366213343136a7c3580b02440c))

## [1.0.1](https://github.com/ka-MS/catchtable-reserve/compare/v1.0.0...v1.0.1) (2026-08-02)


### Bug Fixes

* 릴리스 워크플로의 빈 PR 출력 처리 ([65118f3](https://github.com/ka-MS/catchtable-reserve/commit/65118f32d11d5c879018f16a22c4dbf47e49b30a))

## [1.0.0](https://github.com/ka-MS/catchtable-reserve/compare/v0.2.0...v1.0.0) (2026-08-02)


### Features

* 자동 릴리스 프로세스 추가 ([f17349e](https://github.com/ka-MS/catchtable-reserve/commit/f17349e9f1e4d4f3fcdf03fcc37c0877781ebc9b))
