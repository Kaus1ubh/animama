import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  addLipSyncRunTiming,
  cancelLipSyncRun,
  endLipSyncRunAudio,
  setLipSyncRunText,
} from "@/lib/lipsync/lipsync-runs";
import { createTalkingHandsSpeechPlan } from "@/lib/avatar/proc-animation/talking-hands-speech-planner";
import { DEFAULT_TALKING_HANDS_PROCEDURAL_ANIMATION_PARAMS } from "@/lib/avatar/proc-animation/types";
import type { LipSyncWorkerResponse } from "@/lib/lipsync/worker-protocol";
import {
  isProviderTimingOnlyChange,
  useAvatarLipSyncBridgeStore,
} from "./avatar-lipsync-bridge-store";

vi.mock("@/lib/lipsync/lipsync-runs", () => ({
  connectLipSyncRuns: vi.fn(() => () => {}),
  setLipSyncRunText: vi.fn(),
  addLipSyncRunTiming: vi.fn(),
  endLipSyncRunAudio: vi.fn(),
  cancelLipSyncRun: vi.fn(),
  cancelAllLipSyncRuns: vi.fn(),
}));

const RUN = "run-1";

/** A plan update: `frameCount` frames with the mouth half open on "A". */
function plan(
  overrides: Partial<Extract<LipSyncWorkerResponse, { type: "plan" }>> & {
    frameCount: number;
  },
): LipSyncWorkerResponse {
  const fromFrame = overrides.fromFrame ?? 0;
  const frames = new Float32Array((overrides.frameCount - fromFrame) * 5);
  for (let i = 0; i < frames.length; i += 5) frames[i] = 0.5;
  return {
    type: "plan",
    runId: RUN,
    seq: 1,
    fromFrame,
    frames,
    events: [],
    gestures: {
      words: [{ wordIndex: 0, startSec: 0.1, endSec: 0.4 }],
      beats: [{ timeSec: 0.2, wordIndex: 0, unitIndex: 1, strength: 1 }],
      phrases: [{ startSec: 0.1, endSec: 0.4, firstWord: 0, lastWord: 0 }],
    },
    complete: false,
    fallback: null,
    audioSec: (overrides.frameCount - 1) / 60,
    cpuMs: 2,
    ...overrides,
  };
}

function fakeAvatar() {
  const replaced: Array<{
    fromSec: number;
    frames: number;
    durationSec: number;
  }> = [];
  const overlays: Array<Record<string, number> | null> = [];
  const avatar = {
    isReady: true,
    clearLipSync: vi.fn(),
    setAudioContext: vi.fn(),
    initLipSyncSegment: vi.fn(),
    registerLipSyncFrame: vi.fn(),
    onSegmentAudioStarted: vi.fn(),
    replaceLipSyncFrames: (
      _segmentId: string,
      fromSec: number,
      frames: unknown[],
      durationSec: number,
    ) => replaced.push({ fromSec, frames: frames.length, durationSec }),
    expressionController: {
      setExpressionOverlay: (_owner: string, weights: Record<string, number>) =>
        overlays.push(weights),
      clearExpressionOverlay: () => overlays.push(null),
    },
  };
  const store = useAvatarLipSyncBridgeStore.getState();
  store.registerAvatarInstance({
    avatar: avatar as unknown as Parameters<
      typeof store.registerAvatarInstance
    >[0]["avatar"],
  });
  return { avatar, replaced, overlays };
}

/** Start the run's audio at context time 10 and let the gate apply its plan. */
function startPlayback(clock: { currentTime: number }) {
  const store = useAvatarLipSyncBridgeStore.getState();
  store.markSpeechAudioStarted({
    runId: RUN,
    audioStartSec: 10,
    audioContext: clock as unknown as AudioContext,
  });
  store.tickGate({ avatarState: "talking", preferredRunId: RUN });
}

