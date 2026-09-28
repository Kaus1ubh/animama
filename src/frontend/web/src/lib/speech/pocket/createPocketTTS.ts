"use client";

import { PocketTTSCore } from "@/lib/speech/pocket/index.js";
import {
  DEFAULT_POCKET_VOICE,
  POCKET_VOICES,
} from "@/lib/speech/pocket/voice-catalog";
import { pocketVoiceWorkerUrls } from "@/lib/speech/pocket/voice-downloads";
import {
  ensurePocketVoiceCloningEncoder,
  POCKET_VOICE_ENCODER_CONTENT_URL,
} from "./voice-cloning-encoder";

export function createPocketTTS() {
  return new PocketTTSCore({
    assetBaseUrl: "/tts",
    playbackStrategy: "adaptive",
    enableVoiceCloning: true,
    beforeVoiceEncode: ensurePocketVoiceCloningEncoder,
    voiceEncoderUrl: POCKET_VOICE_ENCODER_CONTENT_URL,
    // Downloadable voices load from the downloader's content route once installed.
    voices: POCKET_VOICES.map((voice) => voice.id),
    voiceUrls: pocketVoiceWorkerUrls(),
    defaultVoice: DEFAULT_POCKET_VOICE,
  });
}
