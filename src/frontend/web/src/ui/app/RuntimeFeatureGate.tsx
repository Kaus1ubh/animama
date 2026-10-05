import type { ReactNode } from "react";

import { useRuntimeCapabilities } from "@/query/hooks/useRuntimeCapabilities";

/** Backend-reported features whose UI entry points the composition can withhold. */
export type RuntimeFeatureCapability = "chat_file_uploads" | "anima_creation";

/**
 * Whether entry points for a runtime feature should be offered.
 *
 * A feature is offered only after the runtime explicitly reports it available.
 * Admission supplies the initial capabilities, so local controls remain stable
 * while hosted loading and unreadable responses cannot enable excluded work.
 */
export function useRuntimeFeatureEnabled(
  capability: RuntimeFeatureCapability,
): boolean {
  return useRuntimeCapabilities().data?.[capability] === true;
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
