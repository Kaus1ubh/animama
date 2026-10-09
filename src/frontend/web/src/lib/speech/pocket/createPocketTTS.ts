"use client";

import type { Client } from "@animama/runtime-contracts/sdk";
import { publicResourceUrl } from "@/lib/resource-urls";

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

export function createPocketTTS(apiClient: Client) {
  return new PocketTTSCore({
    assetBaseUrl: publicResourceUrl("tts"),
    playbackStrategy: "adaptive",
    enableVoiceCloning: true,
    beforeVoiceEncode: (
      options: Parameters<typeof ensurePocketVoiceCloningEncoder>[1],
    ) => ensurePocketVoiceCloningEncoder(apiClient, options),
    voiceEncoderUrl: POCKET_VOICE_ENCODER_CONTENT_URL,
    // Downloadable voices load from the downloader's content route once installed.
    voices: POCKET_VOICES.map((voice) => voice.id),
    voiceUrls: pocketVoiceWorkerUrls(),
    defaultVoice: DEFAULT_POCKET_VOICE,
  });
}
