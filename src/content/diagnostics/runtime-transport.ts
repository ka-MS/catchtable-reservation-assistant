import type { CommandResponse } from "../../shared/types.js";
import type { DiagnosticSnapshot, DiagnosticSnapshotBatchMessage } from "../../shared/diagnostics/types.js";
import type { DiagnosticSnapshotTransport } from "./recorder.js";

export class RuntimeDiagnosticTransport implements DiagnosticSnapshotTransport {
  constructor(
    private readonly send: (message: DiagnosticSnapshotBatchMessage) => Promise<CommandResponse>
      = (message) => chrome.runtime.sendMessage(message) as Promise<CommandResponse>,
  ) {}

  async save(runId: string, snapshots: DiagnosticSnapshot[]): Promise<void> {
    const message: DiagnosticSnapshotBatchMessage = { type: "SAVE_DIAGNOSTIC_SNAPSHOTS", runId, snapshots };
    let response: CommandResponse;
    try {
      response = await this.send(message);
    } catch {
      // Snapshot put is idempotent by snapshotId, so one retry is safe when a
      // service worker restart invalidates the first message channel.
      response = await this.send(message);
    }
    if (!response?.ok) throw new Error(response?.error ?? "진단 스냅샷을 저장할 수 없습니다.");
  }
}
