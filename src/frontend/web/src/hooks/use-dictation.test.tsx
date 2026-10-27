// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CreateAndStartMicVadArgs } from "@/hooks/voice/mic-vad-runtime";
import { useDictation } from "./use-dictation";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** A spoken window long enough to be accepted as speech (0.5 s at 16 kHz). */
const SPEECH_SAMPLES = 8000;

/** MicVAD stand-in: tests drive its callbacks as microphone audio would. */
class FakeMicVad {
  args: CreateAndStartMicVadArgs;
  windowOpen = false;
  submitOnPause = false;
  constructor(args: CreateAndStartMicVadArgs) {
    this.args = args;
  }
  speak() {
    this.windowOpen = true;
    this.args.onSpeechStart();
    this.args.onSpeechRealStart();
  }
  endSpeech() {
    this.windowOpen = false;
    this.args.onSpeechEnd(new Float32Array(SPEECH_SAMPLES).fill(0.1));
  }
  start = async () => {};
  pause = async () => {
    if (this.submitOnPause && this.windowOpen) this.endSpeech();
  };
  destroy = async () => {};
  setOptions = (update: { submitUserSpeechOnPause?: boolean }) => {
    this.submitOnPause = update.submitUserSpeechOnPause ?? this.submitOnPause;
  };
}

/** Web Speech stand-in with the stop/abort difference that matters here. */
class FakeRecognition {
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 1;
  onresult: ((event: unknown) => void) | null = null;
  onend: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onstart: (() => void) | null = null;
  stopCalls = 0;
  abortCalls = 0;
  /** What a graceful stop finalizes before ending; null finalizes nothing. */
  finalOnStop: string | null = null;
  private endListeners: ((event: unknown) => void)[] = [];
  constructor() {
    fixture.recognitions.push(this);
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    if (type === "end") this.endListeners.push(listener);
  }
  removeEventListener(type: string, listener: (event: unknown) => void) {
    if (type === "end")
      this.endListeners = this.endListeners.filter((l) => l !== listener);
  }
  start() {
    this.onstart?.();
  }
  stop() {
    this.stopCalls += 1;
    queueMicrotask(() => {
      if (this.finalOnStop) this.hear(this.finalOnStop, true);
      this.end();
    });
  }
  abort() {
    this.abortCalls += 1;
    queueMicrotask(() => this.end());
  }
  hear(transcript: string, isFinal: boolean) {
    const result = Object.assign([{ transcript, confidence: 0.9 }], {
      isFinal,
    });
    this.onresult?.({ resultIndex: 0, results: [result] });
  }
  private end() {
    const event = { type: "end" };
    this.onend?.(event);
    for (const listener of [...this.endListeners]) listener(event);
  }
}

const fixture = vi.hoisted(() => ({
  provider: "browser_external" as "browser_external" | "parakeet",
  vads: [] as FakeMicVad[],
  recognitions: [] as FakeRecognition[],
  predict: vi.fn(),
  transcribe: vi.fn(),
}));

vi.mock("@animama/product-ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@animama/product-ui")>()),
  useProductApiClient: () => ({}),
}));
vi.mock("@/query/runtime-capabilities", () => ({
  fetchRuntimeCapabilities: async () => ({}),
}));
vi.mock("@/platform/RuntimePlatformProvider", () => ({
  useRuntimePlatform: () => ({}),
}));
vi.mock("@/ui/settings/SettingsProvider", () => ({
  useSettings: () => ({ effectivePreferences: {} }),
}));
vi.mock("@/lib/speech/stt-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/speech/stt-provider")>()),
  getSpeechRecognitionConstructor: () => FakeRecognition,
  resolveRoutedSttProvider: () => ({
    provider: fixture.provider,
    parakeetAvailable: fixture.provider === "parakeet",
    languageMissing: false,
    hasExplicitPreference: true,
  }),
}));
vi.mock("@/lib/speech/offline-stt/clients", () => {
  const client = {
    cancelIdleDispose: async () => {},
    load: async () => ({ backend: "wasm", loadMs: 1, reused: false }),
    transcribe: (request: unknown) => fixture.transcribe(request),
    armIdleDispose: () => {},
  };
  return { offlineSttClients: { parakeet: client, sensevoice: client } };
});
vi.mock("@/hooks/voice/mic-vad-runtime", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/voice/mic-vad-runtime")>()),
  createAndStartMicVad: async (args: CreateAndStartMicVadArgs) => {
    const vad = new FakeMicVad(args);
    fixture.vads.push(vad);
    return vad;
  },
}));
vi.mock("@/lib/voice/smart-turn-worker-client", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/voice/smart-turn-worker-client")
  >()),
  loadSmartTurnWorker: async () => ({}),
  predictSmartTurn: (request: unknown) => fixture.predict(request),
  disposeSmartTurnWorker: async () => ({ disposed: true }),
}));

function smartTurnResult(decision: "end_turn" | "continue") {
  return {
    decision,
    probability: decision === "end_turn" ? 0.9 : 0.05,
    threshold: 0.2,
    latencyMs: 20,
    preprocessMs: 5,
    inferenceMs: 15,
    inputShape: [1, 80, 800],
    paddedLeadingSamples: 0,
    truncatedLeadingSamples: 0,
  };
}

