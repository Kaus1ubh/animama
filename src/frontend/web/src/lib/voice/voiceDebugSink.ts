import { DEBUG_ENABLED } from "@/platform/env";
import { createLogger } from "@/lib/logger";
import type { useVoiceVadDebugStore } from "@/stores/voice-vad-debug-store";

type VoiceDebugStore = typeof useVoiceVadDebugStore;
let store: VoiceDebugStore | null = null;

// Voice operation never waits for diagnostics. Production removes this import
// entirely, so it cannot retain transcripts or duplicate audio for an inspector.
if (__ANIMAMA_DEV_BUILD__ && DEBUG_ENABLED) {
  void import("@/stores/voice-vad-debug-store")
    .then((module) => {
      store = module.useVoiceVadDebugStore;
    })
    .catch(() =>
      createLogger("VoiceDebug").warn("Load", "Voice diagnostics unavailable"),
    );
}

/** A missing sink is intentional when debugging is off; it is never voice state. */
export function getVoiceDebugSink(): ReturnType<
  VoiceDebugStore["getState"]
> | null {
  return store?.getState() ?? null;
}
