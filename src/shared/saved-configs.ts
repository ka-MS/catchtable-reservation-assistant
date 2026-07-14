import type { ReservationConfig, SavedConfig } from "./types.js";
import { normalizeReservationConfig, validateReservationConfig } from "./config.js";

export const SAVED_CONFIG_LIMIT = 20;

function canonicalUrl(value: string): string {
  try {
    const url = new URL(value);
    const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/$/, "") : url.pathname;
    return `${url.origin}${pathname}`;
  } catch {
    return value.trim();
  }
}

function normalizedKeyword(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase("ko-KR");
}

export function configFingerprint(config: ReservationConfig): string {
  return JSON.stringify({
    targetUrl: canonicalUrl(config.targetUrl),
    reservationDate: config.reservationDate,
    personCount: config.personCount,
    timeRange: config.timeRange,
    priorityTimes: config.priorityTimes,
    tablePreference: config.tablePreference,
    menuKeyword: normalizedKeyword(config.menuKeyword),
  });
}

export function upsertSavedConfig(
  items: SavedConfig[],
  config: ReservationConfig,
  metadata: { id: string; savedAt: number },
): SavedConfig[] {
  const fingerprint = configFingerprint(config);
  const next: SavedConfig = { ...metadata, fingerprint, config };
  return [next, ...items.filter((item) => item.fingerprint !== fingerprint)]
    .sort((left, right) => right.savedAt - left.savedAt)
    .slice(0, SAVED_CONFIG_LIMIT);
}

export function removeSavedConfig(items: SavedConfig[], id: string): SavedConfig[] {
  return items.filter((item) => item.id !== id);
}

export function sanitizeSavedConfigs(value: unknown): SavedConfig[] {
  if (!Array.isArray(value)) return [];
  const validItems = value.flatMap((item): SavedConfig[] => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<SavedConfig>;
    if (typeof candidate.id !== "string"
      || !Number.isFinite(candidate.savedAt)
      || typeof candidate.config !== "object"
      || candidate.config === null) {
      return [];
    }
    try {
      const config = normalizeReservationConfig(candidate.config as ReservationConfig);
      if (validateReservationConfig(config, Number.NEGATIVE_INFINITY).length > 0) return [];
      return [{
        id: candidate.id,
        savedAt: candidate.savedAt as number,
        fingerprint: configFingerprint(config),
        config,
      }];
    } catch {
      return [];
    }
  });
  return validItems
    .sort((left, right) => right.savedAt - left.savedAt)
    .slice(0, SAVED_CONFIG_LIMIT);
}
