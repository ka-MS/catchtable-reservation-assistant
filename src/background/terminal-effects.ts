// terminal 효과(배지·OS 알림·예약 job 종결)는 logical run terminal에서만, supervisor
// 결정 이후에만 실행된다 — "저장 즉시 알림"이 사라져 RESET 중 오보가 구조적으로 불가능하다.
import type { LogicalRun } from "../shared/run-control/logical-run.js";
import type { TerminalRunState } from "../shared/run-control/protocol.js";

export interface TerminalEffectsDependencies {
  setBadge(color: string, text: string): Promise<void>;
  /** 결정적 notificationId — 같은 run의 재실행은 새 알림을 만들지 않는다(멱등). */
  notify(notificationId: string, message: string): void;
  finishJob(jobId: string, state: TerminalRunState, message: string, finishedAt: number): Promise<void>;
}

export async function runTerminalEffects(run: LogicalRun, deps: TerminalEffectsDependencies): Promise<void> {
  const attempt = run.attempts.find((candidate) => candidate.runId === run.currentAttemptId);
  const state = attempt?.finalState ?? "FAILED";
  const message = attempt?.message ?? "실행이 종료됐습니다.";
  const finishedAt = attempt?.finishedAt ?? run.updatedAt;
  const needsAttention = state === "HANDED_OFF" || state === "DRY_RUN_COMPLETED";
  await deps.setBadge(needsAttention ? "#ff5a1f" : "#4b5563", needsAttention ? "!" : "");
  if (needsAttention || state === "TIMED_OUT" || state === "FAILED") {
    deps.notify(`run-terminal:${run.logicalRunId}`, message);
  }
  if (run.origin.kind === "scheduled") {
    await deps.finishJob(run.origin.jobId, state, message, finishedAt);
  }
}
