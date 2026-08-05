export const ONBOARDING_VERSION = 1;

interface TourStep {
  target: string;
  title: string;
  description: string;
  placement?: "bottom" | "top";
}

const STEPS: readonly TourStep[] = [
  {
    target: "#form-tour-heading",
    title: "새 예약 작업",
    description: "예약할 식당과 일정, 원하는 시간, 진행 범위와 실행 방식을 순서대로 설정합니다.",
  },
  {
    target: "#reservation-when-card",
    title: "언제 예약할까요?",
    description: "예약할 식당의 캐치테이블 URL을 입력하세요. 식당 페이지를 열어 둔 경우 ‘현재 탭에서 가져오기’로 자동 입력할 수도 있습니다. 이어서 오픈 일시, 감시 종료 시각, 방문 날짜와 인원을 설정합니다.",
  },
  {
    target: "#reservation-slot-card",
    title: "어떤 자리를 찾을까요?",
    description: "희망 시간 범위를 정하고 꼭 원하는 시간이 있다면 우선순위에 추가하세요. 우선순위가 없으면 범위 안의 이른 슬롯을 선택합니다.",
  },
  {
    target: "#reservation-progress-card",
    title: "후속 선택 자동 진행",
    description: "켜면 테이블·메뉴 등 확인된 중간 단계를 진행합니다. 예약 완주를 켜지 않았다면 최종 예약 폼에서 사용자에게 인계합니다.",
  },
  {
    target: "#reservation-completion-card",
    title: "예약 완주",
    description: "명시적으로 켠 경우에만 약관 동의·CatchPay·최종 예약까지 진행합니다. 실제 결제가 발생할 수 있으므로 금액 상한과 일회성 PIN을 확인하세요.",
  },
  {
    target: "#execution-mode-card",
    title: "실행 모드",
    description: "안전 점검은 테스트 작동 시 슬롯 감지만 확인하는 기능입니다. 실제 예약에서는 끈 상태로 사용하세요. 고급 설정은 기본값 유지를 권장합니다.",
  },
  {
    target: "#action-bar",
    title: "저장하거나 바로 시작하기",
    description: "예약 저장은 오픈 시각에 자동 실행할 작업을 등록하고, 지금 시작은 즉시 실행합니다. 저장 작업은 CatchPay PIN을 보관하지 않습니다.",
    placement: "top",
  },
  {
    target: "#onboarding-help",
    title: "실행 결과 확인",
    description: "실행 결과는 실행 로그에서 확인하세요. 이 가이드는 헤더의 사용법 버튼으로 언제든 다시 볼 수 있습니다.",
  },
];

function byId<T extends HTMLElement>(document: Document, id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`필수 온보딩 UI가 없습니다: ${id}`);
  return element as T;
}

export function shouldOfferOnboarding(value: unknown): boolean {
  return typeof value !== "number" || value < ONBOARDING_VERSION;
}

export class OnboardingTour {
  private readonly scrim: HTMLElement;
  private readonly card: HTMLElement;
  private readonly inactiveRegions: readonly HTMLElement[];
  private readonly progress: HTMLElement;
  private readonly title: HTMLElement;
  private readonly description: HTMLElement;
  private readonly previous: HTMLButtonElement;
  private readonly next: HTMLButtonElement;
  private readonly close: HTMLButtonElement;
  private activeTarget: HTMLElement | null = null;
  private stepIndex = 0;
  private isActive = false;

  constructor(
    private readonly document: Document,
    private readonly onExit: () => void,
  ) {
    this.scrim = byId(document, "onboarding-scrim");
    this.card = byId(document, "onboarding-tour");
    this.inactiveRegions = [
      byId(document, "app-header"),
      byId(document, "app-main"),
      byId(document, "action-bar"),
    ];
    this.progress = byId(document, "onboarding-progress");
    this.title = byId(document, "onboarding-title");
    this.description = byId(document, "onboarding-description");
    this.previous = byId(document, "onboarding-previous");
    this.next = byId(document, "onboarding-next");
    this.close = byId(document, "onboarding-close");

    this.previous.addEventListener("click", () => this.move(-1));
    this.next.addEventListener("click", () => {
      if (this.stepIndex === STEPS.length - 1) this.finish();
      else this.move(1);
    });
    this.close.addEventListener("click", () => this.finish());
  }

  get active(): boolean {
    return this.isActive;
  }

  start(): void {
    this.isActive = true;
    this.stepIndex = 0;
    this.scrim.hidden = false;
    this.card.hidden = false;
    this.inactiveRegions.forEach((region) => region.setAttribute("inert", ""));
    this.document.body.dataset.onboarding = "active";
    this.document.addEventListener("keydown", this.handleKeydown);
    this.render();
  }

  finish(): void {
    if (!this.isActive) return;
    this.isActive = false;
    this.activeTarget?.classList.remove("onboarding-target");
    this.activeTarget = null;
    this.scrim.hidden = true;
    this.card.hidden = true;
    this.inactiveRegions.forEach((region) => region.removeAttribute("inert"));
    delete this.document.body.dataset.onboarding;
    this.document.removeEventListener("keydown", this.handleKeydown);
    this.onExit();
  }

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") this.finish();
  };

  private move(delta: number): void {
    const nextIndex = this.stepIndex + delta;
    if (nextIndex < 0 || nextIndex >= STEPS.length) return;
    this.stepIndex = nextIndex;
    this.render();
  }

  private render(): void {
    const step = STEPS[this.stepIndex];
    const target = this.document.querySelector<HTMLElement>(step.target);
    if (!target) throw new Error(`온보딩 대상을 찾을 수 없습니다: ${step.target}`);

    this.activeTarget?.classList.remove("onboarding-target");
    this.activeTarget = target;
    target.classList.add("onboarding-target");
    if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "center" });

    this.card.dataset.placement = step.placement ?? "bottom";
    this.progress.textContent = `${this.stepIndex + 1} / ${STEPS.length}`;
    this.title.textContent = step.title;
    this.description.textContent = step.description;
    this.previous.disabled = this.stepIndex === 0;
    this.next.textContent = this.stepIndex === STEPS.length - 1 ? "완료" : "다음";
    this.title.focus();
  }
}
