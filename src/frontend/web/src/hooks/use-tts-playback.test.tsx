// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_POCKET_VOICE } from "@/lib/speech/pocket/voice-catalog";
import {
  addSpeechUtteranceListener,
  type SpeechUtteranceEvent,
} from "@/lib/speech/speech-pcm-tap";
import type { PocketAnimaVoiceSelectionContext } from "@/lib/speech/pocket/anima-voice-selection";
import { useTtsPlayback } from "./use-tts-playback";

type CoreHandler = (event: { detail?: unknown }) => void;

const fixture = vi.hoisted(() => {
  const coreHandlers = new Map<string, Set<CoreHandler>>();
  /** The downloader's voice list: "anna" is installed, once it is read. */
  const downloads = (status: "unknown" | "installed") => ({
    availability: (voiceId: string) =>
      voiceId === "anna" ? { status, assetId: "pocket-voice-anna" } : null,
    install: vi.fn(),
  });
  return {
    pocketSupported: true,
    ttsMuted: false,
    speech: {} as Record<string, unknown>,
    platform: { isDesktop: false },
    toast: { error: vi.fn(), warning: vi.fn() },
    coreHandlers,
    downloadsEnabled: [] as boolean[],
    unreadDownloads: downloads("unknown"),
    readDownloads: downloads("installed"),
    pocket: {
      warmup: vi.fn(async () => undefined),
      preloadAnimaVoices: vi.fn(async () => undefined),
      stop: vi.fn(),
      generateAndWait: vi.fn<
        (text: string, options?: Record<string, unknown>) => Promise<void>
      >(async () => undefined),
      endStream: vi.fn(),
      setVolume: vi.fn(),
      getAudioContext: vi.fn(() => null),
      onCoreEvent: vi.fn((name: string, handler: CoreHandler) => {
        const handlers = coreHandlers.get(name) ?? new Set<CoreHandler>();
        handlers.add(handler);
        coreHandlers.set(name, handlers);
        return () => handlers.delete(handler);
      }),
      hasCustomVoice: false,
      voices: ["eve", "azelma", "anna"],
    },
    realtime: {
      startRun: vi.fn(async () => undefined),
      startSessionWait: vi.fn(),
      acceptSession: vi.fn(),
      markSessionFailed: vi.fn(),
      appendText: vi.fn(),
      completeRun: vi.fn(),
      stop: vi.fn(),
      setVolume: vi.fn(),
    },
    // The callbacks the realtime runtime reports audio through.
    realtimeOptions: null as null | {
      onAudioStarted?: (event: {
        runId: string;
        provider: "elevenlabs";
        audioStartSec?: number | null;
        audioContext?: AudioContext | null;
      }) => void;
      onSpeechTiming?: (event: {
        runId: string;
        provider: "elevenlabs";
        chars: Array<{ char: string; startSec: number; endSec: number }>;
      }) => void;
    },
    // The callbacks the finalized runtime reports pushed audio through.
    finalizedOptions: null as null | {
      onAudioStarted?: (event: {
        runId: string;
        audioContext: AudioContext;
        audioStartSec: number;
      }) => void;
      onAudioEnded?: (event: {
        runId: string;
        reason: "natural" | "error";
      }) => void;
      onAudioDurationResolved?: (event: {
        runId: string;
        audioDurationSec: number;
      }) => void;
    },
    finalized: {
      prepareRun: vi.fn(),
      acceptAudioChunk: vi.fn(),
      finishPushedStream: vi.fn(),
      failPushedStream: vi.fn(),
      stop: vi.fn(),
      setVolume: vi.fn(),
    },
  };
});

