import { env } from "@/platform/env";

function isWebUiTelemetryDisabled(): boolean {
  return env.disableWebuiTelemetry;
}

export function isWebUiTracingDisabled(): boolean {
  return isWebUiTelemetryDisabled() || env.disableWebuiTraces;
}
