import { describe, expect, it } from "vitest";

import {
  convertElevenLabsPcm16ToFloat32,
  decodeElevenLabsBase64Pcm,
} from "@/hooks/use-elevenlabs-finalized-tts-runtime";
import { buildDirectElevenLabsRealtimeWsUrl } from "@/hooks/use-elevenlabs-tts-runtime";
import {
  isElevenLabsFinalizedTtsModelId,
  isElevenLabsRealtimeTtsModelId,
  toElevenLabsTtsModelId,
} from "@/lib/settings/preferences";

describe("ElevenLabs realtime TTS runtime", () => {
  it("builds Text to Dialogue websocket URLs from the provided session", () => {
    const url = buildDirectElevenLabsRealtimeWsUrl({
      voice_id: "voice/custom",
      model_id: "eleven_v4_turbo",
      output_format: "pcm_24000",
      sync_alignment: false,
      language_code: "en",
      token: "single use token",
      websocket_base_url: "wss://example.elevenlabs.test",
    });

    // The dialogue socket names its voice in the first message, not the path.
    expect(url).toContain(
      "wss://example.elevenlabs.test/v1/text-to-dialogue/stream-input?",
    );
    expect(url).not.toContain("voice%2Fcustom");
    expect(url).toContain("model_id=eleven_v4_turbo");
    expect(url).toContain("output_format=pcm_24000");
    expect(url).toContain("sync_alignment=false");
    expect(url).toContain("language_code=en");
    expect(url).toContain("single_use_token=single+use+token");
  });
});

describe("ElevenLabs TTS model helpers", () => {
  it("classifies v3 as finalized and v4 Turbo as realtime", () => {
    expect(toElevenLabsTtsModelId("eleven_v3")).toBe("eleven_v3");
    expect(isElevenLabsFinalizedTtsModelId("eleven_v3")).toBe(true);
    expect(isElevenLabsRealtimeTtsModelId("eleven_v3")).toBe(false);
    expect(isElevenLabsRealtimeTtsModelId("eleven_v4_turbo")).toBe(true);
  });
});

describe("ElevenLabs finalized TTS runtime helpers", () => {
  it("decodes base64 PCM into Int16 samples", () => {
    expect(Array.from(decodeElevenLabsBase64Pcm("AQACAA=="))).toEqual([1, 2]);
  });

  it("converts Int16 PCM into normalized Float32 samples", () => {
    const samples = convertElevenLabsPcm16ToFloat32(
      new Int16Array([-32768, -16384, 0, 16384, 32767]),
    );

    expect(Array.from(samples)).toEqual([-1, -0.5, 0, 0.5, 32767 / 32768]);
  });
});