vi.mock("sonner", () => ({ toast: fixture.toast }));
vi.mock("@/lib/logger", () => {
  const ignore = () => undefined;
  return {
    createLogger: () => ({
      info: ignore,
      debug: ignore,
      warn: ignore,
      error: ignore,
    }),
  };
});
vi.mock("@/hooks/use-pocket-tts-runtime", () => ({
  usePocketTtsRuntime: () => fixture.pocket,
}));
vi.mock("@/hooks/use-elevenlabs-tts-runtime", () => ({
  useElevenLabsTtsRuntime: (options: typeof fixture.realtimeOptions) => {
    fixture.realtimeOptions = options;
    return fixture.realtime;
  },
}));
vi.mock("@/hooks/use-finalized-tts-runtime", () => ({
  useFinalizedTtsRuntime: (options: typeof fixture.finalizedOptions) => {
    fixture.finalizedOptions = options;
    return fixture.finalized;
  },
}));
vi.mock("@/hooks/use-pocket-voice-downloads", () => ({
  usePocketVoiceDownloads: ({ enabled }: { enabled: boolean }) => {
    fixture.downloadsEnabled.push(enabled);
    return enabled ? fixture.readDownloads : fixture.unreadDownloads;
  },
}));
vi.mock("@/hooks/use-sound-controller", () => ({
  useSoundController: () => ({
    masterMuted: false,
    ttsMuted: fixture.ttsMuted,
    ttsVolume: 0.8,
  }),
}));
vi.mock("@/platform/RuntimePlatformProvider", () => ({
  useRuntimePlatform: () => fixture.platform,
}));
vi.mock("@/ui/settings/SettingsProvider", () => ({
  useSettings: () => ({
    effectivePreferences: { speech: fixture.speech },
    settingsLoaded: true,
  }),
}));
vi.mock("@/lib/speech/tts-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/speech/tts-provider")>()),
  isPocketTtsSupported: () => fixture.pocketSupported,
  isElevenLabsTtsSupported: () => true,
  isGeminiTtsSupported: () => true,
  resolvePreferredTtsProvider: ({
    savedProvider,
    offers,
  }: {
    savedProvider?: string | null;
    offers?: { gemini?: boolean };
  }) => ({
    // Like the real resolver, a saved Gemini needs the composition's offer (the
    // real one then falls back to another provider).
    provider:
      savedProvider === "gemini" && !offers?.gemini
        ? null
        : (savedProvider ?? null),
    hasExplicitPreference: Boolean(savedProvider),
  }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const ANIMA_ID = "anima-1";
const allowanceError = {
  code: "speech_allowance_exhausted",
  error: "This month's voice allowance is used up.",
};

type Playback = ReturnType<typeof useTtsPlayback>;

let root: Root | null = null;

/** Mount the hook for an Anima whose owner chose ElevenLabs with `modelId`. */
function renderPlayback({
  modelId = "eleven_v4_turbo",
  mountedVoice = null,
}: {
  modelId?: string;
  mountedVoice?: PocketAnimaVoiceSelectionContext["mountedVoice"];
} = {}) {
  fixture.speech = {
    tts_enabled: true,
    tts_provider: "elevenlabs",
    tts_elevenlabs_model_id: modelId,
    ...fixture.speech,
  };
  const onAudioStarted = vi.fn();
  const onAudioEnded = vi.fn();
  const onAudioDurationResolved = vi.fn();
  const onSpeechText = vi.fn();
  const latest = { current: null as unknown as Playback };
  function Harness() {
    latest.current = useTtsPlayback({
      onAudioStarted,
      onAudioEnded,
      onAudioDurationResolved,
      onSpeechText,
      geminiTtsOffered: true,
      getPocketVoiceSelectionContext: () => ({
        animaId: ANIMA_ID,
        emotionLabel: "neutral",
        emotionIntensity: 1,
        animaVoiceCatalogUrl: null,
        mountedVoice,
      }),
      getSpeechVoiceSelectionContext: () => ({ animaId: ANIMA_ID, modelId }),
    });
    return null;
  }
  act(() => {
    root = createRoot(document.createElement("div"));
    root.render(<Harness />);
  });
  // The hook's callbacks change identity when its audio state re-renders it.
  const playback = () => latest.current;
  return {
    playback,
    onAudioStarted,
    onAudioEnded,
    onAudioDurationResolved,
    onSpeechText,
  };
}

function emitPocketEvent(name: string, detail: Record<string, unknown>) {
  act(() => {
    for (const handler of fixture.coreHandlers.get(name) ?? []) {
      handler({ detail });
    }
  });
}

describe("speaking a declined ElevenLabs reply with Pocket TTS", () => {
  beforeEach(() => {
    fixture.pocketSupported = true;
    fixture.ttsMuted = false;
    fixture.speech = {};
    fixture.realtimeOptions = null;
    fixture.coreHandlers.clear();
    fixture.downloadsEnabled.length = 0;
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
  });

  it("speaks a reply declined before its text as a Pocket run, without a notice", () => {
    const { playback, onAudioStarted, onAudioEnded } = renderPlayback();
    act(() => playback().startRun("run-1"));
    expect(fixture.realtime.startRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ animaId: ANIMA_ID }),
    );
    fixture.realtime.stop.mockClear();

    let switched = false;
    act(() => {
      switched = playback().fallBackToPocketTts("run-1");
    });
    expect(switched).toBe(true);
    // The pending ElevenLabs session closes quietly instead of failing.
    expect(fixture.realtime.stop).toHaveBeenCalledTimes(1);
    expect(fixture.realtime.markSessionFailed).not.toHaveBeenCalled();
    expect(fixture.pocket.warmup).toHaveBeenCalled();
    // A late ElevenLabs descriptor for the run no longer opens speech.
    act(() =>
      playback().acceptElevenLabsSession("run-1", {
        voice_id: "voice-1",
        model_id: "eleven_v4_turbo",
        output_format: "pcm_24000",
        sync_alignment: false,
        transport: "server",
        websocket_url: "/v1/voice/streams/run-1",
      }),
    );
    expect(fixture.realtime.acceptSession).not.toHaveBeenCalled();

    act(() => {
      playback().appendToken(
        "run-1",
        "This first sentence is long enough to stream. ",
      );
      playback().appendToken("run-1", "Then the reply ends.");
    });
    // Like any Pocket run, the reply is spoken once its text is complete.
    expect(fixture.realtime.appendText).not.toHaveBeenCalled();
    expect(fixture.pocket.generateAndWait).not.toHaveBeenCalled();

    act(() => playback().completeRun("run-1"));
    expect(fixture.pocket.generateAndWait).toHaveBeenCalledTimes(1);
    expect(fixture.pocket.generateAndWait).toHaveBeenCalledWith(
      "This first sentence is long enough to stream. Then the reply ends.",
      expect.objectContaining({
        voice: DEFAULT_POCKET_VOICE,
        animaId: ANIMA_ID,
        animaVoiceKey: "neutral",
        endStream: true,
      }),
    );

    // Avatar speech follows the Pocket audio of the fallback run.
    emitPocketEvent("playback_started", { generationId: "g-1", startTime: 1 });
    expect(onAudioStarted).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", provider: "pocket_tts" }),
    );
    emitPocketEvent("playback_ended", { generationId: "g-1" });
    expect(onAudioEnded).toHaveBeenCalledWith({
      runId: "run-1",
      provider: "pocket_tts",
      reason: "natural",
    });
    expect(fixture.toast.error).not.toHaveBeenCalled();
    expect(fixture.toast.warning).not.toHaveBeenCalled();
  });

  it("ends a Pocket reply that has nothing to say", () => {
    fixture.speech = { tts_provider: "pocket_tts" };
    const { playback, onAudioEnded } = renderPlayback();
    act(() => {
      playback().startRun("run-1");
      playback().appendToken("run-1", "😊 [laughs]");
      playback().completeRun("run-1");
    });
    // Nothing is left to speak once tags and emoji go, so Pocket is not
    // asked to generate and the reply ends at once.
    expect(fixture.pocket.generateAndWait).not.toHaveBeenCalled();
    expect(onAudioEnded).toHaveBeenCalledWith({
      runId: "run-1",
      provider: "pocket_tts",
      reason: "natural",
    });
  });

  it("speaks a reply declined after its text with the Anima's Pocket voice", () => {
    const assertActive = vi.fn();
    const { playback } = renderPlayback({
      mountedVoice: { catalogUrl: "blob:anima-voice", assertActive },
    });
    act(() => {
      playback().startRun("run-1");
      playback().appendToken("run-1", "Hi there. ");
      playback().appendToken("run-1", "Nice to meet you.");
      playback().completeRun("run-1");
    });
    // The realtime run owns the reply until the server declines its speech.
    expect(fixture.pocket.generateAndWait).not.toHaveBeenCalled();

    let switched = false;
    act(() => {
      switched = playback().fallBackToPocketTts("run-1");
    });
    expect(switched).toBe(true);
    expect(fixture.realtime.markSessionFailed).not.toHaveBeenCalled();
    expect(fixture.pocket.generateAndWait).toHaveBeenCalledTimes(1);
    const [text, options] = fixture.pocket.generateAndWait.mock.calls[0];
    expect(text).toBe("Hi there. Nice to meet you.");
    expect(options).toMatchObject({
      animaVoiceKey: "neutral",
      assertAnimaCatalogActive: assertActive,
      endStream: true,
    });
    expect(options?.voice).toBeUndefined();
    expect(String(options?.animaId)).toContain(
      encodeURIComponent("blob:anima-voice"),
    );
    expect(fixture.toast.error).not.toHaveBeenCalled();

    // A repeated decline for the same run neither restarts nor re-speaks it.
    act(() => {
      switched = playback().fallBackToPocketTts("run-1");
    });
    expect(switched).toBe(true);
    expect(fixture.pocket.generateAndWait).toHaveBeenCalledTimes(1);
  });

  it("speaks the whole reply when realtime text already went to ElevenLabs", () => {
    const { playback } = renderPlayback();
    act(() => {
      playback().startRun("run-1");
      playback().appendToken(
        "run-1",
        "This first sentence is long enough to stream. ",
      );
    });
    expect(fixture.realtime.appendText).toHaveBeenCalled();

    act(() => {
      playback().fallBackToPocketTts("run-1");
      playback().appendToken("run-1", "Then the rest arrives.");
      playback().completeRun("run-1");
    });
    expect(fixture.realtime.completeRun).not.toHaveBeenCalled();
    expect(fixture.pocket.generateAndWait).toHaveBeenCalledWith(
      "This first sentence is long enough to stream. Then the rest arrives.",
      expect.objectContaining({ endStream: true }),
    );
  });

  it("speaks a realtime reply declined after its session and text were accepted", () => {
    const { playback } = renderPlayback();
    act(() => {
      playback().startRun("run-1");
      playback().acceptElevenLabsSession("run-1", {
        voice_id: "voice-1",
        model_id: "eleven_v4_turbo",
        output_format: "pcm_24000",
        sync_alignment: false,
        transport: "server",
        websocket_url: "/v1/voice/streams/run-1",
      });
      playback().appendToken(
        "run-1",
        "This first sentence is long enough to stream. ",
      );
      playback().appendToken("run-1", "Then the reply ends.");
      playback().completeRun("run-1");
    });
    expect(fixture.realtime.acceptSession).toHaveBeenCalledTimes(1);
    expect(fixture.realtime.completeRun).toHaveBeenCalledTimes(1);
    expect(fixture.pocket.generateAndWait).not.toHaveBeenCalled();
    fixture.realtime.stop.mockClear();

    // The server declines while reserving the reply's speech; no audio played.
    let switched = false;
    act(() => {
      switched = playback().fallBackToPocketTts("run-1");
    });
    expect(switched).toBe(true);
    expect(fixture.realtime.stop).toHaveBeenCalledTimes(1);
    expect(fixture.realtime.markSessionFailed).not.toHaveBeenCalled();
    expect(fixture.pocket.generateAndWait).toHaveBeenCalledWith(
      "This first sentence is long enough to stream. Then the reply ends.",
      expect.objectContaining({ endStream: true }),
    );
    expect(fixture.toast.error).not.toHaveBeenCalled();
  });

  it("uses the Anima's downloadable Pocket voice once its install state is read", () => {
    fixture.speech = { tts_pocket_anima_voice: "anna" };
    const { playback } = renderPlayback();
    // ElevenLabs owners do not read the voice download list until a fallback.
    expect(fixture.downloadsEnabled).not.toContain(true);
    act(() => playback().startRun("run-1"));
    // The session keeps the callbacks from the render that started the run.
    const { appendToken, completeRun, fallBackToPocketTts } = playback();

    act(() => {
      fallBackToPocketTts("run-1");
      appendToken("run-1", "Hello.");
    });
    expect(fixture.downloadsEnabled.at(-1)).toBe(true);
    act(() => completeRun("run-1"));
    expect(fixture.pocket.generateAndWait).toHaveBeenCalledWith(
      "Hello.",
      expect.objectContaining({ voice: "anna" }),
    );
    expect(fixture.readDownloads.install).not.toHaveBeenCalled();
  });

  it("stays quiet about the owner's saved Pocket voice", () => {
    // A selected but never uploaded custom voice warns on a chosen Pocket run.
    fixture.speech = { tts_pocket_voice: "custom" };
    const { playback } = renderPlayback();
    act(() => {
      playback().startRun("run-1");
      playback().fallBackToPocketTts("run-1");
      playback().appendToken("run-1", "Hello.");
      playback().completeRun("run-1");
    });
    expect(fixture.pocket.generateAndWait).toHaveBeenCalledWith(
      "Hello.",
      expect.objectContaining({ animaId: ANIMA_ID }),
    );
    expect(fixture.toast.error).not.toHaveBeenCalled();
    expect(fixture.toast.warning).not.toHaveBeenCalled();
  });

  it("keeps the failure path where Pocket TTS cannot run", () => {
    fixture.pocketSupported = false;
    const { playback } = renderPlayback();
    act(() => playback().startRun("run-1"));
    fixture.realtime.stop.mockClear();

    let switched = true;
    act(() => {
      switched = playback().fallBackToPocketTts("run-1");
    });
    expect(switched).toBe(false);
    expect(fixture.realtime.stop).not.toHaveBeenCalled();
    expect(fixture.pocket.warmup).not.toHaveBeenCalled();

    // The session then reports the decline as before.
    act(() => playback().markElevenLabsSessionFailed("run-1", allowanceError));
    expect(fixture.realtime.markSessionFailed).toHaveBeenCalledWith(
      "run-1",
      allowanceError,
    );
  });

  it("never switches a run after its audio started, after Stop, or once replaced", () => {
    const { playback } = renderPlayback();
    act(() => playback().startRun("run-1"));
    act(() =>
      fixture.realtimeOptions?.onAudioStarted?.({
        runId: "run-1",
        provider: "elevenlabs",
        audioStartSec: 0,
        audioContext: null,
      }),
    );
    expect(playback().fallBackToPocketTts("run-1")).toBe(false);

    act(() => playback().startRun("run-2"));
    act(() => playback().cancelAll());
    expect(playback().fallBackToPocketTts("run-2")).toBe(false);

    act(() => playback().startRun("run-3"));
    expect(playback().fallBackToPocketTts("run-2")).toBe(false);
    expect(fixture.pocket.warmup).not.toHaveBeenCalled();
  });

  it("returns the next run to the owner's ElevenLabs voice", () => {
    const { playback } = renderPlayback();
    act(() => {
      playback().startRun("run-1");
      playback().fallBackToPocketTts("run-1");
      playback().startRun("run-2");
      playback().appendToken(
        "run-2",
        "This next sentence is long enough to stream. ",
      );
      playback().completeRun("run-2");
    });
    expect(fixture.realtime.startRun).toHaveBeenLastCalledWith(
      "run-2",
      expect.objectContaining({ animaId: ANIMA_ID }),
    );
    expect(fixture.realtime.appendText).toHaveBeenCalledWith(
      "run-2",
      expect.any(String),
      expect.objectContaining({ animaId: ANIMA_ID }),
    );
    expect(fixture.realtime.completeRun).toHaveBeenCalledWith(
      "run-2",
      expect.objectContaining({ animaId: ANIMA_ID }),
    );
    expect(fixture.pocket.generateAndWait).not.toHaveBeenCalled();
  });

  it("speaks the fallback at the owner's text-to-speech volume, including mute", () => {
    fixture.ttsMuted = true;
    const { playback } = renderPlayback();
    act(() => {
      playback().startRun("run-1");
      playback().fallBackToPocketTts("run-1");
      playback().appendToken("run-1", "Hello.");
      playback().completeRun("run-1");
    });
    expect(fixture.pocket.generateAndWait).toHaveBeenCalledTimes(1);
    // Pocket's output follows the owner's text-to-speech volume, here muted.
    expect(fixture.pocket.setVolume).toHaveBeenCalled();
    expect(fixture.pocket.setVolume.mock.calls).toEqual(
      fixture.pocket.setVolume.mock.calls.map(() => [0]),
    );
  });
});

