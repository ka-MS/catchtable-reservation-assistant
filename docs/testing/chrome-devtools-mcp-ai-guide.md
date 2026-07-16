# Chrome DevTools MCP AI 운영 가이드

이 문서는 AI 에이전트가 Chrome DevTools MCP로 실제 Chrome과 `Catchtable Reserve Assistant`를 제어하고 E2E 검증하는 절차를 정의한다. 사용자용 설명서가 아니다. 도구 이름은 클라이언트마다 접두사가 달라도 Chrome DevTools MCP의 동일 기능을 뜻한다.

## 1. 환경과 대상

### MCP 설정

이 저장소는 WSL 경로에 있지만 Chrome은 Windows에서 실행한다. MCP도 Windows `cmd`를 통해 시작한다.

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "cmd",
      "args": [
        "/c",
        "npx",
        "-y",
        "chrome-devtools-mcp@latest",
        "--auto-connect"
      ],
      "env": {
        "SystemRoot": "C:\\Windows",
        "PROGRAMFILES": "C:\\Program Files"
      }
    }
  }
}
```

- `cmd /c`: Windows npm과 Chrome을 사용한다.
- `SystemRoot`: Windows 자식 프로세스 실행에 필요하다.
- `PROGRAMFILES`: MCP가 Windows Chrome 설치 위치를 찾게 한다.
- `--auto-connect`: 별도 게스트 브라우저 대신 사용자가 연 Chrome 프로필에 연결한다.

Chrome에서 `chrome://inspect/#remote-debugging`을 열고 `Allow remote debugging for this browser instance`를 활성화한다. 화면에 보통 `127.0.0.1:9222` 서버가 표시된다. 설정 변경 뒤에는 AI 클라이언트를 재시작한다.

### 확장 식별 정보

| 항목 | 값 |
|---|---|
| 이름 | `Catchtable Reserve Assistant` |
| 현재 manifest 버전 | `0.2.0` |
| 실측 확장 ID | `olbclnjiehfelpfmgmdphfmenapmpaal` |
| 관리 URL | `chrome://extensions/?id=olbclnjiehfelpfmgmdphfmenapmpaal` |
| Side Panel | `chrome-extension://olbclnjiehfelpfmgmdphfmenapmpaal/sidepanel/sidepanel.html` |
| 로드 디렉터리 | `\\wsl.localhost\Ubuntu\home\developer\source\catchtable-reserve\dist` |
| Telemetry DB | `catchtable-reserve-telemetry` |
| Object stores | `runs`, `events`, `snapshots` |

ID와 버전은 재설치나 manifest 변경으로 달라질 수 있다. 실행 전에 관리 화면과 `dist/manifest.json`을 우선 확인한다.

## 2. 연결과 target 선택

1. `list_pages`를 호출한다.
2. 사용자가 연 캐치테이블 탭이 보이면 기존 프로필 연결에 성공한 것이다.
3. `about:blank`만 보이면 `--auto-connect`, 원격 디버깅 체크박스, Windows `cmd` 실행 여부를 확인한다.
4. 작업마다 URL과 제목으로 target을 다시 선택한다. 현재 선택 상태를 추측하지 않는다.
5. 화면 구조는 screenshot보다 `take_snapshot`을 우선 사용한다. snapshot이 반환한 UID는 해당 화면에서만 유효하다.

화면 이동, 폼 입력, 확장 업데이트, 리렌더 뒤에는 항상 새 snapshot을 얻는다. 과거 UID를 재사용하지 않는다.

## 3. 확장 빌드와 갱신

코드 변경 뒤 기본 순서는 다음과 같다.

1. 저장소에서 `npm run check`를 실행한다.
2. `chrome://extensions/?id=<id>`를 연다.
3. snapshot에서 이름, ID, 버전, 활성 상태, 로드 위치를 확인한다.
4. 목적에 따라 다음 중 하나를 누른다.
   - 상단 `업데이트`: Chrome 전체 확장의 업데이트 확인을 실행한다.
   - 확장 상세의 `새로고침`: 해당 unpacked 확장만 `dist`에서 다시 로드한다.
5. `업데이트 중…` 표시가 사라지는지 확인한다.
6. 확장 이름, 활성 상태, 버전, 서비스 워커가 다시 표시되는지 확인한다.
7. 갱신 전의 Side Panel/서비스 워커 target과 UID는 폐기하고 다시 연결한다.

`click` 성공만으로 갱신 완료를 판정하지 않는다. 상태 표시와 재로드된 확장 정보로 판정한다. `wait_for("오류")`처럼 일반적인 단어는 `오류 수집` UI에 오탐될 수 있으므로 사용하지 않는다.

## 4. 확장 Side Panel에 접근