describe("avatar lip-sync bridge store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAvatarLipSyncBridgeStore.getState().clearAll();
    useAvatarLipSyncBridgeStore.setState({ avatar: null, avatarAnimaId: null });
  });

  it("routes a run's text, timing and audio end to the planner", () => {
    const store = useAvatarLipSyncBridgeStore.getState();
    store.setSpeechText({ runId: RUN, text: "Hi there.", final: false });
    store.appendProviderSpeechTiming({
      runId: RUN,
      provider: "elevenlabs",
      chars: [{ char: "H", startSec: 0, endSec: 0.1 }],
    });
    store.markSpeechAudioDurationResolved({ runId: RUN, audioDurationSec: 1 });
    store.clearRun(RUN);

    expect(setLipSyncRunText).toHaveBeenCalledWith(RUN, "Hi there.", false);
    expect(addLipSyncRunTiming).toHaveBeenCalledWith(RUN, [
      { char: "H", startSec: 0, endSec: 0.1 },
    ]);
    expect(endLipSyncRunAudio).toHaveBeenCalledWith(RUN);
    expect(cancelLipSyncRun).toHaveBeenCalledWith(RUN);
  });

  it("turns a plan into the run's segment, timeline and stats", () => {
    const store = useAvatarLipSyncBridgeStore.getState();
    store.applyPlannerResponse(RUN, plan({ frameCount: 61 }));

    const state = useAvatarLipSyncBridgeStore.getState();
    expect(state.segmentsByRun[RUN]?.frames).toHaveLength(61);
    expect(state.segmentsByRun[RUN]?.durationSec).toBeCloseTo(1);
    expect(state.speechGestureTimelinesByRun[RUN]?.phrases).toHaveLength(1);
    expect(state.plannerStatsByRun[RUN]?.cpuMsPerAudioSec).toBeCloseTo(2);

    // Talking hands schedule gestures by the planner's phrases.
    const clock = { currentTime: 10.2 };
    store.markSpeechAudioStarted({
      runId: RUN,
      audioStartSec: 10,
      audioContext: clock as unknown as AudioContext,
    });
    const context = store.getSpeechTimingContext(RUN);
    expect(context?.gestureTimeline?.beats).toHaveLength(1);
    expect(context?.ttsChunks).toMatchObject([
      { wordStartIndex: 0, wordEndIndex: 1 },
    ]);
  });

  it("lets talking hands use beats placed ahead of the audio", () => {
    const store = useAvatarLipSyncBridgeStore.getState();
    // 0.8 s heard; the planner placed the rest of the phrase at the speaking
    // rate, with provisional beats at 1.2 s and 1.8 s.
    store.applyPlannerResponse(
      RUN,
      plan({
        frameCount: 49,
        gestures: {
          words: [
            { wordIndex: 0, startSec: 0.1, endSec: 0.5 },
            { wordIndex: 1, startSec: 1, endSec: 1.4 },
            { wordIndex: 2, startSec: 1.6, endSec: 2.35 },
          ],
          beats: [
            { timeSec: 0.3, wordIndex: 0, unitIndex: 0, strength: 1 },
            { timeSec: 1.2, wordIndex: 1, unitIndex: 1, strength: 0.5 },
            { timeSec: 1.8, wordIndex: 2, unitIndex: 2, strength: 0.5 },
          ],
          phrases: [{ startSec: 0.1, endSec: 2.35, firstWord: 0, lastWord: 2 }],
        },
      }),
    );
    store.markSpeechAudioStarted({
      runId: RUN,
      audioStartSec: 10,
      audioContext: { currentTime: 10.4 } as unknown as AudioContext,
    });

    const context = store.getSpeechTimingContext(RUN)!;
    expect(context.durationKnown).toBe(false);
    expect(context.utteranceDurationSec).toBeCloseTo(2.35);
    const handsPlan = createTalkingHandsSpeechPlan({
      runId: RUN,
      elapsedSec: context.elapsedSec,
      utteranceDurationSec: context.utteranceDurationSec!,
      scope: "chunk",
      windowEndSec: 2.35,
      remainingSec: context.remainingSec!,
      beats: context.gestureTimeline!.beats,
      params: DEFAULT_TALKING_HANDS_PROCEDURAL_ANIMATION_PARAMS,
    });
    expect(handsPlan.status).toBe("ready");
    expect(
      handsPlan.status === "ready"
        ? handsPlan.selectedBeats.map((beat) => beat.timeSec)
        : [],
    ).toContain(1.2);
  });

  it("revises a playing run's segment from the first changed frame", () => {
    const { replaced } = fakeAvatar();
    const store = useAvatarLipSyncBridgeStore.getState();
    store.applyPlannerResponse(RUN, plan({ frameCount: 61 }));
    startPlayback({ currentTime: 10.1 });
    expect(useAvatarLipSyncBridgeStore.getState().startedRuns[RUN]).toBe(true);

    store.applyPlannerResponse(RUN, plan({ fromFrame: 30, frameCount: 91 }));

    expect(replaced).toEqual([{ fromSec: 0.5, frames: 61, durationSec: 1.5 }]);
  });

  it("delays what follows an underrun", () => {
    fakeAvatar();
    const store = useAvatarLipSyncBridgeStore.getState();
    store.applyPlannerResponse(RUN, plan({ frameCount: 61 }));
    startPlayback({ currentTime: 10.1 });

    // Run second 0.5 resumed at context 10.8: 0.3 s of silence.
    store.markPlaybackResumed({ runId: RUN, runSec: 0.5, contextSec: 10.8 });

    const segment = useAvatarLipSyncBridgeStore.getState().segmentsByRun[RUN]!;
    expect(segment.durationSec).toBeCloseTo(1.3);
    expect(
      segment.frames.find((frame) => frame.frame_index === 30)?.time_sec,
    ).toBeCloseTo(0.8);
  });

  it("shows a tag's expression while it sounds, then clears it", () => {
    const { overlays } = fakeAvatar();
    const store = useAvatarLipSyncBridgeStore.getState();
    store.applyPlannerResponse(
      RUN,
      plan({
        frameCount: 121,
        events: [
          { kind: "laugh", startSec: 0.2, endSec: 1, label: "[laughs]" },
        ],
      }),
    );
    const clock = { currentTime: 10.1 };
    startPlayback(clock);

    clock.currentTime = 10.5;
    store.tickTagOverlays(RUN);
    clock.currentTime = 12;
    store.tickTagOverlays(RUN);
    store.tickTagOverlays(RUN);

    expect(overlays).toHaveLength(2);
    expect(overlays[0]?.happy).toBeCloseTo(0.8);
    expect(overlays[1]).toBeNull();
  });
});

