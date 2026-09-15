import { describe, expect, it, vi } from "vitest";

import type { Avatar } from "@/lib/avatar";
import type { SceneVFXRuntimeEntry } from "@/lib/scene-vfx/types";
import {
  buildPlaybackObservationV1,
  capturePlaybackObservationRuntime,
  PLAYBACK_OBSERVATION_SAMPLE_INTERVAL_MS,
  resolvePlaybackObservationStatus,
  serializePlaybackObservation,
  shouldSamplePlaybackObservation,
  startPlaybackObservationSampling,
  type PlaybackObservationRuntimeCapture,
} from "./playbackObservation";

function runtimeCapture(): PlaybackObservationRuntimeCapture {
  return {
    avatarReady: true,
    vrma: [
      {
        runtimeId: "being-cocky",
        isCurrent: true,
        playheadSec: 0.4249,
        durationSec: 1.2349,
        weight: 1.4,
      },
    ],
    poseClip: {
      runtimeId: "shy-finger-poke",
      active: true,
      playheadSec: 0.3149,
      durationSec: 1.2,
      resolvedBoneCount: 18,
      missingBoneCount: 0,
      missingExpressionCount: 0,
      missingPoseRefCount: 0,
      firedEventIds: ["scene-on", "particle-on", "scene-on"],
      eventCount: 2,
      eventDispatchAvailable: true,
      skippedEventCount: 0,
      eventErrorCount: 0,
    },
    reactionClip: {
      runtimeId: "admiration-3",
      active: true,
      phase: "playing",
      playheadSec: 0.1188,
      durationSec: 1.8,
      firedEventIds: ["admiration-scene"],
      eventCount: 1,
      eventDispatchAvailable: true,
    },
    expressions: { happy: 0.7238, relaxed: -1 },
    particle: {
      available: true,
      warningCount: 0,
      hasError: false,
      active: [
        {
          runtimeId: "hearts",
          elapsedSec: 0.3118,
          owner: "preview:particle",
          anchor: "head",
          resolvedAnchor: "head",
        },
      ],
    },
    avatarVFX: {
      available: true,
      warningCount: 0,
      active: [
        {
          runtimeId: "eye-confused-swirl",
          targetRole: "face",
          animationPreset: "spin",
          renderMode: "overlay",
        },
      ],
    },
  };
}

const sceneVFX = {
  kind: "background_layers",
  entry: {
    id: "preview-scene",
    label: "Preview Scene",
    kind: "background_layers",
    enabled: true,
    durationMs: null,
    coverUiOverlays: false,
    dismissOnInput: false,
    solid: { enabled: false, color: "#000000" },
    pattern: {
      enabled: false,
      pattern: "none",
      color: "#ffffff",
      size: 12,
      spacing: 12,
      opacity: 0,
    },
    marquee: {
      enabled: false,
      items: [],
      itemSize: 72,
      gap: 24,
      rowGap: 20,
      direction: "static",
      itemRotationMode: "upright",
      itemRotationOffsetDeg: 0,
      speedPxPerSec: 160,
      opacity: 0,
    },
  },
  startedAtMs: 1_000,
  expiresAtMs: 2_000,
} satisfies SceneVFXRuntimeEntry;

