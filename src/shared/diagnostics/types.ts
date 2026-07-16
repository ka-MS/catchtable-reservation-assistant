import type { RunState } from "../types.js";
import type { TraceError } from "../telemetry/types.js";

export type DiagnosticSnapshotKind = "breadcrumb" | "failure";
export type DiagnosticTrigger = "state" | "action" | "failure";

export interface DiagnosticRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiagnosticElement {
  tag: string;
  role: string;
  text: string;
  ariaLabel: string;
  ariaPressed: string;
  ariaChecked: string;
  ariaSelected: string;
  disabled: boolean;
  checked: boolean | null;
  selected: boolean | null;
  selectorHint: string;
  attributes: Record<string, string>;
  rect: DiagnosticRect;
}

export interface DiagnosticQueryEvidence {
  name: string;
  selector: string;
  matchCount: number;
  visibleMatchCount: number;
}

export interface DiagnosticSurface {
  kind: "dialog" | "presentation" | "dock" | "fixed" | "sticky";
  label: string;
  title: string;
  elementCount: number;
  controls: DiagnosticElement[];
}

export interface DiagnosticCalendar {
  displayedMonth: string | null;
  dateCellCount: number;
  availableDates: string[];
  selectedDates: string[];
}

export interface DiagnosticSlots {
  candidateCount: number;
  availableCount: number;
  labels: string[];
}

export interface DiagnosticEnvironment {
  url: string;
  urlKind: "shop" | "reservation_form" | "other";
  title: string;
  readyState: DocumentReadyState;
  visibilityState: DocumentVisibilityState;
  hasFocus: boolean;
  viewportWidth: number;
  viewportHeight: number;
  visualViewportWidth: number | null;
  visualViewportHeight: number | null;
  devicePixelRatio: number;
  scrollX: number;
  scrollY: number;
  activeElement: DiagnosticElement | null;
}

export interface DiagnosticSnapshot {
  schemaVersion: 1;
  snapshotId: string;
  runId: string;
  capturedAt: number;
  kind: DiagnosticSnapshotKind;
  stage: RunState;
  adapter: string;
  trigger: DiagnosticTrigger;
  reason: string;
  strategy: string | null;
  confidence: number | null;
  evidence: string[];
  queries: DiagnosticQueryEvidence[];
  environment: DiagnosticEnvironment;
  headings: DiagnosticElement[];
  buttons: DiagnosticElement[];
  radios: DiagnosticElement[];
  checkboxes: DiagnosticElement[];
  surfaces: DiagnosticSurface[];
  calendar: DiagnosticCalendar;
  slots: DiagnosticSlots;
  fingerprint: string;
  previousFingerprint: string | null;
  fragmentHtml?: string;
  error?: TraceError;
}

export interface DiagnosticSnapshotBatchMessage {
  type: "SAVE_DIAGNOSTIC_SNAPSHOTS";
  runId: string;
  snapshots: DiagnosticSnapshot[];
}

export interface DiagnosticSnapshotRepository {
  saveSnapshots(snapshots: DiagnosticSnapshot[]): Promise<void>;
  readSnapshots(runId: string): Promise<DiagnosticSnapshot[]>;
}
