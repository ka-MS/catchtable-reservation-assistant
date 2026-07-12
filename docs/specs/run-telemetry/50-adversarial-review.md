# 실행 텔레메트리 적대적 리뷰

## 검토 항목

- record 또는 flush가 정밀 클릭 전에 실행을 막는가
- Port 연결만으로 Service Worker 생존을 가정하는가
- ACK 전 이벤트를 삭제하는가
- 재전송이 중복 이벤트를 만드는가
- Background 메모리가 영속 원본이 되는가
- terminal event가 일반 trace overflow로 삭제되는가
- 저장 실패가 예약 실행을 실패시키는가
- URL query, DOM, 입력값, 결제정보가 유출되는가
- 실행 20건 정리 시 다른 run의 events가 남는가
- Side Panel이 batch마다 전체 목록을 다시 그리는가

구현 완료 후 발견 사항과 수정 결과를 이 문서에 기록한다.

## 리뷰 결과

1. **높음, 수정 완료:** 20건 도달 시 `record()`가 직접 Port를 호출할 수 있었다. 0ms timer로 batch flush를 예약해 슬롯 클릭 call stack과 분리했다.
2. **높음, 수정 완료:** Background가 만든 runId를 Content가 바꾸면 시작 실패와 실행 로그가 분리됐다. 동일 runId를 START 계약으로 전달한다.
3. **높음, 수정 완료:** 통일된 `run-` ID가 기존 `pending-` 중지 판정을 깨뜨렸다. pending은 `NAVIGATING | CONFIGURED` 상태로 판정한다.
4. **높음, 수정 완료:** terminal 기록과 마지막 batch가 동시에 seq를 계산할 수 있었다. 모든 Background trace 작업을 단일 직렬 큐로 통합했다.
5. **중간, 수정 완료:** 탭 종료·URL 이탈은 `activeRun`만 STOPPED가 되고 상세 run은 실행 중으로 남았다. Background terminal event를 추가했다.
6. **중간, 수정 완료:** 토글 대기·선택 확인 중 중지와 timeout이 부분 사이클을 잃었다. 종료 지점별 cycle result를 기록한다.
7. **중간, 수정 완료:** URL query와 과도한 stack·attribute 문자열 저장 가능성을 차단하고 테스트했다.
8. **낮음, 수용:** 브라우저나 탭이 강제 종료되면 ACK 전 최대 250ms batch가 손실될 수 있다. 일반 실행은 250ms 저장과 terminal 500ms flush를 사용한다.
9. **낮음, 수용:** 현재 상태·미니로그 호환을 위해 legacy `runEvents` dual-write가 남는다. 상세 이력과 고빈도 trace는 IndexedDB만 사용한다.

치명적·높음 미해결 문제는 없다.
