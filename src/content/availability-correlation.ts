import {
  normalizeReservationDate,
  type ReceivedAvailabilityShadowEvent,
} from "../shared/availability-shadow.js";

export type CorrelationQuality = "EXACT" | "STRONG" | "WEAK" | "NONE";

export interface MutationGenerationSnapshot {
  generation: number;
  lastMutationMonoMs: number | null;
}

export interface TargetCycleRegistration {
  cycle: number;
  targetDate: string;
  personCount: number;
  targetClickMonoMs: number;
  mutationGenerationAtTargetClick: number;
}

export interface BodyCorrelation {
  cycle: number | null;
  requestSequence: number;
  correlationId: string | null;
  quality: CorrelationQuality;
  stale: boolean;
  lateDomCorrelation: DomCorrelation | null;
}

export interface DomCorrelation {
  cycle: number;
  requestSequence: number | null;
  correlationId: string | null;
  quality: CorrelationQuality;
  domMinutes: number;
  bodyClassification: string;
  bodySelectedMinutes: number | null;
  agreement: boolean | null;
  responseCompletedMonoMs: number | null;
  payloadClassifiedMonoMs: number | null;
  bridgeReceivedMonoMs: number | null;
  domObservedMonoMs: number;
  bridgeToDomMs: number | null;
  targetResponseToDomMs: number | null;
  bodyLeadOverDomMs: number | null;
  mutationGenerationAtTargetClick: number | null;
  mutationGenerationAtDom: number;
  mutationObservedAfterTarget: boolean | null;
  lastMutationMonoMs: number | null;
}

interface StoredBody {
  event: ReceivedAvailabilityShadowEvent;
  selectedMinutes: number | null;
  quality: CorrelationQuality;
  correlationId: string;
}

interface CycleRecord extends TargetCycleRegistration {
  body: StoredBody | null;
  dom: DomObservation | null;
}

interface DomObservation {
  minutes: number;
  observedMonoMs: number;
  mutation: MutationGenerationSnapshot;
}

const MAX_CYCLES = 12;
const REQUEST_WINDOW_EARLY_MS = 5;
const REQUEST_WINDOW_LATE_MS = 700;

function correlationId(cycle: number, sequence: number): string {
  return `cycle:${cycle}:request:${sequence}`;
}

export class AvailabilityCorrelationTracker {
  private readonly cycles: CycleRecord[] = [];

  registerCycle(registration: TargetCycleRegistration): void {
    this.cycles.push({ ...registration, body: null, dom: null });
    if (this.cycles.length > MAX_CYCLES) this.cycles.splice(0, this.cycles.length - MAX_CYCLES);
  }

  correlateBody(event: ReceivedAvailabilityShadowEvent, selectedMinutes: number | null): BodyCorrelation {
    const requestDate = normalizeReservationDate(event.requestDate);
    const exactCycle = event.cycle === null
      ? null
      : this.cycles.find((entry) => entry.cycle === event.cycle) ?? null;
    let record: CycleRecord | null = null;
    let quality: CorrelationQuality = "NONE";

    if (event.cycle !== null) {
      const exact = exactCycle !== null
        && requestDate === exactCycle.targetDate
        && event.personCount === exactCycle.personCount
        && event.targetClickMonoMs === exactCycle.targetClickMonoMs;
      if (exact) {
        record = exactCycle;
        quality = "EXACT";
      } else {
        quality = "WEAK";
      }
    } else if (requestDate !== null && event.personCount !== null) {
      const candidates = this.cycles.filter((entry) => (
        entry.targetDate === requestDate
        && entry.personCount === event.personCount
        && event.requestSentMonoMs >= entry.targetClickMonoMs - REQUEST_WINDOW_EARLY_MS
        && event.requestSentMonoMs <= entry.targetClickMonoMs + REQUEST_WINDOW_LATE_MS
      ));
      if (candidates.length === 1) {
        [record] = candidates;
        quality = "STRONG";
      } else if (candidates.length > 1) {
        quality = "WEAK";
      }
    }

    let stale = false;
    let id: string | null = null;
    if (record && (quality === "EXACT" || quality === "STRONG")) {
      id = correlationId(record.cycle, event.sequence);
      stale = record.body !== null && event.sequence <= record.body.event.sequence;
      if (!stale) record.body = { event, selectedMinutes, quality, correlationId: id };
    }

    return {
      cycle: record?.cycle ?? null,
      requestSequence: event.sequence,
      correlationId: id,
      quality,
      stale,
      lateDomCorrelation: !stale && record?.dom
        ? this.buildDomCorrelation(record, record.dom)
        : null,
    };
  }

  correlateDom(
    cycle: number,
    domMinutes: number,
    domObservedMonoMs: number,
    mutation: MutationGenerationSnapshot,
  ): DomCorrelation {
    const record = this.cycles.find((entry) => entry.cycle === cycle) ?? null;
    const observation = {
      minutes: domMinutes,
      observedMonoMs: domObservedMonoMs,
      mutation,
    };
    if (record) record.dom = observation;
    return this.buildDomCorrelation(record, observation, cycle);
  }

  private buildDomCorrelation(
    record: CycleRecord | null,
    observation: DomObservation,
    fallbackCycle = record?.cycle ?? 0,
  ): DomCorrelation {
    const body = record?.body ?? null;
    return {
      cycle: record?.cycle ?? fallbackCycle,
      requestSequence: body?.event.sequence ?? null,
      correlationId: body?.correlationId ?? null,
      quality: body?.quality ?? "NONE",
      domMinutes: observation.minutes,
      bodyClassification: body?.event.classification ?? "none",
      bodySelectedMinutes: body?.selectedMinutes ?? null,
      agreement: body === null ? null : body.selectedMinutes === observation.minutes,
      responseCompletedMonoMs: body?.event.responseCompletedMonoMs ?? null,
      payloadClassifiedMonoMs: body?.event.payloadClassifiedMonoMs ?? null,
      bridgeReceivedMonoMs: body?.event.bridgeReceivedMonoMs ?? null,
      domObservedMonoMs: observation.observedMonoMs,
      bridgeToDomMs: body === null ? null : observation.observedMonoMs - body.event.bridgeReceivedMonoMs,
      targetResponseToDomMs: body === null ? null : observation.observedMonoMs - body.event.responseCompletedMonoMs,
      bodyLeadOverDomMs: body === null ? null : observation.observedMonoMs - body.event.payloadClassifiedMonoMs,
      mutationGenerationAtTargetClick: record?.mutationGenerationAtTargetClick ?? null,
      mutationGenerationAtDom: observation.mutation.generation,
      mutationObservedAfterTarget: record === null
        ? null
        : observation.mutation.generation > record.mutationGenerationAtTargetClick,
      lastMutationMonoMs: observation.mutation.lastMutationMonoMs,
    };
  }
}
