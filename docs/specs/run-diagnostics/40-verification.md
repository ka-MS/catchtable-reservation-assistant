# 실행 진단 검증

## 자동 검증

2026-07-15 기준 다음 게이트를 통과했다.

- `npm run check`: 296/296 tests
- TypeScript typecheck
- dist validation
- MAIN/ISOLATED independence validation
- 진단 대상 테스트: DOM 정제, recorder ring, runtime ACK/retry, IndexedDB migration, ZIP, side panel action

핵심 확인 결과:

- v1 DB의 기존 `runs`, `events`를 넣은 뒤 v2로 열어도 데이터가 유지되고 `snapshots`만 추가된다.
- snapshot put은 `snapshotId` 기준 idempotent이며 run 삭제 시 연결 snapshot도 삭제된다.
- 정상 예약 폼 인계는 snapshot 0개, 진단 실패는 최근 breadcrumb 3개와 failure 1개를 저장한다.
- 예약 폼 URL에서는 HTML fragment를 만들지 않는다.
- 대형 DOM fragment는 완전한 HTML로 끝나고 64KiB 이하이며 잘림 표시를 포함한다.
- `REFRESHING_SLOTS`, `SLOT_DETECTED`에서는 DOM 진단 캡처를 호출하지 않는다.
- ZIP 내부 JSONL은 error stack과 동적 이벤트 attributes를 손실 없이 보존한다.

## 표준 ZIP 검증

생성한 bundle을 Windows `Expand-Archive`로 해제해 다음 파일을 확인했다.

```text
manifest.json
run.csv
events.jsonl
dom-snapshots.jsonl
environment.json
fragments/ss-zip.html
```

## Chrome live 검증

- 확장 ID: `olbclnjiehfelpfmgmdphfmenapmpaal`
- 버전: `0.2.0`
- 갱신: `chrome://extensions`의 unpacked extension 새로고침
- load path: `\\wsl.localhost\Ubuntu\home\developer\source\catchtable-reserve\dist`
- Side Panel에서 `진단` 버튼 노출과 활성화를 확인했다.
- 실제 extension origin의 IndexedDB는 version 2, `runs 20`, `events 740`, `snapshots 0`이었다. 기존 데이터가 유지됐다.
- 기존 run `run-82ad48b6-b41f-480e-a085-eb5cf9c8d931`을 내려받아 Windows 기본 압축 해제로 열었다.
- bundle은 event 31개, snapshot 0개인 정상 과거 실행을 5개 기본 파일로 내보냈다.

과거 실행은 기능 배포 전에 생성돼 snapshot이 없는 것이 정상이다. rich failure snapshot의 저장과 fragment 포함 ZIP은 migration/recorder/bundle 통합 테스트로 검증했다.
