import { isDisabled, isElementHidden, normalizedText, safeText, visibleAll } from "./dom.js";

export interface WaitingCtaFacts {
  /** dock에 온라인 웨이팅 CTA가 있는지. */
  present: boolean;
  /** 현재 CTA 문구(진단용, 80자 절단). */
  label: string;
  /** 지금 클릭 가능한지 — CTA가 있고 disabled가 아니다. */
  registerable: boolean;
  /** 온라인 웨이팅이 없고 현장 웨이팅만 받는 매장. */
  onsiteOnly: boolean;
  /** 웨이팅 섹션 새로고침 컨트롤을 찾았는지. */
  refreshAvailable: boolean;
}

/**
 * 실측 2026-07-31 희옥: 온라인 웨이팅 CTA는 매장 상세 하단 고정 dock `aside#dock` 내부의
 * `<button disabled type="button">`이며 내부 span 두 개가 `온라인 웨이팅` + `오전 9시 30분에 오픈`이다.
 * class는 해시(`_1sg313o3`)이고 `aria-label`·`data-*`가 없어 dock + 버튼 텍스트만 안정 앵커다.
 * 오픈 시각에는 같은 버튼의 `disabled`가 풀리며 문구가 `웨이팅 등록하기`로 바뀐다 `[화면 증거]`.
 * 그래서 판정은 문구 일치가 아니라 "웨이팅 CTA가 활성화됐는지"로 한다.
 */
export class WaitingAdapter {
  constructor(private readonly document: Document) {}

  inspect(): WaitingCtaFacts {
    const refreshAvailable = this.findRefresh() !== null;
    const cta = this.findCta();
    if (!cta) return { present: false, label: "", registerable: false, onsiteOnly: false, refreshAvailable };
    const label = normalizedText(cta.textContent);
    return {
      present: true,
      label: safeText(cta.textContent),
      registerable: !isDisabled(cta),
      onsiteOnly: label.includes("현장 웨이팅만 가능"),
      refreshAvailable,
    };
  }

  clickRegister(): boolean {
    const cta = this.findCta();
    if (!cta || isDisabled(cta) || !cta.isConnected) return false;
    cta.click();
    return true;
  }

  /** 웨이팅 섹션의 새로고침을 눌러 서버 상태를 다시 받아온다. */
  clickRefresh(): boolean {
    const refresh = this.findRefresh();
    if (!refresh || isDisabled(refresh) || !refresh.isConnected) return false;
    refresh.click();
    return true;
  }

  /**
   * 홈 탭 웨이팅 섹션의 `새로고침` 컨트롤. class는 해시라 텍스트만 앵커다.
   * 라벨을 포함하는 clickable 중 텍스트가 가장 짧은 것을 고른다 — 상위 컨테이너가
   * 함께 잡혀 섹션 전체를 오클릭하는 것을 막는다.
   */
  private findRefresh(): HTMLElement | null {
    const candidates = visibleAll<HTMLElement>(this.document, 'button, [role="button"], a')
      .filter((element) => normalizedText(element.textContent).includes("새로고침"));
    if (candidates.length === 0) return null;
    return candidates.reduce((shortest, element) =>
      normalizedText(element.textContent).length < normalizedText(shortest.textContent).length ? element : shortest);
  }

  /** SPA 리렌더로 노드가 교체되므로 노드를 보관하지 않고 매번 dock에서 다시 찾는다. */
  private findCta(): HTMLButtonElement | null {
    const dock = this.document.querySelector("aside#dock");
    if (!dock || isElementHidden(dock)) return null;
    return visibleAll<HTMLButtonElement>(dock, "button")
      .find((button) => normalizedText(button.textContent).includes("웨이팅")) ?? null;
  }
}
