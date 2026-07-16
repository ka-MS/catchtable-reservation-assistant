export interface EntryFacts {
  reservationOpen: boolean;
  ctaAvailable: boolean;
  waitingOnly: boolean;
}

export interface CalendarFacts {
  displayedMonth: string | null;
  target: { available: boolean; selected: boolean } | null;
  /** target 미표시이고 표시 월이 목표 월과 다를 때만 채워진다. */
  monthNavigation: { direction: "Next page" | "Previous page"; available: boolean } | null;
}

export interface PersonFacts {
  ready: boolean;
  targetAvailable: boolean;
  targetSelected: boolean;
}