describe("provider speech timing", () => {
  beforeEach(() => {
    useAvatarLipSyncBridgeStore.getState().clearAll();
  });

  it("keeps each run's characters in arrival order until the run is cleared", () => {
    const store = useAvatarLipSyncBridgeStore.getState();

    store.appendProviderSpeechTiming({
      runId: "run-1",
      provider: "elevenlabs",
      chars: [{ char: "H", startSec: 0, endSec: 0.08 }],
    });
    store.appendProviderSpeechTiming({
      runId: "run-2",
      provider: "elevenlabs",
      chars: [{ char: "Y", startSec: 0, endSec: 0.1 }],
    });
    store.appendProviderSpeechTiming({
      runId: "run-1",
      provider: "elevenlabs",
      chars: [{ char: "i", startSec: 0.08, endSec: 0.2 }],
    });

    expect(
      useAvatarLipSyncBridgeStore.getState().providerSpeechTimingByRun["run-1"],
    ).toEqual({
      provider: "elevenlabs",
      chars: [
        { char: "H", startSec: 0, endSec: 0.08 },
        { char: "i", startSec: 0.08, endSec: 0.2 },
      ],
    });

    store.clearRun("run-1");
    expect(
      Object.keys(
        useAvatarLipSyncBridgeStore.getState().providerSpeechTimingByRun,
      ),
    ).toEqual(["run-2"]);

    store.clearAll();
    expect(
      useAvatarLipSyncBridgeStore.getState().providerSpeechTimingByRun,
    ).toEqual({});
  });

  it("tells a timing-only update apart from one a mirror must copy", () => {
    const changes: boolean[] = [];
    const unsubscribe = useAvatarLipSyncBridgeStore.subscribe(
      (state, previous) =>
        changes.push(isProviderTimingOnlyChange(state, previous)),
    );
    const store = useAvatarLipSyncBridgeStore.getState();

    store.appendProviderSpeechTiming({
      runId: "run-1",
      provider: "elevenlabs",
      chars: [{ char: "H", startSec: 0, endSec: 0.08 }],
    });
    store.markSpeechAudioDurationResolved({
      runId: "run-1",
      audioDurationSec: 1,
      generationId: null,
    });
    unsubscribe();

    expect(changes[0]).toBe(true);
    expect(changes.slice(1)).not.toContain(true);
  });

  it("ignores an empty append", () => {
    const store = useAvatarLipSyncBridgeStore.getState();
    const before = useAvatarLipSyncBridgeStore.getState();

    store.appendProviderSpeechTiming({
      runId: "run-1",
      provider: "elevenlabs",
      chars: [],
    });

    expect(useAvatarLipSyncBridgeStore.getState()).toBe(before);
  });
});

