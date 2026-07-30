(() => {
  "use strict";

  const EMPTY_PAYLOAD = `GET /time-slots?date=TARGET\nHTTP 200\n{ "timeSlotMap": {} }`;
  const POPULATED_PAYLOAD = `GET /time-slots?date=TARGET\nHTTP 200\n{ "timeSlotMap": { "18:00": { "isAvailable": true } } }`;
  const IRRELEVANT_PAYLOAD = `GET /time-slots?date=ADJACENT\nHTTP 200\n{ "timeSlotMap": { "17:00": { "isAvailable": true } } }`;

  const nodeInfo = {
    "reference-clock": ["ReferenceClock", "Catchtable 응답의 Date 헤더를 performance.now()에 앵커링해, Windows 시계 변경에 흔들리지 않는 서버 기준 실행 시각을 제공합니다."],
    "toggle-plan": ["nextTogglePlan()", "오픈 시각과 토글 간격으로 다음 실행 가능한 grid를 계산합니다. EMPTY 조기 종료도 이 계획을 건너뛰지 않습니다."],
    "run-cycle": ["runToggleCycle(N)", "인접 날짜 이동부터 목표 날짜 복귀까지 한 cycle의 소유권을 갖고, 현재 cycle과 request marker를 관리합니다."],
    "adjacent-date": ["인접 날짜 클릭", "목표 날짜를 다시 선택할 수 있도록 다른 날짜로 이동합니다. 이 클릭도 Catchtable 요청과 렌더를 유발할 수 있습니다."],
    "target-date": ["목표 날짜 클릭", "예약 대상 날짜로 복귀하고 이번 요청을 cycle과 연결할 marker를 발행합니다."],
    "server-api": ["time-slots endpoint", "Catchtable 서버가 날짜와 인원 조건에 대한 슬롯 payload를 반환합니다. 확장 프로그램이 서버를 더 빠르게 만들 수는 없습니다."],
    "xhr-probe": ["XHR probe", "페이지 MAIN world에서 슬롯 응답 body를 EMPTY, POPULATED, IRRELEVANT로 분류합니다. 응답을 변경하거나 직접 클릭하지 않습니다."],
    "content-bridge": ["Content bridge", "MAIN world의 probe 결과를 content script 경계로 옮기고, 수신 시각과 허용된 필드만 전달합니다."],
    "correlation": ["cycle / request correlation", "응답이 현재 active cycle의 목표 날짜 요청인지 검사합니다. 오래된 응답이나 인접 날짜 응답은 wake 근거로 쓰지 않습니다."],
    "availability-wake": ["AvailabilityDomWake", "유효한 POPULATED는 DOM 탐색을 즉시 깨우고, 유효한 EXACT EMPTY는 empty_exit 모드에서 현재 cycle을 조기 종료합니다."],
    "app-renderer": ["Catchtable UI renderer", "서버 payload를 React 화면과 슬롯 DOM에 반영합니다. XHR 도착과 DOM 생성 사이에는 렌더 지연이 존재합니다."],
    "mutation-telemetry": ["MutationObserver (telemetry)", "현재 구현에서는 DOM 변경 시각을 측정하는 관측 전용입니다. 슬롯 탐색을 직접 실행하거나 클릭하지 않습니다."],
    "scan-loop": ["DOM scan loop", "기본 25ms 간격으로 SlotAdapter를 호출합니다. POPULATED wake를 받으면 최대 250ms 동안 10ms 집중 탐색으로 전환합니다."],
    "slot-dom": ["Slot DOM", "사용자가 실제로 볼 수 있고 클릭할 수 있는 슬롯 버튼 상태입니다. 서버 POPULATED만으로는 이 상태가 보장되지 않습니다."],
    "slot-adapter": ["SlotAdapter", "가시성, 시간 범위, 활성 상태를 기준으로 후보를 판정하고 클릭 직전에 논리 슬롯을 다시 조회하는 최종 권위입니다."],
    "click-claim": ["clickSlot()", "단 하나의 실행 경로만 최종 클릭 소유권을 획득합니다. 중복 클릭을 막고 예약 후속 단계로 넘깁니다."],
    "three-server": ["time-slots endpoint", "Catchtable 서버의 가용성 응답입니다. 제안 구조에서도 서버 응답 자체는 하나의 신호일 뿐 최종 클릭 권위가 아닙니다."],
    "three-xhr": ["Signal 1: XHR POPULATED", "서버가 슬롯을 반환했다는 강한 양의 신호입니다. 빠른 DOM scan을 요청하지만 직접 클릭하지 않습니다."],
    "three-renderer": ["Catchtable UI renderer", "응답을 화면 상태로 변환합니다. 서버 신호보다 늦을 수도 있고 MutationObserver보다 먼저 실행됩니다."],
    "three-mutation": ["Signal 2: Narrow MutationObserver", "예약 모달의 슬롯 영역만 관찰해 DOM 생성이나 교체를 즉시 알립니다. 단순 DOM 변경이므로 scan에서 실제 후보를 재검증해야 합니다."],
    "three-polling": ["Signal 3: 25ms polling", "XHR이나 observer가 누락되어도 계속 동작하는 독립 fallback입니다. 세 신호 중 가장 단순하지만 전체 성공률의 안전망입니다."],
    "three-coordinator": ["SlotDetectionCoordinator", "세 양의 신호를 한곳에서 병합하고 동시에 하나의 scan만 허용합니다. scan 중 들어온 신호는 최대 한 번의 후속 scan으로 합칩니다."],
    "three-scan": ["DOM scan", "신호 출처와 무관하게 동일한 SlotAdapter 읽기를 실행합니다. 신호가 슬롯 존재를 확정하는 것이 아니라 scan 결과가 후보를 확정합니다."],
    "three-slot-dom": ["Slot DOM", "Catchtable 렌더가 만든 실제 후보 상태입니다. observer, polling, XHR 모두 결국 이 상태를 읽어야 합니다."],
    "three-adapter": ["SlotAdapter", "현재 구조와 같은 최종 후보 판정기를 재사용합니다. 3신호 구조가 별도의 클릭 규칙을 만들지 않게 합니다."],
    "three-claim": ["single-click claim", "가장 먼저 유효 후보를 얻은 scan이 클릭 소유권을 획득하고, 나머지 pending 신호와 scan을 종료합니다."]
  };

  const componentRows = {
    current: [
      ["ReferenceClock", "확장 제어", "서버 기준 단조 시계", "계획 시각 계산", "현재"],
      ["nextTogglePlan()", "확장 제어", "다음 토글 grid 계산", "cycle 예약", "현재"],
      ["runToggleCycle(N)", "확장 제어", "인접 → 목표 이동과 cycle 소유", "DOM 클릭", "현재"],
      ["Catchtable renderer", "사이트 UI", "응답을 실제 화면으로 렌더", "Slot DOM 생성", "외부"],
      ["XHR probe + bridge", "관측 경계", "응답 분류와 안전한 전달", "wake 제안", "선택"],
      ["AvailabilityDomWake", "확장 제어", "상관 검증 후 wake / early exit", "scan 깨움", "선택"],
      ["DOM scan loop", "확장 제어", "25ms polling, 10ms burst", "후보 조회", "현재"],
      ["MutationObserver", "관측", "DOM 생성 시각 기록", "제어 없음", "계측만"],
      ["SlotAdapter + clickSlot", "사이트 어댑터", "최종 후보 재검증과 단일 클릭", "예약 단계 진입", "현재"]
    ],
    three: [
      ["XHR POPULATED", "신호 1", "서버 양의 신호", "scan 요청", "제안"],
      ["Narrow MutationObserver", "신호 2", "슬롯 영역 DOM 변경", "scan 요청", "제안"],
      ["25ms polling", "신호 3", "독립 fallback tick", "scan 요청", "유지"],
      ["SlotDetectionCoordinator", "조정자", "single-flight와 신호 병합", "scan 1회 실행", "제안"],
      ["DOM scan", "판정", "현재 DOM에서 후보 조회", "SlotAdapter 호출", "제안"],
      ["SlotAdapter", "사이트 어댑터", "유효 후보 최종 판정", "claim 요청", "재사용"],
      ["single-click claim", "소유권", "첫 성공자만 클릭 허용", "예약 단계 진입", "제안"],
      ["EXACT EMPTY", "음의 cycle 제어", "현재 cycle 조기 종료", "다음 grid 계획", "별도 경로"]
    ]
  };

  const invariants = {
    current: [
      "XHR 응답은 클릭 명령이 아니다. 반드시 correlation과 SlotAdapter 검증을 거친다.",
      "POPULATED는 서버에 슬롯 데이터가 있다는 뜻이며, 클릭 가능한 DOM이 이미 존재한다는 뜻은 아니다.",
      "EXACT EMPTY 조기 종료는 현재 cycle만 끝낸다. 다음 cycle은 nextTogglePlan()의 grid를 따른다.",
      "25ms polling은 probe가 꺼지거나 신호가 누락되어도 남는 최종 fallback이다.",
      "MutationObserver는 현재 telemetry 전용이다. 운영 제어 경로로 오해하면 안 된다.",
      "최종 클릭은 SlotAdapter 재조회와 단일 소유권을 통과한 한 경로만 수행한다."
    ],
    three: [
      "세 신호는 모두 scan 요청자일 뿐 직접 클릭할 수 없다.",
      "동시에 여러 신호가 와도 scan은 한 번만 실행하고, 실행 중 신호는 최대 한 번의 후속 scan으로 병합한다.",
      "MutationObserver는 좁은 슬롯 영역만 감시해 관련 없는 화면 변경의 헛탐지를 제한한다.",
      "폴링은 제거하지 않는다. XHR·observer 누락과 브라우저 변형에 대한 독립 안전망이다.",
      "EXACT EMPTY는 세 양의 감지 신호가 아니라 cycle 스케줄을 제어하는 별도 음의 신호다.",
      "후보 판정과 클릭 규칙은 기존 SlotAdapter와 single-click claim을 재사용한다."
    ]
  };

  const currentScenarios = [
    {
      id: "populated",
      name: "POPULATED wake · 10ms 집중 탐색",
      steps: [
        s("reference-clock", "toggle-plan", "서버 시각으로 다음 cycle을 계획합니다.", "performance.now 앵커를 기준으로 다음 합법적 토글 grid를 계산합니다.", "control", "계획", "없음", "대기"),
        s("toggle-plan", "run-cycle", "Cycle 3을 시작합니다.", "이번 cycle이 이후 목표 요청과 응답의 소유권 기준이 됩니다.", "control", "3 active", "없음", "cycle 시작"),
        s("run-cycle", "adjacent-date", "인접 날짜를 클릭합니다.", "목표 날짜를 다시 요청할 수 있도록 UI를 물리적으로 이동합니다.", "control", "3 active", "요청 예정", "인접 이동"),
        s("adjacent-date", "server-api", "인접 날짜 슬롯을 요청합니다.", "Catchtable 앱이 인접 날짜 요청을 서버에 보냅니다.", "network", "3 active", "pending", "서버 대기", IRRELEVANT_PAYLOAD),
        s("server-api", "app-renderer", "인접 날짜 응답을 렌더합니다.", "이 응답은 목표 요청이 아니므로 슬롯 wake 상관관계에서 제외됩니다.", "network", "3 active", "IRRELEVANT", "목표 복귀 준비", IRRELEVANT_PAYLOAD),
        s("run-cycle", "target-date", "목표 날짜로 복귀합니다.", "클릭 직전에 cycle 3의 target request marker를 발행합니다.", "control", "3 active", "요청 예정", "목표 이동"),
        s("target-date", "correlation", "Cycle 3 marker를 등록합니다.", "뒤이어 도착할 XHR을 현재 cycle의 목표 요청과 연결할 근거를 남깁니다.", "signal", "3 · request 65", "pending", "상관 준비"),
        s("target-date", "server-api", "목표 날짜 슬롯을 요청합니다.", "브라우저에서 Catchtable 서버로 실제 네트워크 요청이 이동합니다.", "network", "3 · request 65", "pending", "응답 대기", POPULATED_PAYLOAD),
        s("server-api", "xhr-probe", "서버가 POPULATED를 반환합니다.", "응답 body에 하나 이상의 시간 슬롯이 있습니다. 아직 DOM 클릭 가능 여부는 모릅니다.", "network", "3 · request 65", "POPULATED", "분류 중", POPULATED_PAYLOAD),
        s("xhr-probe", "content-bridge", "Probe가 POPULATED로 분류합니다.", "MAIN world에서 body를 안전하게 요약해 content script로 전달합니다.", "signal", "3 · request 65", "POPULATED", "bridge 수신"),
        s("content-bridge", "correlation", "현재 cycle 응답인지 검증합니다.", "cycle, request sequence, 목표 날짜가 일치해 EXACT 또는 STRONG으로 수락됩니다.", "signal", "3 · EXACT", "POPULATED", "wake 수락"),
        s("correlation", "availability-wake", "AvailabilityDomWake를 발행합니다.", "대기 중인 25ms sleep을 깨우고 짧은 집중 탐색을 허용합니다.", "signal", "3 · EXACT", "POPULATED", "10ms burst"),
        s("availability-wake", "scan-loop", "DOM 탐색을 즉시 깨웁니다.", "최대 250ms 동안 10ms 간격으로 후보를 찾습니다. 응답 신호가 직접 클릭하지는 않습니다.", "signal", "3 · EXACT", "POPULATED", "집중 탐색"),
        s("server-api", "app-renderer", "Catchtable이 응답을 화면에 반영합니다.", "네트워크 완료 뒤 사이트 렌더러가 슬롯 버튼을 생성합니다.", "network", "3 · EXACT", "POPULATED", "DOM 렌더", POPULATED_PAYLOAD),
        s("app-renderer", "mutation-telemetry", "DOM 변경 시각을 계측합니다.", "현재 MutationObserver는 진단 이벤트만 남기며 scan을 직접 제어하지 않습니다.", "telemetry", "3 · EXACT", "POPULATED", "계측만"),
        s("app-renderer", "slot-dom", "오후 6:00 슬롯 DOM이 생성됩니다.", "이제 실제 화면에 활성 슬롯 버튼이 존재합니다.", "control", "3 · EXACT", "POPULATED", "후보 생성"),
        s("scan-loop", "slot-dom", "집중 탐색이 후보를 읽습니다.", "다음 10ms tick에서 새 슬롯 DOM을 발견합니다.", "control", "3 · EXACT", "POPULATED", "후보 감지"),
        s("slot-dom", "slot-adapter", "예약 조건과 후보를 대조합니다.", "시간 범위, 활성 상태와 가시성을 확인하고 논리 슬롯을 선택합니다.", "control", "3 · EXACT", "POPULATED", "후보 확정"),
        s("slot-adapter", "click-claim", "단일 클릭 소유권을 획득합니다.", "클릭 직전 DOM을 재조회한 뒤 한 번만 클릭하고 후속 선택 단계로 이동합니다.", "control", "3 완료", "POPULATED", "슬롯 클릭")
      ]
    },
    {
      id: "empty",
      name: "EXACT EMPTY · cycle 조기 종료",
      steps: [
        s("reference-clock", "toggle-plan", "서버 시각으로 Cycle 4를 계획합니다.", "empty_exit 모드에서도 시작 시각은 동일한 grid를 사용합니다.", "control", "계획", "없음", "대기"),
        s("toggle-plan", "run-cycle", "Cycle 4를 시작합니다.", "인접 이동과 목표 복귀를 수행합니다.", "control", "4 active", "없음", "cycle 시작"),
        s("run-cycle", "adjacent-date", "인접 날짜로 이동합니다.", "목표 날짜의 슬롯을 새로 요청하기 위한 UI 이동입니다.", "control", "4 active", "없음", "인접 이동"),
        s("run-cycle", "target-date", "목표 날짜로 복귀합니다.", "Cycle 4 target marker와 함께 요청을 유발합니다.", "control", "4 active", "pending", "목표 이동"),
        s("target-date", "server-api", "목표 날짜 슬롯을 요청합니다.", "서버가 현재 가용성을 계산합니다.", "network", "4 · request 71", "pending", "응답 대기", EMPTY_PAYLOAD),
        s("server-api", "xhr-probe", "서버가 EMPTY를 반환합니다.", "현재 응답 payload에는 슬롯 항목이 없습니다.", "network", "4 · request 71", "EMPTY", "분류 중", EMPTY_PAYLOAD),
        s("xhr-probe", "content-bridge", "Probe가 EMPTY로 분류합니다.", "응답 요약이 content script로 이동합니다.", "signal", "4 · request 71", "EMPTY", "bridge 수신"),
        s("content-bridge", "correlation", "EXACT 상관관계를 확인합니다.", "현재 active cycle의 목표 요청과 정확히 일치합니다.", "signal", "4 · EXACT", "EMPTY", "early exit 허용"),
        s("correlation", "availability-wake", "EMPTY_EARLY_EXIT를 발행합니다.", "이 신호는 슬롯 클릭 신호가 아니라 현재 cycle의 불필요한 대기를 줄이는 음의 제어입니다.", "negative", "4 · EXACT", "EMPTY", "cycle 종료"),
        s("availability-wake", "run-cycle", "Cycle 4를 조기 종료합니다.", "후속 DOM polling을 중단하고 다음 계획 지점으로 돌아갑니다.", "negative", "4 종료", "EMPTY", "다음 grid"),
        s("run-cycle", "toggle-plan", "다음 합법적 grid를 계산합니다.", "즉시 무한 반복하지 않고 설정한 토글 간격을 보존합니다.", "control", "5 계획", "EMPTY", "재시도 대기")
      ]
    },
    {
      id: "fallback",
      name: "Probe off · 25ms polling fallback",
      steps: [
        s("reference-clock", "toggle-plan", "다음 cycle을 계획합니다.", "Probe가 꺼져도 토글 계획은 동일합니다.", "control", "계획", "미관측", "대기"),
        s("toggle-plan", "run-cycle", "Cycle 8을 시작합니다.", "UI 토글 경로만으로 슬롯 갱신을 유도합니다.", "control", "8 active", "미관측", "cycle 시작"),
        s("run-cycle", "adjacent-date", "인접 날짜를 클릭합니다.", "다른 날짜로 물리적으로 이동합니다.", "control", "8 active", "미관측", "인접 이동"),
        s("run-cycle", "target-date", "목표 날짜로 복귀합니다.", "Catchtable 요청과 렌더가 시작되지만 probe는 관측하지 않습니다.", "control", "8 active", "미관측", "목표 이동"),
        s("target-date", "server-api", "서버 요청이 진행됩니다.", "확장 프로그램은 응답 payload를 직접 보지 않습니다.", "network", "8 active", "미관측", "서버 처리", POPULATED_PAYLOAD),
        s("run-cycle", "scan-loop", "25ms polling을 계속합니다.", "응답 신호가 없어도 독립적으로 DOM 후보를 반복 조회합니다.", "control", "8 active", "미관측", "poll tick"),
        s("server-api", "app-renderer", "Catchtable이 슬롯을 렌더합니다.", "서버 응답이 사이트 내부 상태를 거쳐 DOM으로 반영됩니다.", "network", "8 active", "미관측", "DOM 렌더", POPULATED_PAYLOAD),
        s("app-renderer", "slot-dom", "슬롯 DOM이 생성됩니다.", "실제 화면에 예약 가능한 버튼이 생깁니다.", "control", "8 active", "미관측", "후보 생성"),
        s("scan-loop", "slot-dom", "다음 25ms tick에서 후보를 찾습니다.", "신호 가속 없이 폴링 간격만큼의 탐지 지연이 생길 수 있습니다.", "control", "8 active", "미관측", "후보 감지"),
        s("slot-dom", "slot-adapter", "후보를 최종 검증합니다.", "Probe 사용 여부와 무관하게 같은 SlotAdapter가 판정합니다.", "control", "8 active", "미관측", "후보 확정"),
        s("slot-adapter", "click-claim", "슬롯을 한 번 클릭합니다.", "폴링 fallback 경로도 동일한 단일 클릭 계약을 지킵니다.", "control", "8 완료", "미관측", "슬롯 클릭")
      ]
    },
    {
      id: "stale",
      name: "늦은 POPULATED · inactive cycle 거부",
      steps: [
        s("run-cycle", "target-date", "Cycle 3 목표 요청을 시작합니다.", "응답이 늦어지는 동안 cycle은 timeout grid를 따라 진행됩니다.", "control", "3 active", "pending", "응답 대기"),
        s("target-date", "server-api", "Cycle 3 요청이 서버로 이동합니다.", "네트워크 또는 서버 처리 지연이 발생합니다.", "network", "3 · request 65", "pending", "지연", POPULATED_PAYLOAD),
        s("toggle-plan", "run-cycle", "Cycle 4가 시작됩니다.", "Cycle 3은 더 이상 active가 아닙니다.", "control", "4 active", "pending", "다음 cycle"),
        s("server-api", "xhr-probe", "늦은 POPULATED가 도착합니다.", "Payload 자체는 POPULATED지만 소유 cycle이 이미 끝났습니다.", "network", "4 active", "POPULATED", "상관 검사", POPULATED_PAYLOAD),
        s("xhr-probe", "content-bridge", "Probe 결과를 전달합니다.", "수신 시각과 request sequence를 포함해 bridge로 보냅니다.", "signal", "response cycle 3", "POPULATED", "검증 중"),
        s("content-bridge", "correlation", "inactive cycle로 판정합니다.", "응답 cycle 3과 active cycle 4가 달라 wake를 거부합니다.", "negative", "4 active", "POPULATED · stale", "wake 거부"),
        s("run-cycle", "scan-loop", "기본 polling은 계속됩니다.", "오래된 XHR을 버려도 현재 화면의 DOM 탐색은 독립적으로 유지됩니다.", "control", "4 active", "stale 무시", "25ms polling")
      ]
    }
  ];

  const threeScenarios = [
    {
      id: "mutation-first",
      name: "MutationObserver 선착 · DOM 생성 우선",
      steps: [
        s("three-server", "three-renderer", "서버 응답을 Catchtable 앱이 받습니다.", "사이트 렌더러가 슬롯 영역을 갱신하기 시작합니다.", "network", "active", "POPULATED", "렌더 시작", POPULATED_PAYLOAD),
        s("three-renderer", "three-slot-dom", "슬롯 DOM이 먼저 생성됩니다.", "실제 후보 버튼이 화면 트리에 추가됩니다.", "control", "active", "POPULATED", "DOM 생성"),
        s("three-slot-dom", "three-mutation", "좁은 observer가 변경을 감지합니다.", "슬롯 컨테이너 변경만 관찰해 즉시 scan 요청을 만듭니다.", "signal", "active", "POPULATED", "mutation 신호"),
        s("three-mutation", "three-coordinator", "Mutation 신호를 coordinator에 제출합니다.", "신호 자체는 클릭 권한이 없고 단일 scan만 요청합니다.", "signal", "active", "POPULATED", "scan 요청"),
        s("three-coordinator", "three-scan", "Single-flight scan을 시작합니다.", "다른 신호가 동시에 도착해도 이 scan과 병렬 실행하지 않습니다.", "signal", "active", "POPULATED", "scan 실행"),
        s("three-scan", "three-slot-dom", "현재 DOM에서 후보를 읽습니다.", "이미 생성된 오후 6:00 슬롯을 발견합니다.", "control", "active", "POPULATED", "후보 감지"),
        s("three-slot-dom", "three-adapter", "SlotAdapter가 후보를 재검증합니다.", "시간, 활성, 가시성 조건을 최종 확인합니다.", "control", "active", "POPULATED", "후보 확정"),
        s("three-adapter", "three-claim", "첫 성공 scan이 click claim을 얻습니다.", "후속 XHR과 polling 신호는 종료 상태를 보고 추가 클릭하지 않습니다.", "control", "완료", "POPULATED", "슬롯 클릭"),
        s("three-server", "three-xhr", "늦은 XHR POPULATED가 도착합니다.", "이미 claim이 완료되어 coordinator가 새 scan을 만들지 않습니다.", "signal", "완료", "POPULATED", "완료 후 무시", POPULATED_PAYLOAD)
      ]
    },
    {
      id: "xhr-first",
      name: "XHR 선착 · 렌더 전 scan 후 observer 보강",
      steps: [
        s("three-server", "three-xhr", "XHR POPULATED가 먼저 도착합니다.", "서버에는 슬롯이 있지만 아직 DOM 렌더는 끝나지 않았습니다.", "network", "active", "POPULATED", "XHR 신호", POPULATED_PAYLOAD),
        s("three-xhr", "three-coordinator", "XHR 신호가 scan을 요청합니다.", "Coordinator가 즉시 single-flight scan을 엽니다.", "signal", "active", "POPULATED", "scan 요청"),
        s("three-coordinator", "three-scan", "첫 DOM scan을 실행합니다.", "렌더 전이라 후보가 없을 수 있으며 이는 정상입니다.", "signal", "active", "POPULATED", "scan 실행"),
        s("three-scan", "three-slot-dom", "첫 scan은 후보 없음으로 끝납니다.", "POPULATED가 DOM 존재를 보장하지 않는 이유입니다.", "negative", "active", "POPULATED", "NO_SLOT"),
        s("three-server", "three-renderer", "Catchtable 렌더가 이어집니다.", "사이트가 응답을 슬롯 버튼으로 변환합니다.", "network", "active", "POPULATED", "렌더 시작", POPULATED_PAYLOAD),
        s("three-renderer", "three-slot-dom", "슬롯 DOM이 생성됩니다.", "observer가 감시하는 영역이 변경됩니다.", "control", "active", "POPULATED", "DOM 생성"),
        s("three-slot-dom", "three-mutation", "Mutation 신호가 발생합니다.", "렌더 완료 직후 두 번째 scan 기회를 제공합니다.", "signal", "active", "POPULATED", "mutation 신호"),
        s("three-mutation", "three-coordinator", "Coordinator가 후속 scan을 수락합니다.", "첫 scan이 끝났으므로 새 single-flight scan을 실행할 수 있습니다.", "signal", "active", "POPULATED", "후속 scan"),
        s("three-coordinator", "three-scan", "두 번째 DOM scan을 실행합니다.", "이번에는 실제 슬롯 DOM이 존재합니다.", "signal", "active", "POPULATED", "scan 실행"),
        s("three-scan", "three-adapter", "SlotAdapter가 후보를 확정합니다.", "신호가 아니라 DOM 상태가 성공을 결정합니다.", "control", "active", "POPULATED", "후보 확정"),
        s("three-adapter", "three-claim", "단일 클릭을 수행합니다.", "XHR 조기 wake와 observer 보강이 한 클릭 경로로 합쳐집니다.", "control", "완료", "POPULATED", "슬롯 클릭")
      ]
    },
    {
      id: "polling",
      name: "XHR·observer 누락 · polling fallback",
      steps: [
        s("three-polling", "three-coordinator", "25ms polling tick이 도착합니다.", "다른 신호가 없어도 coordinator에 scan을 요청합니다.", "control", "active", "미관측", "poll tick"),
        s("three-coordinator", "three-scan", "Fallback scan을 실행합니다.", "아직 DOM 후보가 없어 NO_SLOT로 종료됩니다.", "control", "active", "미관측", "NO_SLOT"),
        s("three-server", "three-renderer", "Catchtable이 뒤늦게 화면을 렌더합니다.", "Probe 또는 observer가 누락된 환경을 가정합니다.", "network", "active", "미관측", "DOM 렌더", POPULATED_PAYLOAD),
        s("three-renderer", "three-slot-dom", "슬롯 DOM이 생성됩니다.", "직접 신호가 없더라도 다음 polling tick이 읽을 수 있습니다.", "control", "active", "미관측", "후보 생성"),
        s("three-polling", "three-coordinator", "다음 25ms tick이 도착합니다.", "폴링 fallback이 새 DOM 상태를 놓치지 않습니다.", "control", "active", "미관측", "scan 요청"),
        s("three-coordinator", "three-scan", "단일 scan을 다시 실행합니다.", "이전 scan과 겹치지 않는 정상 후속 실행입니다.", "control", "active", "미관측", "scan 실행"),
        s("three-scan", "three-adapter", "SlotAdapter가 후보를 찾습니다.", "신호 출처가 달라도 판정 규칙은 동일합니다.", "control", "active", "미관측", "후보 확정"),
        s("three-adapter", "three-claim", "Fallback 경로가 클릭을 획득합니다.", "세 신호 구조에서도 polling 제거가 위험한 이유입니다.", "control", "완료", "미관측", "슬롯 클릭")
      ]
    },
    {
      id: "merged",
      name: "세 신호 동시 도착 · single-flight 병합",
      steps: [
        s("three-xhr", "three-coordinator", "XHR 신호가 첫 scan을 엽니다.", "Coordinator가 scanning 상태로 전환합니다.", "signal", "active", "POPULATED", "scan 시작"),
        s("three-coordinator", "three-scan", "첫 scan이 실행 중입니다.", "동시에 하나의 scan만 허용됩니다.", "signal", "active", "POPULATED", "scanning"),
        s("three-mutation", "three-coordinator", "Mutation 신호가 scan 중 도착합니다.", "별도 병렬 scan 대신 followUp=true로 병합됩니다.", "signal", "active", "POPULATED", "follow-up 예약"),
        s("three-polling", "three-coordinator", "Polling 신호도 scan 중 도착합니다.", "이미 follow-up이 있으므로 추가 실행 수를 늘리지 않습니다.", "control", "active", "POPULATED", "기존 follow-up에 병합"),
        s("three-scan", "three-slot-dom", "첫 scan은 후보 없이 끝납니다.", "Coordinator는 병합된 신호를 보고 후속 scan을 정확히 한 번 실행합니다.", "negative", "active", "POPULATED", "NO_SLOT"),
        s("three-coordinator", "three-scan", "병합된 후속 scan을 실행합니다.", "세 신호가 와도 총 scan 수를 제한해 불필요한 DOM 작업을 줄입니다.", "signal", "active", "POPULATED", "follow-up scan"),
        s("three-scan", "three-adapter", "후속 scan이 후보를 확정합니다.", "SlotAdapter가 최신 DOM을 다시 읽습니다.", "control", "active", "POPULATED", "후보 확정"),
        s("three-adapter", "three-claim", "첫 유효 후보가 클릭 claim을 얻습니다.", "완료 플래그가 이후 모든 신호를 차단합니다.", "control", "완료", "POPULATED", "슬롯 클릭")
      ]
    }
  ];

  function s(from, to, title, description, kind, cycle, server, action, payload = "상태 변화 없음") {
    return { from, to, title, description, kind, cycle, server, action, payload };
  }

  const elements = {
    tabs: [...document.querySelectorAll("[data-view-tab]")],
    nodes: [...document.querySelectorAll(".arch-node")],
    scenario: document.getElementById("scenarioSelect"),
    speed: document.getElementById("speedRange"),
    speedOutput: document.getElementById("speedOutput"),
    reset: document.getElementById("resetButton"),
    play: document.getElementById("playButton"),
    step: document.getElementById("stepButton"),
    canvas: document.getElementById("diagramCanvas"),
    svg: document.getElementById("edgeLayer"),
    packetLayer: document.getElementById("packetLayer"),
    cycle: document.getElementById("cycleStatus"),
    server: document.getElementById("serverStatus"),
    action: document.getElementById("actionStatus"),
    counter: document.getElementById("stepCounter"),
    eventTitle: document.getElementById("eventTitle"),
    eventDescription: document.getElementById("eventDescription"),
    payload: document.getElementById("payloadReadout"),
    selected: document.getElementById("selectedComponent"),
    table: document.getElementById("componentTableWrap"),
    invariants: document.getElementById("invariantList")
  };

  const state = { view: "current", scenario: null, index: 0, playing: false, token: 0 };

  function scenarios() {
    return state.view === "current" ? currentScenarios : threeScenarios;
  }

  function setView(view) {
    stop();
    state.view = view;
    elements.tabs.forEach((tab) => {
      const active = tab.dataset.viewTab === view;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    elements.nodes.forEach((node) => { node.hidden = node.dataset.view !== view; });
    elements.scenario.replaceChildren(...scenarios().map((scenario) => new Option(scenario.name, scenario.id)));
    state.scenario = scenarios()[0];
    renderTable();
    renderInvariants();
    reset();
    requestAnimationFrame(buildEdges);
  }

  function selectScenario(id) {
    stop();
    state.scenario = scenarios().find((scenario) => scenario.id === id) || scenarios()[0];
    reset();
  }

  function reset() {
    state.token += 1;
    state.index = 0;
    elements.nodes.forEach((node) => node.classList.remove("is-active"));
    elements.packetLayer.replaceChildren();
    elements.cycle.textContent = "대기";
    elements.server.textContent = "없음";
    elements.action.textContent = "대기";
    elements.counter.textContent = `0 / ${state.scenario.steps.length}`;
    elements.eventTitle.textContent = "시나리오를 재생하세요.";
    elements.eventDescription.textContent = "패킷이 이동하면서 각 구성요소가 맡는 역할을 표시합니다.";
    elements.payload.textContent = "대기 중";
    updatePlayButton();
    requestAnimationFrame(buildEdges);
  }

  function stop() {
    state.playing = false;
    state.token += 1;
    updatePlayButton();
  }

  function updatePlayButton() {
    elements.play.textContent = state.playing ? "Ⅱ" : "▶";
    elements.play.setAttribute("aria-label", state.playing ? "일시 정지" : "재생");
    elements.play.title = state.playing ? "일시 정지" : "재생";
  }

  async function togglePlay() {
    if (state.playing) {
      stop();
      return;
    }
    if (state.index >= state.scenario.steps.length) reset();
    state.playing = true;
    updatePlayButton();
    const token = ++state.token;
    while (state.playing && token === state.token && state.index < state.scenario.steps.length) {
      await runStep(token);
      if (state.playing && token === state.token) await wait(360 / Number(elements.speed.value));
    }
    if (token === state.token) {
      state.playing = false;
      updatePlayButton();
    }
  }

  async function stepOnce() {
    stop();
    if (state.index >= state.scenario.steps.length) reset();
    const token = ++state.token;
    await runStep(token);
  }

  async function runStep(token) {
    const step = state.scenario.steps[state.index];
    if (!step) return;
    elements.nodes.forEach((node) => node.classList.remove("is-active"));
    const from = findNode(step.from);
    const to = findNode(step.to);
    from?.classList.add("is-active");
    to?.classList.add("is-active");
    setSelected(step.to);
    setEdgeActive(step.from, step.to, step.kind);
    elements.cycle.textContent = step.cycle;
    elements.server.textContent = step.server;
    elements.action.textContent = step.action;
    elements.eventTitle.textContent = step.title;
    elements.eventDescription.textContent = step.description;
    elements.payload.textContent = step.payload;
    elements.counter.textContent = `${state.index + 1} / ${state.scenario.steps.length}`;
    await animatePacket(step, token);
    if (token === state.token) state.index += 1;
  }

  function findNode(id) {
    return elements.nodes.find((node) => node.dataset.node === id);
  }

  function setSelected(id) {
    const info = nodeInfo[id];
    if (!info) return;
    elements.selected.querySelector("strong").textContent = info[0];
    elements.selected.querySelector("p").textContent = info[1];
  }

  function renderTable() {
    const table = document.createElement("table");
    table.className = "component-table";
    table.innerHTML = "<thead><tr><th>구성요소</th><th>계층</th><th>책임</th><th>직접 행동</th><th>상태</th></tr></thead>";
    const body = document.createElement("tbody");
    componentRows[state.view].forEach((row) => {
      const tr = document.createElement("tr");
      row.forEach((value, index) => {
        const td = document.createElement("td");
        td.dataset.label = ["구성요소", "계층", "책임", "직접 행동", "상태"][index];
        if (index === 0) {
          const code = document.createElement("code");
          code.textContent = value;
          td.append(code);
        } else if (index === 4) {
          const mark = document.createElement("span");
          mark.className = `status-mark ${value === "제안" || value === "별도 경로" ? "proposed" : "active"}`;
          mark.textContent = value;
          td.append(mark);
        } else {
          td.textContent = value;
        }
        tr.append(td);
      });
      body.append(tr);
    });
    table.append(body);
    elements.table.replaceChildren(table);
  }

  function renderInvariants() {
    elements.invariants.replaceChildren(...invariants[state.view].map((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      return li;
    }));
  }

  function buildEdges() {
    const rect = elements.canvas.getBoundingClientRect();
    elements.svg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
    elements.svg.replaceChildren();
    const seen = new Set();
    state.scenario.steps.forEach((step) => {
      const key = `${step.from}|${step.to}|${step.kind}`;
      if (seen.has(key)) return;
      seen.add(key);
      const d = edgePath(step.from, step.to);
      if (!d) return;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.classList.add("edge");
      path.dataset.from = step.from;
      path.dataset.to = step.to;
      path.dataset.kind = step.kind;
      elements.svg.append(path);
    });
  }

  function edgePath(fromId, toId) {
    const from = findNode(fromId);
    const to = findNode(toId);
    if (!from || !to || from.hidden || to.hidden) return null;
    const canvas = elements.canvas.getBoundingClientRect();
    const a = from.getBoundingClientRect();
    const b = to.getBoundingClientRect();
    const x1 = a.left - canvas.left + a.width / 2;
    const y1 = a.top - canvas.top + a.height / 2;
    const x2 = b.left - canvas.left + b.width / 2;
    const y2 = b.top - canvas.top + b.height / 2;
    const bend = Math.max(35, Math.abs(x2 - x1) * 0.42);
    const direction = x2 >= x1 ? 1 : -1;
    return `M ${x1} ${y1} C ${x1 + bend * direction} ${y1}, ${x2 - bend * direction} ${y2}, ${x2} ${y2}`;
  }

  function setEdgeActive(from, to, kind) {
    [...elements.svg.querySelectorAll(".edge")].forEach((edge) => {
      edge.classList.toggle("is-active", edge.dataset.from === from && edge.dataset.to === to && edge.dataset.kind === kind);
    });
  }

  async function animatePacket(step, token) {
    if (matchMedia("(max-width: 680px)").matches || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let path = [...elements.svg.querySelectorAll(".edge")].find((edge) => edge.dataset.from === step.from && edge.dataset.to === step.to && edge.dataset.kind === step.kind);
    if (!path) {
      buildEdges();
      path = [...elements.svg.querySelectorAll(".edge")].find((edge) => edge.dataset.from === step.from && edge.dataset.to === step.to && edge.dataset.kind === step.kind);
    }
    if (!path) return;
    const packet = document.createElement("span");
    packet.className = "packet";
    packet.dataset.kind = step.kind;
    elements.packetLayer.replaceChildren(packet);
    const duration = 620 / Number(elements.speed.value);
    const length = path.getTotalLength();
    const startedAt = performance.now();
    await new Promise((resolve) => {
      function frame(now) {
        if (token !== state.token) {
          packet.remove();
          resolve();
          return;
        }
        const progress = Math.min(1, (now - startedAt) / duration);
        const point = path.getPointAtLength(length * ease(progress));
        packet.style.left = `${point.x}px`;
        packet.style.top = `${point.y}px`;
        if (progress < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });
  }

  function ease(value) {
    return value < 0.5 ? 2 * value * value : 1 - Math.pow(-2 * value + 2, 2) / 2;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  elements.tabs.forEach((tab) => tab.addEventListener("click", () => setView(tab.dataset.viewTab)));
  elements.scenario.addEventListener("change", () => selectScenario(elements.scenario.value));
  elements.speed.addEventListener("input", () => { elements.speedOutput.value = `${Number(elements.speed.value).toFixed(2).replace(/\.00$/, ".0")}×`; });
  elements.reset.addEventListener("click", reset);
  elements.play.addEventListener("click", togglePlay);
  elements.step.addEventListener("click", stepOnce);
  elements.nodes.forEach((node) => node.addEventListener("click", () => setSelected(node.dataset.node)));
  let resizeTimer;
  addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(buildEdges, 100);
  });

  setView("current");
})();
