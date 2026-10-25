import { describe, expect, it, vi } from "vitest";

import { composerSpeechEngines } from "./composer-speech-engines";
import type { RuntimePlatform } from "@/platform/runtime-platform";

// The saved TTS provider is taken as supported; support detection has its own tests.
vi.mock("./tts-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./tts-provider")>()),
  resolvePreferredTtsProvider: ({
    savedProvider,
  }: {
    savedProvider: string | null;
  }) => ({ provider: savedProvider, hasExplicitPreference: true }),
}));

const desktop = { kind: "desktop", isDesktop: true } as RuntimePlatform;
const installed = {
  offline_speech_enabled: true,
  offline_multilingual_speech_enabled: true,
};

describe("composer speech engine details", () => {
  it("names the UI Locale's offline engine on the CPU and TTS off", () => {
    expect(
      composerSpeechEngines({
        preferences: { speech: { stt_provider: "parakeet" } },
        platform: desktop,
        locale: "ja",
        capabilities: installed,
      }),
    ).toEqual({
      dictation: ["STT: SenseVoice CPU"],
      voiceMode: ["STT: SenseVoice CPU", "TTS: Off"],
    });
  });

  it("names the GPU variant and the enabled TTS provider", () => {
    expect(
      composerSpeechEngines({
        preferences: {
          speech: {
            stt_provider: "parakeet",
            stt_parakeet_webgpu: true,
            tts_enabled: true,
            tts_provider: "elevenlabs",
          },
        },
        platform: desktop,
        locale: "en",
        capabilities: installed,
      }),
    ).toEqual({
      dictation: ["STT: Parakeet GPU"],
      voiceMode: ["STT: Parakeet GPU", "TTS: ElevenLabs"],
    });
  });

  it("names nothing until runtime capabilities load", () => {
    expect(
      composerSpeechEngines({
        preferences: { speech: { stt_provider: "parakeet" } },
        platform: desktop,
        locale: "en",
        capabilities: undefined,
      }),
    ).toEqual({ dictation: null, voiceMode: null });
  });
});
