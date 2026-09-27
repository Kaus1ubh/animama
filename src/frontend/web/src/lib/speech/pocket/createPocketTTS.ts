"use client";

import { PocketTTSCore } from "@/lib/speech/pocket/index.js";
import {
  DEFAULT_POCKET_VOICE,
  POCKET_VOICES,
} from "@/lib/speech/pocket/voice-catalog";

export function createPocketTTS() {
  return new PocketTTSCore({
    assetBaseUrl: "/tts",
    playbackStrategy: "adaptive",
    enableVoiceCloning: true,
    // Downloadable voices join once installed (Phase 7 of the voice plan).
    voices: POCKET_VOICES.filter((voice) => voice.delivery === "core").map(
      (voice) => voice.id,
    ),
    defaultVoice: DEFAULT_POCKET_VOICE,
  });
}
