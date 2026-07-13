export const AVAILABILITY_SHADOW_EVENT_TYPE = "AVAILABILITY_SHADOW_EVENT";
export const AVAILABILITY_SHADOW_ACTIVATE_TYPE = "AVAILABILITY_SHADOW_ACTIVATE";
export const AVAILABILITY_SHADOW_DEACTIVATE_TYPE = "AVAILABILITY_SHADOW_DEACTIVATE";
export const AVAILABILITY_SHADOW_MAIN_SOURCE = "ct-reserve-main";
export const AVAILABILITY_SHADOW_ISOLATED_SOURCE = "ct-reserve-isolated";

const MAX_AVAILABLE_MINUTES = 64;
const CLASSIFICATIONS = new Set<AvailabilityClassification>([
  "EMPTY",
  "POPULATED",
  "UNPARSABLE",
  "IRRELEVANT",
]);

export type AvailabilityClassification = "EMPTY" | "POPULATED" | "UNPARSABLE" | "IRRELEVANT";

export interface AvailabilityRequestIdentity {
  requestDate: string | null;
  personCount: number | null;
}

export interface AvailabilityClassificationResult {
  classification: AvailabilityClassification;
  availableMinutes: number[];
}

export interface AvailabilityShadowEvent extends AvailabilityRequestIdentity {
  source: typeof AVAILABILITY_SHADOW_MAIN_SOURCE;
  type: typeof AVAILABILITY_SHADOW_EVENT_TYPE;
  schemaVersion: 1;
  channelId: string;
  sequence: number;
  classification: AvailabilityClassification;
  availableMinutes: number[];
  responseStatus: number;
  requestSentMonoMs: number;
  responseCompletedMonoMs: number;
  bodyReadCompletedMonoMs: number;
  payloadClassifiedMonoMs: number;
}

export interface ReceivedAvailabilityShadowEvent extends AvailabilityShadowEvent {
  bridgeReceivedMonoMs: number;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function validDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function normalizeReservationDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const compact = value.replaceAll("-", "");
  if (!/^\d{6}$|^\d{8}$/.test(compact)) return null;
  const expanded = compact.length === 6 ? `20${compact}` : compact;
  const year = Number(expanded.slice(0, 4));
  const month = Number(expanded.slice(4, 6));
  const day = Number(expanded.slice(6, 8));
  if (!validDate(year, month, day)) return null;
  return `${expanded.slice(0, 4)}-${expanded.slice(4, 6)}-${expanded.slice(6, 8)}`;
}

function normalizePersonCount(value: unknown): number | null {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof number === "number" && Number.isInteger(number) && number > 0 && number <= 100
    ? number
    : null;
}

function parseSlotMinutes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{2}):?(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

export function classifyAvailabilityResponse(
  responseText: string,
  request: AvailabilityRequestIdentity,
): AvailabilityClassificationResult {
  try {
    const root = objectValue(JSON.parse(responseText));
    const data = objectValue(root?.data);
    const map = objectValue(data?.timeSlotMap);
    if (!data || !map) return { classification: "UNPARSABLE", availableMinutes: [] };

    const requestDate = normalizeReservationDate(request.requestDate);
    const responseDate = normalizeReservationDate(data.inputDate);
    if (requestDate && responseDate && requestDate !== responseDate) {
      return { classification: "IRRELEVANT", availableMinutes: [] };
    }
    const requestPerson = normalizePersonCount(request.personCount);
    const responsePerson = normalizePersonCount(data.personCount);
    if (requestPerson && responsePerson && requestPerson !== responsePerson) {
      return { classification: "IRRELEVANT", availableMinutes: [] };
    }

    const available = new Set<number>();
    for (const [key, rawEntry] of Object.entries(map)) {
      const entry = objectValue(rawEntry);
      if (!entry || typeof entry.availableYn !== "boolean") {
        return { classification: "UNPARSABLE", availableMinutes: [] };
      }
      if (!entry.availableYn) continue;
      const minutes = parseSlotMinutes(key) ?? parseSlotMinutes(entry.time);
      if (minutes === null || (!available.has(minutes) && available.size >= MAX_AVAILABLE_MINUTES)) {
        return { classification: "UNPARSABLE", availableMinutes: [] };
      }
      available.add(minutes);
    }
    const availableMinutes = [...available].sort((left, right) => left - right);
    return {
      classification: availableMinutes.length > 0 ? "POPULATED" : "EMPTY",
      availableMinutes,
    };
  } catch {
    return { classification: "UNPARSABLE", availableMinutes: [] };
  }
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function isAvailabilityShadowEvent(value: unknown, channelId: string): value is AvailabilityShadowEvent {
  const event = objectValue(value);
  if (!event) return false;
  if (event.source !== AVAILABILITY_SHADOW_MAIN_SOURCE
    || event.type !== AVAILABILITY_SHADOW_EVENT_TYPE
    || event.schemaVersion !== 1
    || event.channelId !== channelId
    || typeof event.channelId !== "string"
    || event.channelId.length < 1
    || event.channelId.length > 128
    || !Number.isInteger(event.sequence)
    || (event.sequence as number) < 1
    || !CLASSIFICATIONS.has(event.classification as AvailabilityClassification)) return false;
  if (event.requestDate !== null && (typeof event.requestDate !== "string" || event.requestDate.length > 16)) return false;
  if (event.personCount !== null && normalizePersonCount(event.personCount) === null) return false;
  if (!Array.isArray(event.availableMinutes) || event.availableMinutes.length > MAX_AVAILABLE_MINUTES) return false;
  if (!event.availableMinutes.every((minute) => Number.isInteger(minute) && minute >= 0 && minute < 1440)) return false;
  if (!Number.isInteger(event.responseStatus) || (event.responseStatus as number) < 0 || (event.responseStatus as number) > 599) return false;
  return finiteNumber(event.requestSentMonoMs)
    && finiteNumber(event.responseCompletedMonoMs)
    && finiteNumber(event.bodyReadCompletedMonoMs)
    && finiteNumber(event.payloadClassifiedMonoMs);
}
