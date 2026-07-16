import type { DiagnosticSnapshot } from "../../shared/diagnostics/types.js";
import type { TraceEvent, TraceRunRecord } from "../../shared/telemetry/types.js";
import { traceCsv } from "../telemetry/trace-csv.js";
import { createStoredZip } from "./zip-store.js";

function jsonLines(values: unknown[]): string {
  return values.map((value) => JSON.stringify(value)).join("\n") + (values.length === 0 ? "" : "\n");
}
function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

export function diagnosticBundleFilename(runId: string): string {
  return `catchtable-diagnostic-${safeSegment(runId)}.zip`;
}

export function diagnosticBundle(
  run: TraceRunRecord,
  events: TraceEvent[],
  snapshots: DiagnosticSnapshot[],
  generatedAt = Date.now(),
): Uint8Array {
  const fragmentFiles = new Map<string, string>();
  const snapshotRecords = snapshots.map((snapshot) => {
    const { fragmentHtml, ...record } = snapshot;
    if (!fragmentHtml) return record;
    const fragmentFile = `fragments/${safeSegment(snapshot.snapshotId)}.html`;
    fragmentFiles.set(fragmentFile, fragmentHtml);
    return { ...record, fragmentFile };
  });
  const manifest = {
    schemaVersion: 1,
    bundleType: "catchtable-run-diagnostic",
    generatedAt,
    run,
    eventCount: events.length,
    snapshotCount: snapshots.length,
    fragmentCount: fragmentFiles.size,
  };
  const environment = {
    schemaVersion: 1,
    runId: run.runId,
    extensionVersion: run.extensionVersion,
    snapshots: snapshots.map((snapshot) => ({
      snapshotId: snapshot.snapshotId,
      capturedAt: snapshot.capturedAt,
      stage: snapshot.stage,
      environment: snapshot.environment,
    })),
  };
  const entries = [
    { name: "manifest.json", data: JSON.stringify(manifest, null, 2) },
    { name: "run.csv", data: traceCsv(run, events) },
    { name: "events.jsonl", data: jsonLines(events) },
    { name: "dom-snapshots.jsonl", data: jsonLines(snapshotRecords) },
    { name: "environment.json", data: JSON.stringify(environment, null, 2) },
    ...[...fragmentFiles].map(([name, data]) => ({ name, data })),
  ];
  return createStoredZip(entries, run.finishedAt ?? generatedAt);
}
