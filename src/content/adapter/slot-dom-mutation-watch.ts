import type { MutationGenerationSnapshot } from "../availability-correlation.js";

interface ObserverLike {
  observe(target: object, options: MutationObserverInit): void;
  disconnect(): void;
}

type ObserverFactory = (callback: () => void) => ObserverLike;

export interface SlotDomMutationWatchPort {
  start(): void;
  snapshot(): MutationGenerationSnapshot;
  stop(): void;
}

export class SlotDomMutationWatch implements SlotDomMutationWatchPort {
  private observer: ObserverLike | null = null;
  private generation = 0;
  private lastMutationMonoMs: number | null = null;

  constructor(
    private readonly createObserver: ObserverFactory,
    private readonly root: object,
    private readonly monotonicNow: () => number,
  ) {}

  start(): void {
    if (this.observer) return;
    this.generation = 0;
    this.lastMutationMonoMs = null;
    const observer = this.createObserver(() => {
      this.generation += 1;
      this.lastMutationMonoMs = this.monotonicNow();
    });
    observer.observe(this.root, { subtree: true, childList: true, attributes: true });
    this.observer = observer;
  }

  snapshot(): MutationGenerationSnapshot {
    return { generation: this.generation, lastMutationMonoMs: this.lastMutationMonoMs };
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
  }
}

export function createSlotDomMutationWatch(document: Document): SlotDomMutationWatchPort {
  return new SlotDomMutationWatch(
    (callback) => new MutationObserver(callback),
    document.documentElement,
    () => performance.now(),
  );
}
