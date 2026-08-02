import { localInputToEpoch } from "../shared/time.js";
import { validateWaitingConfig } from "../shared/waiting-config.js";
import type { WaitingConfig } from "../shared/types.js";

export interface WaitingFormValues {
  targetUrl: string;
  openAt: string;
  stopAt: string;
  preOpenLeadMs: string;
  pollIntervalMs: string;
  refreshIntervalMs: string;
  dryRun: boolean;
}

export function waitingConfigFromFormValues(values: WaitingFormValues, nowMs: number): WaitingConfig {
  const config: WaitingConfig = {
    targetUrl: values.targetUrl.trim(),
    openAtMs: localInputToEpoch(values.openAt),
    stopAtMs: localInputToEpoch(values.stopAt),
    dryRun: values.dryRun,
    preOpenLeadMs: Number(values.preOpenLeadMs),
    pollIntervalMs: Number(values.pollIntervalMs),
    refreshIntervalMs: Number(values.refreshIntervalMs),
  };
  const errors = validateWaitingConfig(config, nowMs);
  if (errors.length > 0) throw new Error(errors.join(" "));
  return config;
}
