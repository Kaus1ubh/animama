import type { ReactNode } from "react";

import { useRuntimeCapabilities } from "@/query/hooks/useRuntimeCapabilities";

/** Backend-reported features whose UI entry points the composition can withhold. */
export type RuntimeFeatureCapability = "chat_file_uploads" | "anima_creation";

/**
 * Whether entry points for a runtime feature should be offered.
 *
 * Only an explicit backend `false` hides a feature. While capabilities are
 * loading or unreadable the entry points stay visible, so a local runtime
 * (which always reports `true`) never flashes controls in after first paint.
 * The server still rejects work for a feature its composition does not mount.
 */
export function useRuntimeFeatureEnabled(
  capability: RuntimeFeatureCapability,
): boolean {
  return useRuntimeCapabilities().data?.[capability] !== false;
}

/** Render children only while `capability` is offered; see `useRuntimeFeatureEnabled`. */
export function RuntimeFeatureGate({
  capability,
  children,
}: {
  capability: RuntimeFeatureCapability;
  children: ReactNode;
}) {
  return useRuntimeFeatureEnabled(capability) ? children : null;
}