describe("ElevenLabs character timing", () => {
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
  });

  it("forwards the realtime runtime's timing for lip-sync", () => {
    fixture.speech = { tts_provider: "elevenlabs" };
    const onSpeechTiming = vi.fn();
    function Harness() {
      useTtsPlayback({ onSpeechTiming });
      return null;
    }
    act(() => {
      root = createRoot(document.createElement("div"));
      root.render(<Harness />);
    });

    const event = {
      runId: "run-1",
      provider: "elevenlabs" as const,
      chars: [{ char: "H", startSec: 0, endSec: 0.08 }],
    };
    act(() => fixture.realtimeOptions?.onSpeechTiming?.(event));

    expect(onSpeechTiming).toHaveBeenCalledWith(event);
  });
});

describe("ElevenLabs session wait", () => {
  beforeEach(() => {
    fixture.speech = {};
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
  });

  it("starts when the run's response starts, not when the run starts", () => {
    const { playback } = renderPlayback();
    act(() => playback().startRun("run-1"));
    expect(fixture.realtime.startSessionWait).not.toHaveBeenCalled();

    act(() => playback().markStreamStarted("run-1"));
    expect(fixture.realtime.startSessionWait).toHaveBeenCalledWith("run-1");
  });
});

describe("playing Gemini audio the server pushes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.pocketSupported = true;
    fixture.ttsMuted = false;
    fixture.speech = { tts_provider: "gemini" };
    fixture.realtimeOptions = null;
    fixture.finalizedOptions = null;
    fixture.coreHandlers.clear();
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
  });

  const audio = {
    run_id: "run-1",
    model_id: "gemini-3.8-flash-lite-tts",
    output_format: "pcm_24000",
    audio_base64: "AAA=",
  };

  it("waits for pushed audio instead of streaming text to a provider", () => {
    const { playback } = renderPlayback({
      modelId: "gemini-3.8-flash-lite-tts",
    });
    act(() => {
      playback().startRun("run-1");
      playback().appendToken("run-1", "Hello there. How are you?");
      playback().completeRun("run-1");
    });

    expect(fixture.finalized.prepareRun).toHaveBeenCalledWith("run-1");
    expect(fixture.realtime.startRun).not.toHaveBeenCalled();
    expect(fixture.realtime.appendText).not.toHaveBeenCalled();
    expect(fixture.realtime.completeRun).not.toHaveBeenCalled();
    expect(fixture.pocket.generateAndWait).not.toHaveBeenCalled();
  });

  it("plays, finishes and fails the pushed stream", () => {
    const { playback } = renderPlayback({
      modelId: "gemini-3.8-flash-tts",
    });
    act(() => {
      playback().startRun("run-1");
      playback().acceptFinalizedAudio("run-1", audio);
      playback().completeFinalizedAudio("run-1");
      playback().markFinalizedAudioFailed("run-1", "voice error");
    });

    expect(fixture.finalized.acceptAudioChunk).toHaveBeenCalledWith(
      "run-1",
      audio,
    );
    expect(fixture.finalized.finishPushedStream).toHaveBeenCalledWith("run-1");
    expect(fixture.finalized.failPushedStream).toHaveBeenCalledWith(
      "run-1",
      "voice error",
    );
  });

  it("reports its audio as Gemini, so lip-sync follows it", () => {
    const { playback, onAudioStarted, onAudioEnded, onAudioDurationResolved } =
      renderPlayback({
        modelId: "gemini-3.8-flash-lite-tts",
      });
    act(() => {
      playback().startRun("run-1");
      fixture.finalizedOptions?.onAudioStarted?.({
        runId: "run-1",
        audioContext: {} as AudioContext,
        audioStartSec: 0.5,
      });
      fixture.finalizedOptions?.onAudioDurationResolved?.({
        runId: "run-1",
        audioDurationSec: 1.5,
      });
      fixture.finalizedOptions?.onAudioEnded?.({
        runId: "run-1",
        reason: "natural",
      });
    });

    expect(onAudioStarted).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", provider: "gemini" }),
    );
    expect(onAudioDurationResolved).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        provider: "gemini",
        audioDurationSec: 1.5,
      }),
    );
    expect(onAudioEnded).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1", provider: "gemini" }),
    );
  });

  it("does not prepare Gemini playback without the composition's offer", () => {
    fixture.speech = { tts_provider: "gemini" };
    const latest = { current: null as unknown as Playback };
    function Harness() {
      latest.current = useTtsPlayback({
        getSpeechVoiceSelectionContext: () => ({
          animaId: ANIMA_ID,
          modelId: "gemini-3.8-flash-lite-tts",
        }),
      });
      return null;
    }
    act(() => {
      root = createRoot(document.createElement("div"));
      root.render(<Harness />);
    });
    act(() => {
      latest.current.startRun("run-1");
      latest.current.acceptFinalizedAudio("run-1", audio);
    });
    expect(fixture.finalized.prepareRun).not.toHaveBeenCalled();
    expect(fixture.finalized.acceptAudioChunk).not.toHaveBeenCalled();
  });
});

