import type { PyAnimaTtsRunOptions } from "@/lib/content/catalogTypes";
import {
  isElevenLabsFinalizedTtsModelId,
  toElevenLabsV3FinalizedChunking,
  type ElevenLabsTtsModelId,
} from "@/lib/settings/preferences";

type BuildElevenLabsChatTtsDispatchOptionsArgs = {
  modelId: ElevenLabsTtsModelId;
  finalizedChunkingPreference?: unknown;
};

/**
 * Builds the backend chat TTS intent for ElevenLabs chat runs.
 */
export function buildElevenLabsChatTtsDispatchOptions({
  modelId,
  finalizedChunkingPreference,
}: BuildElevenLabsChatTtsDispatchOptionsArgs): PyAnimaTtsRunOptions {
  const isFinalized = isElevenLabsFinalizedTtsModelId(modelId);

  return {
    enabled: true,
    provider: "elevenlabs",
    transport: "auto",
    language_code: null,
    model_id: modelId,
    ...(isFinalized
      ? {
          finalized_chunking:
            toElevenLabsV3FinalizedChunking(finalizedChunkingPreference) ??
            "sentence",
        }
      : {}),
  };
}