describe("debug replay segments", () => {
  beforeEach(() => {
    useAvatarLipSyncBridgeStore.getState().clearAll();
    useAvatarLipSyncBridgeStore.setState({ avatar: null, avatarAnimaId: null });
  });

  function fakeAvatar() {
    const calls: string[] = [];
    const avatar = {
      isReady: true,
      clearLipSync: () => calls.push("clear"),
      setAudioContext: () => calls.push("context"),
      initLipSyncSegment: (meta: { run_id?: string | null }) =>
        calls.push(`init:${meta.run_id}`),
      registerLipSyncFrame: () => calls.push("frame"),
      onSegmentAudioStarted: (segmentId: string, audioStartSec: number) =>
        calls.push(`start:${segmentId}@${audioStartSec}`),
    };
    return { avatar, calls };
  }

  const segment = {
    segmentId: "replay-segment",
    meta: { run_id: "lipsync-replay-1", segment_id: "replay-segment" },
    frames: [
      { time_sec: 0, values: [1, 0, 0, 0, 0] },
      { time_sec: 1 / 60, values: [0, 1, 0, 0, 0] },
    ],
    frameCount: 2,
    durationMs: 33,
    durationSec: 0.033,
    fps: 60,
  };

  it("plays a replay's plan on the avatar against the replay's clock", () => {
    const { avatar, calls } = fakeAvatar();
    const store = useAvatarLipSyncBridgeStore.getState();
    store.registerAvatarInstance({
      avatar: avatar as unknown as Parameters<
        typeof store.registerAvatarInstance
      >[0]["avatar"],
    });

    expect(
      useAvatarLipSyncBridgeStore.getState().playReplaySegment({
        segment,
        audioContext: {} as AudioContext,
        audioStartSec: 2.5,
      }),
    ).toBe(true);
    expect(calls).toEqual([
      "clear",
      "context",
      "init:lipsync-replay-1",
      "frame",
      "frame",
      "start:replay-segment@2.5",
    ]);
    // A replay is not a chat run: nothing waits for the speech gate.
    expect(useAvatarLipSyncBridgeStore.getState().segmentsByRun).toEqual({});

    useAvatarLipSyncBridgeStore.getState().stopReplaySegment();
    expect(calls.at(-1)).toBe("clear");
  });

  function speakingRun(started: boolean) {
    useAvatarLipSyncBridgeStore.setState({
      speechAudioStartsByRun: {
        "run-1": {
          runId: "run-1",
          audioStartSec: 0,
          audioContext: {} as AudioContext,
          generationId: null,
          receivedAtMs: 0,
        },
      },
      startedRuns: started ? { "run-1": true } : {},
    });
  }

  it("leaves a speaking reply's own plan when a replay stops", () => {
    const { avatar, calls } = fakeAvatar();
    const store = useAvatarLipSyncBridgeStore.getState();
    store.registerAvatarInstance({
      avatar: avatar as unknown as Parameters<
        typeof store.registerAvatarInstance
      >[0]["avatar"],
    });
    speakingRun(true);

    useAvatarLipSyncBridgeStore.getState().stopReplaySegment();

    expect(calls).toEqual([]);
  });

  it("clears a stopped replay when the speaking reply has no plan of its own", () => {
    const { avatar, calls } = fakeAvatar();
    const store = useAvatarLipSyncBridgeStore.getState();
    store.registerAvatarInstance({
      avatar: avatar as unknown as Parameters<
        typeof store.registerAvatarInstance
      >[0]["avatar"],
    });
    // A Japanese reply has no estimated plan, so the replay's pose would freeze.
    speakingRun(false);

    useAvatarLipSyncBridgeStore.getState().stopReplaySegment();

    expect(calls).toEqual(["clear"]);
  });

  it("does not play a replay without a ready avatar", () => {
    expect(
      useAvatarLipSyncBridgeStore.getState().playReplaySegment({
        segment,
        audioContext: {} as AudioContext,
        audioStartSec: 0,
      }),
    ).toBe(false);
  });
});
