export function appendRunEvent<T extends { runId: string }>(events: T[], event: T, limit: number): T[] {
  const sameRun = events.filter((existing) => existing.runId === event.runId);
  return [...sameRun, event].slice(-limit);
}
