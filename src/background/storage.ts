export function appendRunEvent<T extends { runId: string }>(events: T[], event: T, limit: number): T[] {
  const sameRun = events.filter((existing) => existing.runId === event.runId);
  return [...sameRun, event].slice(-limit);
}

export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve();

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
