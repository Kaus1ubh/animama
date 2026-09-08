"use client";

import { PocketTTSCore } from "@/lib/speech/pocket/index.js";

export function createPocketTTS() {
  return new PocketTTSCore({
    assetBaseUrl: "/tts",
    playbackStrategy: "adaptive",
    enableVoiceCloning: true,
  });
}