describe("PlaybackObservationV1", () => {
  it("captures only the public Avatar and controller snapshot fields", () => {
    const getExpressionValue = vi.fn((name: string) =>
      name === "happy" ? 0.75 : 0.25,
    );
    const avatar = {
      isReady: true,
      getActiveAnimations: () => [
        {
          name: "Being Cocky",
          isCurrent: true,
          playheadSec: 0.4,
          durationSec: 1.5,
          weight: 1,
        },
      ],
      getClipSnapshot: () => ({
        clipId: "shy-finger-poke",
        playing: true,
        elapsedSec: 0.3,
        durationSec: 1.2,
        resolvedBones: ["head"],
        missingBones: [],
        resolvedExpressions: ["happy"],
        missingExpressions: [],
        missingPoseRefs: [],
        firedEventIds: ["sparkle"],
        eventCount: 1,
        eventDispatchAvailable: true,
        skippedEventCount: 0,
        eventErrorCount: 0,
      }),
      getReactionClipSnapshot: () => ({
        clipId: "admiration-3",
        active: true,
        phase: "playing",
        elapsedSec: 0.2,
        timelineDurationSec: 1.8,
        expressionKeys: ["relaxed", "happy"],
        firedEventIds: ["scene-on"],
        eventCount: 1,
        eventDispatchAvailable: true,
      }),
      getExpressionValue,
      particleVFXController: {
        getSnapshot: () => ({
          warnings: [],
          lastError: null,
          activeInstances: [
            {
              effectId: "hearts",
              elapsedSec: 0.1,
              ownerId: "preview:particle",
              anchor: "head",
              resolvedAnchor: "head",
            },
          ],
        }),
      },
      vfxController: {
        getSnapshot: vi.fn(() => {
          throw new Error("full Avatar VFX snapshot must not be observed");
        }),
        getObservationSnapshot: () => ({
          warningCount: 0,
          activeEffects: [
            {
              effectId: "eye-confused-swirl",
              targetRole: "face",
              animationPreset: "spin",
              renderMode: "overlay",
            },
          ],
        }),
      },
    } as unknown as Avatar;

    const capture = capturePlaybackObservationRuntime(avatar, {
      expressionNames: ["angry"],
    });

    expect(capture.vrma[0]).toMatchObject({
      runtimeId: "Being Cocky",
      isCurrent: true,
      playheadSec: 0.4,
    });
    expect(capture.poseClip.firedEventIds).toEqual(["sparkle"]);
    expect(capture.reactionClip.firedEventIds).toEqual(["scene-on"]);
    expect(capture.expressions).toEqual({
      angry: 0.25,
      happy: 0.75,
      relaxed: 0.25,
      sad: 0.25,
      surprised: 0.25,
    });
    expect(getExpressionValue.mock.calls.map(([name]) => name)).toEqual([
      "angry",
      "happy",
      "relaxed",
      "sad",
      "surprised",
    ]);
    expect(capture.particle.active[0]?.runtimeId).toBe("hearts");
    expect(capture.avatarVFX.active[0]?.runtimeId).toBe("eye-confused-swirl");
  });

  it("uses the creator clock but reads applied Avatar weights, including cleared channels", () => {
    const getExpressionValue = vi.fn(() => 0.25);
    const avatar = {
      isReady: true,
      getActiveAnimations: () => [],
      getClipSnapshot: () => null,
      getReactionClipSnapshot: () => null,
      getExpressionValue,
      particleVFXController: null,
      vfxController: null,
    } as unknown as Avatar;

    const capture = capturePlaybackObservationRuntime(avatar, {
      expressionNames: ["angry", "happy"],
      poseClipSample: {
        runtimeId: "react-0827142125",
        active: true,
        playheadSec: 0.3,
        durationSec: 1.2,
      },
    });

    expect(capture.expressions).toEqual({
      angry: 0.25,
      happy: 0.25,
      relaxed: 0.25,
      sad: 0.25,
      surprised: 0.25,
    });
    expect(getExpressionValue).toHaveBeenCalledWith("happy");
    expect(getExpressionValue).toHaveBeenCalledWith("angry");
    expect(capture.avatarReady).toBe(true);
    expect(capture.poseClip).toMatchObject({
      runtimeId: "react-0827142125",
      active: true,
      playheadSec: 0.3,
      durationSec: 1.2,
    });
  });

  it("projects all playback channels with stable rounding and logical fields", () => {
    const observation = buildPlaybackObservationV1({
      surface: "library-dock",
      target: { kind: "scene_vfx", runtimeId: "preview-scene" },
      status: "playing",
      runtime: runtimeCapture(),
      sceneVFX,
      nowMs: 1_500,
    });

    expect(observation.version).toBe(1);
    expect(observation.target).toEqual({
      kind: "scene_vfx",
      runtimeId: "preview-scene",
      status: "playing",
    });
    expect(observation.motion.vrma[0]).toMatchObject({
      runtimeId: "being-cocky",
      active: true,
      playheadSec: 0.425,
      durationSec: 1.235,
      weight: 1,
    });
    expect(observation.motion.poseClip?.firedEventIds).toEqual([
      "particle-on",
      "scene-on",
    ]);
    expect(observation.expressions).toEqual({ happy: 0.724, relaxed: 0 });
    expect(observation.effects.particle[0]?.elapsedSec).toBe(0.312);
    expect(observation.effects.avatar[0]?.elapsedSec).toBeNull();
    expect(observation.effects.scene).toEqual([
      {
        runtimeId: "preview-scene",
        kind: "background_layers",
        active: true,
      },
    ]);
  });

  it("projects creator-stage through the same version-one allowlist", () => {
    const observation = buildPlaybackObservationV1({
      surface: "creator-stage",
      target: { kind: "anima_pose_clip", runtimeId: "new-reaction" },
      status: "stopped",
      runtime: runtimeCapture(),
      sceneVFX: null,
      nowMs: 0,
    });

    expect(observation.surface).toBe("creator-stage");
    expect(observation.target).toEqual({
      kind: "anima_pose_clip",
      runtimeId: "new-reaction",
      status: "stopped",
    });
  });

  it("projects every bounded React-owned Scene VFX in a creator stage", () => {
    const observation = buildPlaybackObservationV1({
      surface: "creator-stage",
      target: { kind: "anima_pose_clip", runtimeId: "new-gesture" },
      status: "playing",
      runtime: runtimeCapture(),
      sceneVFX: [
        sceneVFX,
        { ...sceneVFX, runtimeId: "expired-scene", expiresAtMs: 1_250 },
      ],
      nowMs: 1_500,
    });

    expect(observation.effects.scene).toEqual([
      { runtimeId: "preview-scene", kind: "background_layers", active: true },
      { runtimeId: "expired-scene", kind: "background_layers", active: false },
    ]);
  });

  it("bounds arrays and diagnostics and excludes non-allowlisted source data", () => {
    const runtime = runtimeCapture() as PlaybackObservationRuntimeCapture & {
      secret: string;
      resourceUrl: string;
      rawError: { stack: string };
    };
    runtime.secret = "do-not-serialize";
    runtime.resourceUrl = "https://example.test/private/model.vrm?token=secret";
    runtime.rawError = { stack: "/Users/example/private/file.ts" };
    runtime.particle.active[0]!.runtimeId =
      "https://example.test/private/particle.json?token=secret";
    runtime.vrma = Array.from({ length: 20 }, (_, index) => ({
      runtimeId: `animation-${String(index).padStart(2, "0")}`,
      isCurrent: true,
      playheadSec: index,
      durationSec: 20,
      weight: 1,
    }));
    runtime.expressions = Object.fromEntries(
      Array.from({ length: 20 }, (_, index) => [`expression-${index}`, 0.5]),
    );
    runtime.poseClip.missingBoneCount = 5_000;
    runtime.poseClip.missingExpressionCount = 1;
    runtime.poseClip.missingPoseRefCount = 1;
    runtime.poseClip.skippedEventCount = 1;
    runtime.poseClip.eventErrorCount = 1;
    runtime.particle.warningCount = 1;
    runtime.particle.hasError = true;
    runtime.avatarVFX.warningCount = 1;

    const serialized = serializePlaybackObservation(
      buildPlaybackObservationV1({
        surface: "anima-loadout-stage",
        target: { kind: "animation", runtimeId: "being-cocky" },
        status: "playing",
        runtime,
        sceneVFX: null,
        nowMs: 0,
      }),
    );
    const observation = JSON.parse(serialized) as Record<string, unknown>;

    expect((observation.motion as { vrma: unknown[] }).vrma).toHaveLength(16);
    expect(Object.keys(observation.expressions as object)).toHaveLength(16);
    expect(serialized).not.toContain("do-not-serialize");
    expect(serialized).not.toContain("https://");
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain("token=secret");
    expect(serialized).toContain('"runtimeId":"[redacted]"');
    expect(serialized).toContain('"count":999');
  });

  it("returns detached data that cannot mutate the source snapshots", () => {
    const runtime = runtimeCapture();
    runtime.vrma[0]!.runtimeId = "Being Cocky";
    const observation = buildPlaybackObservationV1({
      surface: "library-dock",
      target: { kind: "animation", runtimeId: "being-cocky" },
      status: "playing",
      runtime,
      sceneVFX: null,
      nowMs: 0,
    });

    expect(observation.motion.vrma[0]?.runtimeId).toBe("being-cocky");
    observation.motion.vrma[0]!.runtimeId = "changed-output";
    observation.motion.poseClip!.firedEventIds.push("changed-output");
    observation.expressions.happy = 0;

    expect(runtime.vrma[0]?.runtimeId).toBe("Being Cocky");
    expect(runtime.poseClip.firedEventIds).not.toContain("changed-output");
    expect(runtime.expressions.happy).toBe(0.7238);
  });

  it("normalizes product lifecycle states without hiding inactive previews", () => {
    expect(
      resolvePlaybackObservationStatus({ active: false, status: "playing" }),
    ).toBe("stopped");
    expect(
      resolvePlaybackObservationStatus({ active: true, status: "idle" }),
    ).toBe("stopped");
    expect(
      resolvePlaybackObservationStatus({
        active: true,
        status: "ready",
        stopped: true,
      }),
    ).toBe("stopped");
    expect(
      resolvePlaybackObservationStatus({
        active: true,
        status: "loading",
        unavailable: true,
      }),
    ).toBe("unavailable");
    expect(
      resolvePlaybackObservationStatus({
        active: true,
        status: "error",
        unavailable: true,
      }),
    ).toBe("error");
  });
});

