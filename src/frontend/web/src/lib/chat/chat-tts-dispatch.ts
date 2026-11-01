import type { PyAnimaDispatchOptions } from "@/lib/content/catalogTypes";
import {
  DEFAULT_ELEVENLABS_TTS_MODEL_ID,
  DEFAULT_GEMINI_TTS_MODEL_ID,
  type ElevenLabsTtsModelId,
  type GeminiTtsModelId,
  type TtsProviderPreference,
} from "@/lib/settings/preferences";

import { buildElevenLabsChatTtsDispatchOptions } from "./elevenlabs-chat-tts-dispatch";
import { buildGeminiChatTtsDispatchOptions } from "./gemini-chat-tts-dispatch";

/**
 * The chat request's TTS options for the voice that speaks the reply, or
 * `undefined` when speech is off (`provider` is `null`). The server speaks
 * ElevenLabs and Gemini replies itself; Pocket TTS and browser speech only
 * name themselves, so the prompt keeps their replies speakable.
 */
export function chatTtsDispatchOptions({
  provider,
  elevenLabsModelId,
  geminiModelId,
}: {
  provider: TtsProviderPreference | null;
  elevenLabsModelId: ElevenLabsTtsModelId | null;
  geminiModelId: GeminiTtsModelId | null;
}): PyAnimaDispatchOptions | undefined {
  switch (provider) {
    case "elevenlabs":
      return {
        tts: buildElevenLabsChatTtsDispatchOptions({
          modelId: elevenLabsModelId ?? DEFAULT_ELEVENLABS_TTS_MODEL_ID,
        }),
      };
    case "gemini":
      return {
        tts: buildGeminiChatTtsDispatchOptions({
          modelId: geminiModelId ?? DEFAULT_GEMINI_TTS_MODEL_ID,
        }),
      };
    case "pocket_tts":
    case "browser":
      return { tts: { enabled: true, provider } };
    case null:
      return undefined;
  }
}