describe("browser speech", () => {
  /** A voice that records its utterances and speaks only when told. */
  class FakeUtterance {
    static spoken: FakeUtterance[] = [];
    volume = 1;
    onstart: (() => void) | null = null;
    onboundary: ((event: { name?: string; charIndex: number }) => void) | null =
      null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    text: string;
    constructor(text: string) {
      this.text = text;
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();
    FakeUtterance.spoken = [];
    fixture.speech = { tts_provider: "browser" };
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    vi.stubGlobal("speechSynthesis", {
      speak: (utterance: FakeUtterance) => FakeUtterance.spoken.push(utterance),
      cancel: vi.fn(),
      getVoices: () => [],
    });
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    vi.unstubAllGlobals();
  });

  it("reports each utterance and its words for lip-sync, on the performance clock", () => {
    const events: SpeechUtteranceEvent[] = [];
    const stop = addSpeechUtteranceListener((event) => events.push(event));
    const { playback, onAudioStarted } = renderPlayback();
    act(() => {
      playback().startRun("run-1");
      playback().appendToken("run-1", "Hello there.");
      playback().completeRun("run-1");
    });
    const utterance = FakeUtterance.spoken[0]!;
    act(() => {
      utterance.onstart?.();
      utterance.onboundary?.({ name: "word", charIndex: 6 });
      utterance.onboundary?.({ name: "sentence", charIndex: 0 });
      utterance.onend?.();
    });
    stop();

    expect(events.map((event) => event.type)).toEqual([
      "start",
      "boundary",
      "end",
    ]);
    expect(events[0]).toMatchObject({ runId: "run-1", text: "Hello there." });
    expect(events[1]).toMatchObject({ charIndex: 6 });
    const start = events[0]!.atSec;
    expect(onAudioStarted).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        provider: "browser",
        audioStartSec: start,
      }),
    );
    const clock = onAudioStarted.mock.calls[0]![0].audioContext as AudioContext;
    expect(clock.currentTime).toBeGreaterThanOrEqual(start);
  });

  it("leaves emoji out, so the voice does not read their names", () => {
    const { playback } = renderPlayback();
    act(() => {
      playback().startRun("run-1");
      playback().appendToken("run-1", "I love it 😊 so much! 👍🏽");
      playback().completeRun("run-1");
    });

    expect(FakeUtterance.spoken.map((utterance) => utterance.text)).toEqual([
      "I love it so much!",
    ]);
  });

  it("leaves audio tags out, so the voice does not read them", () => {
    const { playback } = renderPlayback();
    act(() => {
      playback().startRun("run-1");
      playback().appendToken(
        "run-1",
        "[laughs] Oh my gosh, that is so funny! [applause]",
      );
      playback().completeRun("run-1");
    });

    expect(FakeUtterance.spoken.map((utterance) => utterance.text)).toEqual([
      "Oh my gosh, that is so funny!",
    ]);
  });
});

