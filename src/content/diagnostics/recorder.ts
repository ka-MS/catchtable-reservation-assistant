import type { RunEvent, RunState } from "../../shared/types.js";
import type { DiagnosticSnapshot, DiagnosticSnapshotKind, DiagnosticTrigger } from "../../shared/diagnostics/types.js";

export interface DiagnosticCaptureInput {
  runId: string;
  kind: DiagnosticSnapshotKind;
  stage: RunState;
  trigger: DiagnosticTrigger;
  reason: string;
  data?: RunEvent["data"];
  error?: unknown;
  previousFingerprint?: string | null;
}
export interface DiagnosticSnapshotTransport {
  save(runId: string, snapshots: DiagnosticSnapshot[]): Promise<void>;
}

export class DiagnosticRecorder {
  private runId: string | null = null;
  private breadcrumbs: DiagnosticSnapshot[] = [];
  private pending: Promise<void> | null = null;
  private failureRecorded = false;

  constructor(
    private readonly capture: (input: DiagnosticCaptureInput) => DiagnosticSnapshot,
    private readonly transport: DiagnosticSnapshotTransport,
    private readonly limit = 3,
  ) {}

  start(runId: string): void {
    this.runId = runId;
    this.breadcrumbs = [];
    this.pending = null;
    this.failureRecorded = false;
  }

  breadcrumb(stage: RunState, trigger: Exclude<DiagnosticTrigger, "failure">, reason: string, data?: RunEvent["data"]): void {
    if (!this.runId || this.failureRecorded) return;
    try {
      const snapshot = this.capture({
        runId: this.runId,
        kind: "breadcrumb",
        stage,
        trigger,
        reason,
        data,
        previousFingerprint: this.breadcrumbs.at(-1)?.fingerprint ?? null,
      });
      this.breadcrumbs.push(snapshot);
      if (this.breadcrumbs.length > this.limit) this.breadcrumbs.splice(0, this.breadcrumbs.length - this.limit);
    } catch {
      // Diagnostics must not affect reservation control.
    }
  }

  failure(stage: RunState, reason: string, data?: RunEvent["data"], error?: unknown): string | null {
    if (!this.runId || this.failureRecorded) return null;
    this.failureRecorded = true;
    try {
      const snapshot = this.capture({
        runId: this.runId,
        kind: "failure",
        stage,
        trigger: "failure",
        reason,
        data,
        error,
        previousFingerprint: this.breadcrumbs.at(-1)?.fingerprint ?? null,
      });
      const batch = [...this.breadcrumbs, snapshot];
      this.pending = this.transport.save(this.runId, batch);
      this.pending.catch(() => undefined);
      this.breadcrumbs = [];
      return snapshot.snapshotId;
    } catch {
      this.breadcrumbs = [];
      return null;
    }
  }

  async forceFlush(timeoutMs = 750): Promise<void> {
    if (!this.pending) return;
    await Promise.race([
      this.pending.catch(() => undefined),
      new Promise<void>((resolve) => globalThis.setTimeout(resolve, timeoutMs)),
    ]);
  }

  reset(): void {
    this.runId = null;
    this.breadcrumbs = [];
    this.pending = null;
    this.failureRecorded = false;
  }
}