Side Panel과 서비스 워커는 `list_pages`에 나타나지 않을 수 있다. 다음 우회를 기본으로 사용한다.

1. 확장 관리 URL을 연다.
2. snapshot에서 `서비스 워커`와 `sidepanel/sidepanel.html` inspected view를 확인한다.
3. 현재 관리 페이지 target을 다음 URL로 `navigate_page` 한다.

```text
chrome-extension://<extension-id>/sidepanel/sidepanel.html
```

4. `evaluate_script`로 실제 컨텍스트를 확인한다.

```js
() => ({
  href: location.href,
  origin: location.origin,
  title: document.title,
})
```

5. `take_snapshot`으로 `CATCHTABLE RESERVE`, `작업`, `예약 설정`, `실행 로그` UI가 보이는지 확인한다.

확장 URL은 `new_page`가 성공 메시지를 반환해도 page list에 노출되지 않을 수 있다. 기존 target의 `navigate_page`를 우선한다. page list에 이전 `chrome://extensions` 제목이 남아 있어도 `location.href`가 확장 URL이면 전환된 것이다.

## 5. Side Panel 조작 규칙

- 화면 구조를 읽은 뒤 최신 UID로 클릭한다.
- 여러 입력은 `fill_form`, 하나의 입력은 `fill`을 사용한다.
- datetime 값은 `YYYY-MM-DDTHH:mm`, date 값은 `YYYY-MM-DD` 형식으로 입력한다.
- 클릭 또는 입력 뒤 snapshot에서 실제 value와 요약 영역을 확인한다.
- 저장 뒤 폼 화면이 아니라 작업 목록에서 최종 값을 재확인한다.

### 새 예약 작업 만들기

1. `작업` 탭에서 `+ 새 예약`을 누른다.
2. 다음 필드를 채운다.
   - 식당 예약 URL
   - 예약 오픈 일시
   - 감시 종료 시각
   - 예약 날짜
   - 예약 인원
   - 희망 시간 범위와 선택 옵션
3. UI가 오픈 일시 변경에 맞춰 감시 종료 시각을 자동 조정할 수 있으므로 입력 후 다시 읽는다.
4. `실행 요약`을 확인한다.
5. `예약 저장`을 누른다.
6. 작업 목록에서 식당 slug, 날짜, 인원, 오픈 시각, 상태를 확인한다.

### 즐겨찾기 저장

즐겨찾기와 예약 작업 저장은 서로 다른 작업이다.

1. 폼 하단 `최근 설정` disclosure를 연다.
2. `즐겨찾기` 탭을 누른다.
3. `현재 설정 저장`을 누른다.
4. 즐겨찾기 개수와 새 항목의 식당·날짜·인원을 확인한다.
5. 작업도 등록해야 한다면 별도로 `예약 저장`을 누른다.

### 스케줄러 동작

- 미래 오픈 시각의 작업은 `예정`으로 저장된다.
- 오픈 시각은 지났지만 감시 종료 시각이 남아 있으면 저장 직후 스케줄러가 실행할 수 있다.
- 감시 종료 시각도 지났으면 저장이 거부된다.
- `예약 저장` 후 실행 화면으로 전환되었다면 현재 단계와 로그를 확인한다.
- `지금 시작`은 오픈 시각과 별개로 즉시 실행한다.
- 실행은 `실행 중지`로 중단하고 `STOPPED` 상태와 종료 이벤트를 확인할 수 있다.

## 6. UI 로그 확인

1. `실행 로그` 탭을 연다.
2. 실행 선택 combobox에서 대상 식당, 예약 날짜, 시작 시각이 맞는 run을 고른다.
3. 간이 로그와 `상세 추적`을 함께 읽는다.
4. 다음을 기록한다.
   - 현재 상태와 최종 상태
   - 이벤트 시각
   - 상태 전환
   - 수행한 action
   - 시계 보정 결과
   - 날짜 토글과 슬롯 탐색 결과
5. UI가 최근 100행 등 일부만 렌더링할 수 있으므로 전체 검증은 IndexedDB와 대조한다.

웹페이지 또는 확장 document의 런타임 오류는 `list_console_messages`로 확인한다. 특정 메시지의 stack과 context가 필요할 때만 상세 메시지를 읽는다. 네트워크 검증은 `list_network_requests`에서 실패 요청을 찾고 필요한 request만 상세 조회한다.

## 7. 확장 IndexedDB 확인

IndexedDB는 origin별로 격리된다. `https://app.catchtable.co.kr`에서 조회하면 확장 DB가 아니라 사이트와 분석 SDK의 DB만 보인다. 반드시 `chrome-extension://<id>` Side Panel 컨텍스트에서 실행한다.

### DB와 store별 개수·스키마

