import { beforeEach, describe, expect, it, vi } from "vitest";

import { client as testApiClient } from "@animama/runtime-contracts/default-client";
import { VoiceSampleError } from "@/lib/speech/pocket/voice-sample-player";
import {
  filteredGeminiVoices,
  GEMINI_VOICE_DETAILS,
  type GeminiVoice,
  geminiVoiceSampleSource,
  loadGeminiVoiceSample,
} from "./gemini-voices";

const sdk = vi.hoisted(() => ({ getSample: vi.fn() }));
vi.mock("@animama/runtime-contracts/sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@animama/runtime-contracts/sdk")>()),
  getGeminiVoiceSampleV1GeminiVoicesVoiceSampleGet: sdk.getSample,
}));

describe("Gemini voice catalog", () => {
  it("knows every prebuilt voice's gender and description", () => {
    const details = Object.values(GEMINI_VOICE_DETAILS);
    expect(details).toHaveLength(30);
    expect(details.filter((voice) => voice?.gender === "female")).toHaveLength(
      14,
    );
    expect(GEMINI_VOICE_DETAILS.Puck).toEqual({
      gender: "male",
      description: "upbeat",
    });
  });

  it("filters offered voices by gender tab and by name or description", () => {
    // A newer backend may offer a voice this catalog does not know yet.
    const offered = ["Kore", "Puck", "Leda", "Newvoice"] as GeminiVoice[];
    expect(
      filteredGeminiVoices(offered, { gender: "any", search: "" }),
    ).toEqual(offered);
    expect(
      filteredGeminiVoices(offered, { gender: "female", search: "" }),
    ).toEqual(["Kore", "Leda"]);
    expect(
      filteredGeminiVoices(offered, { gender: "male", search: "" }),
    ).toEqual(["Puck"]);
    expect(
      filteredGeminiVoices(offered, { gender: "any", search: " UPBEAT " }),
    ).toEqual(["Puck"]);
    expect(
      filteredGeminiVoices(offered, { gender: "any", search: "new" }),
    ).toEqual(["Newvoice"]);
  });
});

describe("Gemini voice samples", () => {
  beforeEach(() => sdk.getSample.mockReset());

  it("asks the backend for the voice with the selected model as admitted bytes", async () => {
    const blob = new Blob(["RIFF"], { type: "audio/wav" });
    sdk.getSample.mockResolvedValue({
      data: blob,
      response: new Response(null, { status: 200 }),
    });
    const signal = new AbortController().signal;

    const source = geminiVoiceSampleSource(
      testApiClient,
      "gemini-3.8-flash-tts",
      "Puck",
    );
    expect(source).toMatchObject({ id: "Puck", name: "Puck" });
    if (!("loadSample" in source)) throw new Error("expected a loader");
    await expect(source.loadSample(signal)).resolves.toBe(blob);

    expect(sdk.getSample).toHaveBeenCalledWith(
      expect.objectContaining({
        client: testApiClient,
        path: { voice: "Puck" },
        query: { model_id: "gemini-3.8-flash-tts" },
        signal,
        parseAs: "blob",
        credentials: "same-origin",
        throwOnError: false,
      }),
    );
  });

  it("shows the backend's message when a sample cannot be made", async () => {
    sdk.getSample.mockResolvedValue({
      error: {
        detail: {
          code: "gemini_tts_missing_credential",
          message: "Gemini text-to-speech needs a Gemini API key.",
        },
      },
      response: new Response(null, { status: 503 }),
    });

    const failure = loadGeminiVoiceSample(
      testApiClient,
      "Kore",
      "gemini-3.8-flash-lite-tts",
    );
    await expect(failure).rejects.toBeInstanceOf(VoiceSampleError);
    await expect(failure).rejects.toThrow(
      "Gemini text-to-speech needs a Gemini API key.",
    );
  });

  it("keeps a lost connection a connection error", async () => {
    sdk.getSample.mockResolvedValue({
      error: new TypeError("Failed to fetch"),
      response: undefined,
    });

    const failure = loadGeminiVoiceSample(
      testApiClient,
      "Kore",
      "gemini-3.8-flash-lite-tts",
    );
    await expect(failure).rejects.toThrow("Failed to fetch");
    await expect(failure).rejects.not.toBeInstanceOf(VoiceSampleError);
  });
});