describe("playback observation sampling", () => {
  it("samples only for active loading or playing previews", () => {
    expect(
      shouldSamplePlaybackObservation({ active: true, status: "loading" }),
    ).toBe(true);
    expect(
      shouldSamplePlaybackObservation({ active: true, status: "playing" }),
    ).toBe(true);

    for (const status of [
      "ready",
      "stopped",
      "unavailable",
      "error",
    ] as const) {
      expect(shouldSamplePlaybackObservation({ active: true, status })).toBe(
        false,
      );
    }
    expect(
      shouldSamplePlaybackObservation({ active: false, status: "playing" }),
    ).toBe(false);
  });

  it("samples at 5 Hz only while visible and cleans up every subscription", () => {
    let visible = true;
    let visibilityCallback: () => void = () => undefined;
    let intervalCallback: () => void = () => undefined;
    const sample = vi.fn();
    const clearInterval = vi.fn();
    const unsubscribe = vi.fn();
    const setInterval = vi.fn((callback: () => void, delayMs: number) => {
      intervalCallback = callback;
      expect(delayMs).toBe(PLAYBACK_OBSERVATION_SAMPLE_INTERVAL_MS);
      expect(delayMs).toBe(200);
      return 7;
    });
    const cleanup = startPlaybackObservationSampling({
      enabled: true,
      sample,
      environment: {
        isVisible: () => visible,
        setInterval,
        clearInterval,
        subscribeVisibility: (callback) => {
          visibilityCallback = callback;
          return unsubscribe;
        },
      },
    });

    expect(setInterval).toHaveBeenCalledTimes(1);
    intervalCallback();
    expect(sample).toHaveBeenCalledTimes(1);

    visible = false;
    visibilityCallback();
    expect(clearInterval).toHaveBeenCalledWith(7);

    visible = true;
    visibilityCallback();
    expect(setInterval).toHaveBeenCalledTimes(2);

    cleanup();
    expect(clearInterval).toHaveBeenCalledTimes(2);
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("does not subscribe while disabled", () => {
    const subscribeVisibility = vi.fn(() => vi.fn());
    const cleanup = startPlaybackObservationSampling({
      enabled: false,
      sample: vi.fn(),
      environment: {
        isVisible: () => true,
        setInterval: vi.fn(() => 1),
        clearInterval: vi.fn(),
        subscribeVisibility,
      },
    });

    cleanup();
    expect(subscribeVisibility).not.toHaveBeenCalled();
  });
});