const events = {
  segments: [] as string[],
  submitted: [] as {
    text: string;
    source: string;
    probability: number | null;
  }[],
  errors: [] as string[],
};
const result: { current: ReturnType<typeof useDictation> | null } = {
  current: null,
};
let root: Root;

function Harness() {
  result.current = useDictation({
    onSegment: (segment) => events.segments.push(segment.text),
    onError: (error) => events.errors.push(error.message),
    onVoiceAutoSubmit: (payload) => {
      events.submitted.push({
        text: payload.text,
        source: payload.source,
        probability: payload.probability,
      });
    },
  });
  return null;
}

function dictation() {
  if (!result.current) throw new Error("Harness is not mounted");
  return result.current;
}
const vad = () => fixture.vads.at(-1)!;
const recognition = () => fixture.recognitions.at(-1)!;

/** Let queued promise work (worker replies, stop events) run. */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("AudioWorkletNode", class {});
  fixture.provider = "browser_external";
  fixture.vads = [];
  fixture.recognitions = [];
  fixture.predict.mockReset();
  fixture.transcribe.mockReset();
  events.segments = [];
  events.submitted = [];
  events.errors = [];
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Harness />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Voice Mode with browser recognition", () => {
  it("sends the whole phrase as soon as its final result arrives after Smart Turn decides", async () => {
    fixture.predict.mockResolvedValue(smartTurnResult("end_turn"));
    await act(() => dictation().startDictation("voice"));

    act(() => {
      vad().speak();
      recognition().hear("tell me about the weather", false);
      vad().endSpeech();
    });
    await settle();
    expect(fixture.predict).toHaveBeenCalledTimes(1);
    expect(events.submitted).toEqual([]);

    act(() => recognition().hear("tell me about the weather", true));
    await settle();

    expect(events.errors).toEqual([]);
    expect(events.submitted).toEqual([
      {
        text: "tell me about the weather",
        source: "smart_turn_v3",
        probability: 0.9,
      },
    ]);
  });

  it("still sends the words when Smart Turn cannot decide", async () => {
    fixture.predict.mockRejectedValue(new Error("prediction timed out"));
    await act(() => dictation().startDictation("voice"));

    act(() => {
      vad().speak();
      recognition().hear("are you there", true);
      vad().endSpeech();
    });
    await settle();

    expect(events.submitted).toEqual([
      { text: "are you there", source: "acoustic_fallback", probability: null },
    ]);
  });
});

describe("stopping browser dictation", () => {
  it("keeps the phrase being spoken by letting the recognizer finalize it", async () => {
    await act(() => dictation().startDictation("dictation"));
    act(() => {
      vad().speak();
      recognition().hear("buy milk", false);
    });
    recognition().finalOnStop = "buy milk";

    await act(() => dictation().stopDictation());

    expect(recognition().stopCalls).toBe(1);
    expect(recognition().abortCalls).toBe(0);
    expect(events.segments).toEqual(["buy milk"]);
    expect(dictation().activeMode).toBeNull();
  });

  it("keeps words the recognizer never finalized", async () => {
    await act(() => dictation().startDictation("dictation"));
    act(() => {
      vad().speak();
      recognition().hear("buy milk", false);
    });

    await act(() => dictation().stopDictation());

    expect(events.segments).toEqual(["buy milk"]);
  });

  it("does not deliver the visible words again when switching to Voice Mode", async () => {
    fixture.predict.mockResolvedValue(smartTurnResult("continue"));
    await act(() => dictation().startDictation("dictation"));
    const dictating = recognition();
    act(() => {
      vad().speak();
      dictating.hear("hello there", false);
    });
    dictating.finalOnStop = "hello there";

    await act(() => dictation().switchMode("voice"));

    expect(dictating.abortCalls).toBe(1);
    expect(events.segments).toEqual([]);
    expect(dictation().activeMode).toBe("voice");
  });
});

describe("stopping offline dictation", () => {
  it("transcribes the open window and waits for it before stopping", async () => {
    fixture.provider = "parakeet";
    let finish!: (text: string) => void;
    fixture.transcribe.mockImplementation(
      (request: { runId: string; turnId: string; windowId: string }) =>
        new Promise((resolve) => {
          finish = (text) =>
            resolve({
              ...request,
              text,
              audioDurationMs: 500,
              transcribeMs: 30,
              metrics: {},
            });
        }),
    );
    await act(() => dictation().startDictation("dictation"));
    act(() => vad().speak());

    let stopped = false;
    let stopping!: Promise<void>;
    act(() => {
      stopping = dictation()
        .stopDictation()
        .then(() => {
          stopped = true;
        });
    });
    await settle();
    expect(fixture.transcribe).toHaveBeenCalledTimes(1);
    expect(stopped).toBe(false);

    await act(async () => {
      finish("call mom");
      await stopping;
    });

    expect(events.segments).toEqual(["call mom"]);
    expect(stopped).toBe(true);
    expect(dictation().activeMode).toBeNull();
  });
});
