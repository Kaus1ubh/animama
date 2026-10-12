import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildVisemeAssetsFromRaw } from "@/lib/avatar/viseme-worker-client";
import { useAvatarLipSyncBridgeStore } from "./avatar-lipsync-bridge-store";

vi.mock("@/lib/avatar/viseme-worker-client", () => ({
  buildVisemeAssetsFromRaw: vi.fn(
    async (args: {
      runId: string;
      targetDurationSec?: number | null;
      phonemizedText?: string[][] | null;
    }) => {
      const wordCount = Array.isArray(args.phonemizedText)
        ? args.phonemizedText.length
        : 1;
      const durationSec = args.targetDurationSec ?? wordCount;
      const segmentId = `viseme-${args.runId}`;
      return {
        segment: {
          segmentId,
          meta: {
            run_id: args.runId,
            segment_id: segmentId,
            duration_seconds: durationSec,
            format: "vowel5",
          },
          frames: [],
          frameCount: 0,
          durationMs: durationSec * 1000,
          durationSec,
          fps: 60,
        },
        planSummary: {
          basis: "phoneme_viseme_plan",
          durationSec,
          durationMs: durationSec * 1000,
          frameCount: 0,
          fps: 60,
        },
        speechGestureTimeline: {
          beats: [],
          words: [],
          utteranceDurationSec: durationSec,
        },
        buildMode: args.targetDurationSec
          ? "actual_prestart"
          : "estimated_provisional",
        provisionalTargetDurationSec: null,
        provisionalMarginSec: null,
        workerElapsedMs: 0,
      };
    },
  ),
}));

describe("avatar lip-sync bridge store", () => {
  beforeEach(() => {
    vi.mocked(buildVisemeAssetsFromRaw).mockClear();
    useAvatarLipSyncBridgeStore.getState().clearAll();
  });

  it("stores duration without throwing when raw viseme inputs arrive later", async () => {
    const store = useAvatarLipSyncBridgeStore.getState();

    expect(() => {
      store.markSpeechAudioDurationResolved({
        runId: "run-1",
        audioDurationSec: 1.25,
        generationId: null,
      });
    }).not.toThrow();
    expect(
      useAvatarLipSyncBridgeStore.getState().speechAudioDurationsByRun["run-1"]
        ?.audioDurationSec,
    ).toBe(1.25);
    expect(buildVisemeAssetsFromRaw).not.toHaveBeenCalled();

    store.queueVisemeInputsForRun({
      runId: "run-1",
      phonemizedText: [["h", "AI"]],
      tokenizedText: "Hi!",
      provider: "elevenlabs",
    });

    await vi.waitFor(() => {
      expect(buildVisemeAssetsFromRaw).toHaveBeenCalledTimes(1);
    });
    expect(buildVisemeAssetsFromRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        mode: "actual_prestart",
        targetDurationSec: 1.25,
        phonemizedText: [["h", "AI"]],
        tokenizedText: "Hi!",
      }),
    );
  });

  it("replaces in-flight provisional visemes when later speech segments extend a run", async () => {
    const avatar = {
      isReady: true,
      clearLipSync: vi.fn(),
      setAudioContext: vi.fn(),
      initLipSyncSegment: vi.fn(),
      registerLipSyncFrame: vi.fn(),
      onSegmentAudioStarted: vi.fn(),
    };
    const audioContext = { currentTime: 6.5 } as AudioContext;
    const store = useAvatarLipSyncBridgeStore.getState();

    store.registerAvatarInstance({
      avatar: avatar as never,
      animaId: "anima-1",
    });
    store.queueVisemeInputsForRun({
      runId: "run-1",
      phonemizedText: [["one"], ["two"], ["three"], ["four"]],
      tokenizedText: "One two three four.",
      provider: "elevenlabs",
    });

    await vi.waitFor(() => {
      expect(buildVisemeAssetsFromRaw).toHaveBeenCalledTimes(1);
    });

    store.markSpeechAudioStarted({
      runId: "run-1",
      audioStartSec: 4,
      audioContext,
    });
    store.tickGate({ avatarState: "talking", preferredRunId: "run-1" });
    expect(avatar.initLipSyncSegment).toHaveBeenCalledTimes(1);

    store.queueVisemeInputsForRun({
      runId: "run-1",
      phonemizedText: [
        ["one"],
        ["two"],
        ["three"],
        ["four"],
        ["five"],
        ["six"],
      ],
      tokenizedText: "One two three four. Five six.",
      provider: "elevenlabs",
    });

    await vi.waitFor(() => {
      expect(buildVisemeAssetsFromRaw).toHaveBeenCalledTimes(2);
      expect(avatar.initLipSyncSegment).toHaveBeenCalledTimes(2);
    });
    expect(buildVisemeAssetsFromRaw).toHaveBeenLastCalledWith(
      expect.objectContaining({
        runId: "run-1",
        mode: "estimated_provisional",
        targetDurationSec: null,
        anchor: expect.objectContaining({
          elapsedSec: 2.5,
          currentDurationSec: 4,
        }),
      }),
    );
  });

  it("plans visemes for Gemini speech and skips unknown providers", async () => {
    const store = useAvatarLipSyncBridgeStore.getState();
    store.queueVisemeInputsForRun({
      runId: "run-gemini",
      phonemizedText: [["h", "AI"]],
      tokenizedText: "Hi!",
      provider: "gemini",
    });
    await vi.waitFor(() => {
      expect(buildVisemeAssetsFromRaw).toHaveBeenCalledWith(
        expect.objectContaining({ runId: "run-gemini" }),
      );
    });

    store.queueVisemeInputsForRun({
      runId: "run-other",
      phonemizedText: [["h", "AI"]],
      tokenizedText: "Hi!",
      provider: "other" as "gemini",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(buildVisemeAssetsFromRaw).not.toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-other" }),
    );
  });
});
