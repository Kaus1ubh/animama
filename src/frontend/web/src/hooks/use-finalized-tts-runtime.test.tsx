// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  addSpeechPcmListener,
  type SpeechPcmTapEvent,
} from "@/lib/speech/speech-pcm-tap";
import { useFinalizedTtsRuntime } from "./use-finalized-tts-runtime";

/** A Web Audio stand-in whose clock the test moves. */
class FakeAudioContext {
  static current: FakeAudioContext | null = null;
  currentTime = 0;
  state = "running";
  sampleRate = 48_000;
  destination = {};
  constructor() {
    FakeAudioContext.current = this;
  }
  createGain() {
    return { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    return { duration: length / sampleRate, copyToChannel: vi.fn() };
  }
  createBufferSource() {
    return {
      buffer: null,
      onended: null,
      connect: vi.fn(),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
  }
  async resume() {}
  async close() {}
}

/** `seconds` of 24 kHz PCM, as the server sends it. */
const pcmBase64 = (seconds: number) =>
  Buffer.from(new Int16Array(Math.round(seconds * 24_000)).buffer).toString(
    "base64",
  );

let root: Root | null = null;
const latest = {
  current: null as ReturnType<typeof useFinalizedTtsRuntime> | null,
};

function Harness() {
  latest.current = useFinalizedTtsRuntime({});
  return null;
}

describe("useFinalizedTtsRuntime", () => {
  beforeEach(() => {
    vi.stubGlobal("AudioContext", FakeAudioContext);
    act(() => {
      root = createRoot(document.createElement("div"));
      root.render(<Harness />);
    });
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    vi.unstubAllGlobals();
  });

  it("taps each chunk as played, with gap silence and each part's text", async () => {
    const events: SpeechPcmTapEvent[] = [];
    const stop = addSpeechPcmListener((event) => events.push(event));

    await act(async () => {
      latest.current!.acceptAudioChunk("run-1", {
        audio_base64: pcmBase64(0.2),
        part_text: "Hello there.",
      });
    });
    const context = FakeAudioContext.current!;
    // The first chunk plays from 0.08 s to 0.28 s; the next part's audio
    // arrives late, at 0.5 s, so playback is silent in between.
    context.currentTime = 0.5;
    await act(async () => {
      latest.current!.acceptAudioChunk("run-1", {
        audio_base64: pcmBase64(0.2),
        part_text: "How are you?",
      });
      latest.current!.acceptAudioChunk("run-1", {
        audio_base64: pcmBase64(0.2),
      });
    });
    stop();

    expect(
      events.map((event) => ({
        sec: event.pcm.length / event.sampleRate,
        partText: event.partText,
        provider: event.provider,
      })),
    ).toEqual([
      { sec: 0.2, partText: "Hello there.", provider: "gemini" },
      { sec: expect.closeTo(0.24, 3), partText: undefined, provider: "gemini" },
      { sec: 0.2, partText: "How are you?", provider: "gemini" },
      { sec: 0.2, partText: undefined, provider: "gemini" },
    ]);
  });
});
