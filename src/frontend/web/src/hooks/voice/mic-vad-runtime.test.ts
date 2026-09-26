import { describe, expect, it, vi } from "vitest";

import type { Logger } from "@/lib/logger";
import { startAcousticTurn } from "@/lib/voice/acoustic-vad-gate";

import { createMicVadCallbacks } from "./mic-vad-runtime";

function createCallbacks(
  overrides: Partial<Parameters<typeof createMicVadCallbacks>[0]> = {},
) {
  const logger: Logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
  return createMicVadCallbacks({
    provider: "parakeet",
    logger,
    debugStore: null,
    modeRef: { current: "dictation" },
    gateStateRef: { current: startAcousticTurn("turn-1") },
    turnIdRef: { current: "turn-1" },
    lastAcceptedSpeechAtRef: { current: null },
    lastClosedRealSpeechWindowRef: { current: null },
    smartTurnAudioRef: { current: new Float32Array(0) },
    smartTurnWorkerReadyRef: { current: false },
    vadFrameLastPublishedAtRef: { current: 0 },
    clearVoiceSilenceResetTimer: vi.fn(),
    syncGateDebugStats: vi.fn(),
    setAvatarPhaseFromVad: vi.fn(),
    armVoiceSilenceResetTimer: vi.fn(),
    runSmartTurnSemanticCheck: vi.fn(),
    lateFinalTranscriptGraceMs: 1000,
    smartTurnSampleRate: 16000,
    vadFrameDebugIntervalMs: 120,
    ...overrides,
  });
}

describe("createMicVadCallbacks", () => {
  it("forwards every processed MicVAD frame to onVadFrame", () => {
    const onVadFrame = vi.fn();
    const callbacks = createCallbacks({ onVadFrame });
    const frame = new Float32Array(512).fill(0.25);

    callbacks.onFrameProcessed({ isSpeech: 0.1, notSpeech: 0.9 }, frame);
    callbacks.onFrameProcessed({ isSpeech: 0.9, notSpeech: 0.1 }, frame);

    expect(onVadFrame).toHaveBeenCalledTimes(2);
    expect(onVadFrame).toHaveBeenLastCalledWith(frame);
  });

  it("reports the opened window so previews can follow it", () => {
    const onSpeechWindowStarted = vi.fn();
    const callbacks = createCallbacks({ onSpeechWindowStarted });

    callbacks.onSpeechStart();

    expect(onSpeechWindowStarted).toHaveBeenCalledWith(
      expect.objectContaining({
        turnId: "turn-1",
        provider: "parakeet",
        windowId: expect.stringMatching(/^window-/),
      }),
    );
  });
});
