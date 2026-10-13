import type { PyAnimaTtsRunOptions } from "@/lib/content/catalogTypes";
import type { GeminiTtsModelId } from "@/lib/settings/preferences";

/**
 * Builds the backend chat TTS intent for Gemini chat runs. The server speaks
 * each sentence as it is ready and pushes the audio in the chat stream.
 */
export function buildGeminiChatTtsDispatchOptions({
  modelId,
}: {
  modelId: GeminiTtsModelId;
}): PyAnimaTtsRunOptions {
  return {
    enabled: true,
    provider: "gemini",
    transport: "auto",
    language_code: null,
    model_id: modelId,
    finalized_chunking: "sentence",
  };
}
