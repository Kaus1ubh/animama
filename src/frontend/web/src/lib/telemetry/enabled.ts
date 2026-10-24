import type { RuntimeCapabilities } from "@animama/runtime-contracts";
import { env } from "@/platform/env";
import { getRuntimePlatformSnapshot } from "@/platform/runtime-platform";

/** The local FastAPI forwarder's base path, used when the capability names none. */
const DEFAULT_BROWSER_TELEMETRY_PATH = "/api/telemetry";
/** A relative path on the page's own origin: no scheme, host, dot segment or query. */
const SAME_ORIGIN_PATH = /^(\/[A-Za-z0-9_-]+)+$/;

function isWebUiTelemetryDisabled(): boolean {
  return env.disableWebuiTelemetry;
}

export function isWebUiTracingDisabled(): boolean {
  return isWebUiTelemetryDisabled() || env.disableWebuiTraces;
}

/**
 * The same-origin base path to export browser telemetry to, or null when this
 * page must not export. Export needs the serving origin's capability; the
 * build-time switch still wins, and the embedded desktop app never exports,
 * whatever its runtime reports.
 */
export function browserTelemetryPath(
  capabilities: RuntimeCapabilities,
): string | null {
  const capability = capabilities.browser_telemetry;
  if (!capability || isWebUiTelemetryDisabled()) return null;
  if (
    env.mode === "embedded-desktop" ||
    capabilities.runtime_kind === "desktop" ||
    getRuntimePlatformSnapshot().isDesktop
  )
    return null;
  const path = capability.path ?? DEFAULT_BROWSER_TELEMETRY_PATH;
  return path.length <= 128 && SAME_ORIGIN_PATH.test(path) ? path : null;
}
