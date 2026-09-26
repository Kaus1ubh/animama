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
    voices: POCKET_VOICES.map((voice) => voice.id),
    defaultVoice: DEFAULT_POCKET_VOICE,
  });
}