```js
async () => {
  const databases = await indexedDB.databases();
  const result = [];

  for (const info of databases) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(info.name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    const stores = [];
    for (const name of Array.from(db.objectStoreNames)) {
      const tx = db.transaction(name, "readonly");
      const store = tx.objectStore(name);
      const count = await new Promise((resolve, reject) => {
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const samples = await new Promise((resolve, reject) => {
        const request = store.getAll(null, 3);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      stores.push({
        name,
        count,
        keyPath: store.keyPath,
        autoIncrement: store.autoIncrement,
        indexes: Array.from(store.indexNames).map((indexName) => {
          const index = store.index(indexName);
          return { name: indexName, keyPath: index.keyPath, unique: index.unique };
        }),
        fields: samples.map((value) => Object.keys(value ?? {})),
        samples,
      });
    }

    result.push({ name: db.name, version: db.version, stores });
    db.close();
  }

  return { origin: location.origin, databases: result };
}
```

현재 telemetry schema의 핵심은 다음과 같다.

- `runs`: keyPath `runId`, index `startedAt`
- `events`: compound keyPath `[runId, seq]`, index `runId`
- `snapshots`: keyPath `snapshotId`, index `runId`; 예기치 않은 실패의 저빈도 DOM 진단

### run과 event 대조

대상 `runId`에 대해 다음을 검증한다.

- `runs.eventCount`와 실제 `events` 개수
- `events.seq`의 1부터 마지막까지 연속성
- `runs.droppedCount`
- `runs.finalState`
- 최초 `RUN_STARTED`와 마지막 terminal event
- `code`, `severity`, `component`별 개수
- `localAt`, `serverAt` 순서와 UI 로그 시각

서비스 워커 target을 직접 선택하지 못해도 Side Panel과 서비스 워커가 같은 `chrome-extension://<id>` origin을 공유하므로 동일 DB를 조회할 수 있다.

## 8. E2E 기본 루프

코드 변경 검증에는 다음 루프를 사용한다.

1. 변경의 관찰 가능한 성공 조건을 정한다.
2. `npm run check`를 통과시킨다.
3. 확장 상세 화면에서 해당 확장을 새로고침한다.
4. Side Panel target을 다시 연다.
5. 테스트용 설정을 입력하고 저장한다.
6. 미래 스케줄 또는 `지금 시작`으로 실행한다.
7. 캐치테이블 탭의 DOM, Console, Network와 확장 상태를 관측한다.
8. 실행 로그에서 상태 전환과 action을 확인한다.
9. IndexedDB에서 동일 `runId`의 run/event를 대조한다.
10. 성공 조건, 실제 상태, 로그 근거, DB 근거를 보고한다.

### 권장 회귀 시나리오

- 확장 새로고침 후 서비스 워커와 Side Panel 복구
- 새 작업 생성, 편집, 삭제, 완료 작업 표시
- 미래 작업의 `예정` 등록
- 유효 감시 구간의 지난 오픈 작업 즉시 실행
- 감시 종료 시각이 지난 작업의 validation
- 즐겨찾기 저장과 불러오기
- 사용자 중지와 `STOPPED` terminal event
- 예약 폼 인계와 `HANDED_OFF` terminal state
- 업데이트/새로고침 이후 예약 작업과 즐겨찾기 유지
- UI event 수와 IndexedDB event 수 일치
- Console error와 실패 network request 부재

## 9. 알려진 제약과 판정 기준

| 현상 | 대응 |
|---|---|
| Side Panel/worker가 page list에 없음 | 관리 페이지 target을 확장 Side Panel URL로 navigate |
| `new_page` 성공 후 확장 페이지가 안 보임 | 기존 target에 `navigate_page` 사용 |
| page list 제목이 이전 페이지로 남음 | `location.href`와 `origin`으로 판정 |
| 업데이트 후 도구 호출 실패 | page list부터 다시 조회하고 target 재선택 |
| 화면 전환 뒤 click 실패 | 새 snapshot의 UID 사용 |
| `wait_for`가 엉뚱한 요소에 매칭 | 구체적인 완료 문구 또는 상태 구조로 판정 |
| 사이트 origin에서 telemetry DB가 안 보임 | 확장 origin으로 이동 |
| 저장 뒤 바로 실행 화면으로 전환 | 스케줄러의 현재 감시 구간 여부 확인 |

## 10. 결과 보고

결과에는 다음을 포함한다.

- 사용한 Chrome profile 연결 여부
- 확장 ID, 버전, 갱신 방식
- 조작한 설정과 최종 작업 상태
- 실행한 E2E 단계
- UI 로그의 핵심 상태 전환
- Console/Network 결과
- IndexedDB의 runId, finalState, event count, dropped count
- 기대 결과와 실제 결과의 차이