describe("speech text for lip-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.pocketSupported = true;
    fixture.ttsMuted = false;
    fixture.speech = {};
    fixture.realtimeOptions = null;
    fixture.coreHandlers.clear();
  });
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
  });

  const texts = (onSpeechText: ReturnType<typeof vi.fn>) =>
    onSpeechText.mock.calls.map(([event]) => event);

  it("reports each chunk sent to ElevenLabs, then the final text", () => {
    const { playback, onSpeechText } = renderPlayback();
    act(() => {
      playback().startRun("run-1");
      playback().appendToken(
        "run-1",
        "This first sentence is long enough to stream. ",
      );
    });
    expect(texts(onSpeechText).at(-1)).toEqual({
      runId: "run-1",
      provider: "elevenlabs",
      text: "This first sentence is long enough to stream. ",
      final: false,
    });
    act(() => {
      playback().appendToken("run-1", "Then the reply ends.");
      playback().completeRun("run-1");
    });
    expect(texts(onSpeechText).at(-1)).toEqual({
      runId: "run-1",
      provider: "elevenlabs",
      text: "This first sentence is long enough to stream. Then the reply ends. ",
      final: true,
    });
  });

  it("sends ElevenLabs the text without emoji, tags kept", () => {
    const { playback, onSpeechText } = renderPlayback();
    act(() => {
      playback().startRun("run-1");
      playback().appendToken("run-1", "[laughs] I love it 😊 so much! 🎉");
      playback().completeRun("run-1");
    });

    expect(
      fixture.realtime.appendText.mock.calls.map(([, text]) => text),
    ).toEqual(["[laughs] I love it so much!"]);
    expect(texts(onSpeechText).at(-1)?.text).toBe(
      "[laughs] I love it so much! ",
    );
  });

  it("sends ElevenLabs its tag spellings and at most two sounds per reply", () => {
    const { playback, onSpeechText } = renderPlayback();
    act(() => {
      playback().startRun("run-1");
      playback().appendToken(
        "run-1",
        "[laughs] One sentence that is long enough here. ",
      );
      playback().appendToken(
        "run-1",
        "<sigh> Two sentence that is long enough here. [gasps] Three more words [applause].",
      );
      playback().completeRun("run-1");
    });

    const sent = [
      "[laughs] One sentence that is long enough here.",
      "[sighs] Two sentence that is long enough here.",
      "Three more words.",
    ];
    expect(
      fixture.realtime.appendText.mock.calls.map(([, text]) => text),
    ).toEqual(sent);
    expect(texts(onSpeechText).at(-1)?.text).toBe(`${sent.join(" ")} `);
  });

  it("starts an ElevenLabs reply with its tone tag, once", () => {
    const { playback, onSpeechText } = renderPlayback();
    act(() => {
      playback().startRun("run-1");
      playback().appendToken("run-1", "Hello there, this is long enough. ", {
        speechToneTag: "[very happy]",
      });
      playback().appendToken("run-1", "And then more text here.");
      playback().completeRun("run-1");
    });

    expect(
      fixture.realtime.appendText.mock.calls.map(([, text]) => text),
    ).toEqual([
      "[very happy] Hello there, this is long enough.",
      "And then more text here.",
    ]);
    expect(texts(onSpeechText).at(-1)?.text).toBe(
      "[very happy] Hello there, this is long enough. And then more text here. ",
    );
  });

  it("ignores a tone tag that is not exactly one square tag", () => {
    const { playback } = renderPlayback();
    act(() => {
      playback().startRun("run-1");
      playback().appendToken("run-1", "Hello there, this is long enough. ", {
        speechToneTag: "[happy] say this",
      });
      playback().completeRun("run-1");
    });

    expect(
      fixture.realtime.appendText.mock.calls.map(([, text]) => text),
    ).toEqual(["Hello there, this is long enough."]);
  });

  it("speaks a fallback to Pocket without tags or the tone tag", () => {
    const { playback, onSpeechText } = renderPlayback();
    act(() => {
      playback().startRun("run-1");
      playback().appendToken(
        "run-1",
        "[laughs] This first sentence is long enough to stream. ",
        { speechToneTag: "[happy]" },
      );
      playback().fallBackToPocketTts("run-1");
      playback().completeRun("run-1");
    });

    expect(texts(onSpeechText).at(-1)).toEqual({
      runId: "run-1",
      provider: "pocket_tts",
      text: "This first sentence is long enough to stream. ",
      final: true,
    });
  });

  it("reports Gemini's text with Gemini's tag spellings", () => {
    fixture.speech = { tts_provider: "gemini" };
    const { playback, onSpeechText } = renderPlayback({
      modelId: "gemini-3.8-flash-tts",
    });
    act(() => {
      playback().startRun("run-1");
      playback().appendToken("run-1", "Oh [laughs] wow. [applause] Bye.");
      playback().completeRun("run-1");
    });

    expect(texts(onSpeechText).at(-1)?.text).toBe("Oh <laugh> wow. Bye.");
  });

  it("reports Pocket's text spelled out as Pocket speaks it", () => {
    fixture.speech = { tts_provider: "pocket_tts" };
    const { playback, onSpeechText } = renderPlayback();
    act(() => {
      playback().startRun("run-1");
      playback().appendToken("run-1", "I have 3 cats.");
      playback().completeRun("run-1");
    });
    expect(texts(onSpeechText).at(-1)).toEqual({
      runId: "run-1",
      provider: "pocket_tts",
      text: "I have three cats. ",
      final: true,
    });
  });

  it("reports Gemini's reply text as it arrives", () => {
    fixture.speech = { tts_provider: "gemini" };
    const { playback, onSpeechText } = renderPlayback({
      modelId: "gemini-3.8-flash-tts",
    });
    act(() => {
      playback().startRun("run-1");
      playback().appendToken("run-1", "Hello there.");
      playback().appendToken("run-1", " How are you?");
      playback().completeRun("run-1");
    });
    expect(texts(onSpeechText)).toEqual([
      {
        runId: "run-1",
        provider: "gemini",
        text: "Hello there.",
        final: false,
      },
      {
        runId: "run-1",
        provider: "gemini",
        text: "Hello there. How are you?",
        final: false,
      },
      {
        runId: "run-1",
        provider: "gemini",
        text: "Hello there. How are you?",
        final: true,
      },
    ]);
  });

  it("starts the text again when a reply falls back to Pocket", () => {
    const { playback, onSpeechText } = renderPlayback();
    act(() => {
      playback().startRun("run-1");
      playback().appendToken(
        "run-1",
        "This first sentence is long enough to stream. ",
      );
      playback().fallBackToPocketTts("run-1");
      playback().appendToken("run-1", "Then 2 more arrive.");
      playback().completeRun("run-1");
    });
    // Pocket speaks the whole reply; its text is not added to ElevenLabs'.
    expect(texts(onSpeechText).at(-1)).toEqual({
      runId: "run-1",
      provider: "pocket_tts",
      text: "This first sentence is long enough to stream. Then two more arrive. ",
      final: true,
    });
  });
});
