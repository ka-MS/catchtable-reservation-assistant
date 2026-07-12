import type { ReservationConfig, SavedConfig, SavedConfigList } from "../shared/types.js";

interface SavedConfigCallbacks {
  load(config: ReservationConfig): void;
  saveFavorite(): void;
  remove(list: SavedConfigList, id: string): void;
  clear(list: SavedConfigList): void;
}

function byId<T extends HTMLElement>(document: Document, id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`필수 저장 설정 UI가 없습니다: ${id}`);
  return element as T;
}

function minutes(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function dateLabel(value: string): string {
  const [, month, day] = value.split("-");
  return `${Number(month)}월 ${Number(day)}일`;
}

function dateTimeLabel(ms: number): string {
  const date = new Date(ms);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function restaurantLabel(targetUrl: string): string {
  try {
    const slug = decodeURIComponent(new URL(targetUrl).pathname.split("/").filter(Boolean).at(-1) ?? "");
    if (!slug || (/^[A-Za-z0-9]+$/.test(slug) && slug.length > 20)) return "식당 설정";
    return slug.replace(/[_-]+/g, " ");
  } catch {
    return "식당 설정";
  }
}

export class SavedConfigsView {
  private activeList: SavedConfigList = "history";
  private history: SavedConfig[] = [];
  private favorites: SavedConfig[] = [];
  private readonly list: HTMLUListElement;
  private readonly count: HTMLElement;
  private readonly saveFavorite: HTMLButtonElement;
  private readonly clear: HTMLButtonElement;
  private readonly tabs: Record<SavedConfigList, HTMLButtonElement>;

  constructor(
    private readonly document: Document,
    private readonly callbacks: SavedConfigCallbacks,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.list = byId(document, "saved-config-list");
    this.count = byId(document, "saved-config-count");
    this.saveFavorite = document.querySelector('[data-saved-action="save-favorite"]') as HTMLButtonElement;
    this.clear = document.querySelector('[data-saved-action="clear"]') as HTMLButtonElement;
    this.tabs = {
      history: document.querySelector('[data-saved-list="history"]') as HTMLButtonElement,
      favorites: document.querySelector('[data-saved-list="favorites"]') as HTMLButtonElement,
    };
    for (const list of ["history", "favorites"] as const) {
      this.tabs[list].addEventListener("click", () => {
        this.activeList = list;
        this.renderCurrent();
      });
    }
    this.saveFavorite.addEventListener("click", () => this.callbacks.saveFavorite());
    this.clear.addEventListener("click", () => this.callbacks.clear(this.activeList));
  }

  render(history: SavedConfig[], favorites: SavedConfig[]): void {
    this.history = history;
    this.favorites = favorites;
    this.renderCurrent();
  }

  private renderCurrent(): void {
    const items = this.activeList === "history" ? this.history : this.favorites;
    for (const list of ["history", "favorites"] as const) {
      const selected = list === this.activeList;
      this.tabs[list].setAttribute("aria-selected", String(selected));
      this.tabs[list].tabIndex = selected ? 0 : -1;
    }
    this.count.textContent = `${items.length}개`;
    this.saveFavorite.hidden = this.activeList !== "favorites";
    this.clear.disabled = items.length === 0;
    this.list.replaceChildren();
    if (items.length === 0) {
      const empty = this.document.createElement("li");
      empty.className = "saved-config-empty";
      empty.textContent = this.activeList === "history" ? "최근 실행 설정이 없습니다." : "저장한 즐겨찾기가 없습니다.";
      this.list.append(empty);
      return;
    }
    for (const item of items) this.list.append(this.createItem(item));
  }

  private createItem(item: SavedConfig): HTMLLIElement {
    const row = this.document.createElement("li");
    row.className = "saved-config-item";
    const load = this.document.createElement("button");
    load.type = "button";
    load.className = "saved-config-load";
    load.dataset.savedAction = "load";
    const title = this.document.createElement("strong");
    title.textContent = `${restaurantLabel(item.config.targetUrl)} · ${dateLabel(item.config.reservationDate)} · ${item.config.personCount}명`;
    const detail = this.document.createElement("span");
    detail.textContent = `${minutes(item.config.timeRange.startMinutes)}–${minutes(item.config.timeRange.endMinutes)}`;
    if (item.config.openAtMs < this.now()) {
      const past = this.document.createElement("span");
      past.className = "saved-config-past";
      past.textContent = "지난 오픈";
      detail.append(" · ", past);
    }
    const savedAt = this.document.createElement("span");
    savedAt.className = "saved-config-date";
    savedAt.textContent = `${this.activeList === "history" ? "최근 사용" : "저장일"} ${dateTimeLabel(item.savedAt)}`;
    load.append(title, detail, savedAt);
    load.addEventListener("click", () => this.callbacks.load(item.config));

    const remove = this.document.createElement("button");
    remove.type = "button";
    remove.className = "saved-config-remove";
    remove.dataset.savedAction = "remove";
    remove.title = "삭제";
    remove.setAttribute("aria-label", `${title.textContent} 삭제`);
    remove.textContent = "×";
    remove.addEventListener("click", () => this.callbacks.remove(this.activeList, item.id));
    row.append(load, remove);
    return row;
  }
}
