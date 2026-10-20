import { Object3D } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Avatar, type AvatarStateUpdateContext } from "@/lib/avatar/Avatar";
import { PoseController } from "@/lib/avatar/poses/PoseController";
import type { AnimaPoseClipV2 } from "@/lib/avatar/poses/animaPoseClip";
import type { AvatarMotionCatalog } from "@/lib/avatar/motion/AvatarMotionCatalog";
import { BUILT_IN_AVATAR_MOTION_CATALOG } from "@/lib/avatar/motion/AvatarMotionCatalog";
import {
  hasBlockingNonTtsPresentationWork,
  type AvatarPlannerGestureEvent,
} from "@/lib/avatar/planner";
import {
  buildEmotionRuntimeState,
  createEmptyEmotionStateMap,
} from "@/lib/emotion";

const emotion = buildEmotionRuntimeState(createEmptyEmotionStateMap());

/** Exercise the real planner/executor/player while controlling resource delivery. */
function harness(
  options: {
    duration?: number;
    timeScale?: number;
    loop?: boolean;
    configuredDuration?: number;
  } = {},
) {
  const duration = options.duration ?? 5;
  const loaded = new Map<string, AnimaPoseClipV2>();
  const deliveries = new Map<string, (clip: AnimaPoseClipV2 | null) => void>();
  const catalog: AvatarMotionCatalog = Object.assign(
    Object.create(BUILT_IN_AVATAR_MOTION_CATALOG),
    {
      getGesture: (id: string) => ({
        id,
        name: id,
        description: "",
        type: "animaPoseClip",
        file: id,
        duration: options.configuredDuration ?? null,
        loopType: "once",
        timeScale: options.timeScale ?? 1,
        entry: { id, name: id, file: id, type: "animaPoseClip" },
      }),
      getPoseClip: (id: string) => loaded.get(id) ?? null,
      loadPoseClip: (id: string) => {
        if (loaded.has(id)) return Promise.resolve(loaded.get(id)!);
        return new Promise<AnimaPoseClipV2 | null>((resolve) => {
          deliveries.set(id, resolve);
        });
      },
    },
  );
  const avatar = new Avatar(new Object3D(), null, { motionCatalog: catalog });
  avatar.vrm = {
    humanoid: {
      getNormalizedPose: () => ({}),
      getNormalizedBoneNode: () => null,
      resetNormalizedPose: vi.fn(),
      setNormalizedPose: vi.fn(),
    },
  } as never;
  avatar.poseController = new PoseController(avatar.vrm!, {
    motionCatalog: catalog,
  });
  avatar.animationManager = {
    fadeOutAction: vi.fn(),
    resetAll: vi.fn(),
  } as never;
  avatar.expressionController = { applyEmotionPreset: vi.fn() } as never;
  const playSfx = vi.fn();
  avatar.setPoseClipExternalEventSink({ playSfx });
  const event = (id = "long", runId = "run-1"): AvatarPlannerGestureEvent => ({
    type: "gestureRequested",
    eventId: `${runId}:${id}`,
    requestId: `${runId}:${id}`,
    runId,
    animationHint: id,
    sourceEventId: null,
    sourceEmotionEventId: null,
    createdAtMs: Date.now(),
  });
  const tick = (
    nowMs: number,
    events: AvatarPlannerGestureEvent[] = [],
    runId: string | null = "run-1",
    context: AvatarStateUpdateContext = {},
    phase: "responding_no_tts" | "talking" = "responding_no_tts",
  ) => {
    vi.setSystemTime(nowMs);
    return avatar.updateState(
      {
        emotionalState: emotion,
        signals: { interactionPhase: runId ? phase : "idle" },
      },
      {
        nowMs,
        animaId: "test",
        activeRunId: runId,
        pendingEvents: events,
        activeVrmaActions: [],
        randomRolls: [0],
        ...context,
      },
    )!;
  };
  const deliver = async (id = "long", missing = false) => {
    const clip: AnimaPoseClipV2 = {
      schema: "animaPoseClip/2.0",
      id,
      name: id,
      duration,
      loop: options.loop,
      beats: [],
      events: [
        { id: "late", kind: "sfx", cueId: "late", time: duration * 0.8 },
      ],
    };
    if (!missing) loaded.set(id, clip);
    deliveries.get(id)?.(missing ? null : clip);
    await Promise.resolve();
    await Promise.resolve();
  };
  return { avatar, event, tick, deliver, playSfx };
}

afterEach(() => vi.useRealTimers());

describe("Avatar Gesture delivery and playback lifetime", () => {
  it("plays the late authored event on the first cold load and clears presentation only at the end", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.tick(1_000, [h.event()]);
    await h.deliver();
    h.avatar.poseController!.update(2.5);
    const midway = h.tick(3_500);
    expect(hasBlockingNonTtsPresentationWork(midway, "run-1")).toBe(true);
    expect(h.avatar.getClipSnapshot().playing).toBe(true);
    h.avatar.poseController!.update(1.5);
    expect(h.playSfx).toHaveBeenCalledTimes(1);
    h.avatar.poseController!.update(1);
    const complete = h.tick(6_000);
    expect(hasBlockingNonTtsPresentationWork(complete, "run-1")).toBe(false);
    expect(complete.state.activePlannerPoseClip).toBeNull();
    expect(complete.state.pendingEvents).toEqual([]);
  });

  it("does not spend the playback horizon while delivery takes longer than two seconds", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.tick(1_000, [h.event()]);
    const loading = h.tick(4_500);
    expect(loading.state.activePlannerPoseClip).toMatchObject({
      status: "pending",
      startedAtMs: null,
      expiresAtMs: null,
    });
    expect(hasBlockingNonTtsPresentationWork(loading, "run-1")).toBe(true);
    await h.deliver();
    const started = h.tick(4_500);
    expect(started.state.activePlannerPoseClip).toMatchObject({
      status: "active",
      startedAtMs: 4_500,
      expiresAtMs: 9_500,
    });
    h.avatar.poseController!.update(4);
    expect(h.playSfx).toHaveBeenCalledTimes(1);
    expect(hasBlockingNonTtsPresentationWork(h.tick(8_500), "run-1")).toBe(
      true,
    );
    h.avatar.poseController!.update(1);
    expect(hasBlockingNonTtsPresentationWork(h.tick(9_500), "run-1")).toBe(
      false,
    );
  });

  it.each([
    { duration: 0.6, timeScale: 1 },
    { duration: 5, timeScale: 2 },
    { duration: 5, timeScale: 0.5 },
  ])(
    "keeps the player and horizon aligned for duration $duration at speed $timeScale",
    async (options) => {
      vi.useFakeTimers();
      const h = harness(options);
      h.tick(1_000, [h.event()]);
      await h.deliver();
      const seconds = options.duration / options.timeScale;
      expect(h.tick(1_000).state.activePlannerPoseClip?.expiresAtMs).toBe(
        1_000 + seconds * 1_000,
      );
      h.avatar.poseController!.update(seconds * 0.7);
      expect(h.playSfx).not.toHaveBeenCalled();
      h.avatar.poseController!.update(seconds * 0.11);
      expect(h.playSfx).toHaveBeenCalledTimes(1);
      expect(
        hasBlockingNonTtsPresentationWork(
          h.tick(1_000 + seconds * 810),
          "run-1",
        ),
      ).toBe(true);
      h.avatar.poseController!.update(seconds * 0.2);
      expect(
        hasBlockingNonTtsPresentationWork(
          h.tick(1_000 + seconds * 1_000),
          "run-1",
        ),
      ).toBe(false);
    },
  );

  it("bounds a long looping Gesture after one delivered timeline", async () => {
    vi.useFakeTimers();
    const h = harness({ loop: true });
    h.tick(1_000, [h.event()]);
    await h.deliver();
    h.avatar.poseController!.update(5);
    const complete = h.tick(6_000);
    expect(complete.state.lastCancellationReason).toBe(
      "gesturePoseClipCompleted",
    );
    expect(hasBlockingNonTtsPresentationWork(complete, "run-1")).toBe(false);
    // The existing exit fade remains separate from the bounded Gesture clock.
    h.avatar.poseController!.update(0.35);
    expect(h.avatar.getClipSnapshot().playing).toBe(false);
    expect(h.playSfx).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: "the planner minimum", configuredDuration: undefined, seconds: 2 },
    { label: "its configured length", configuredDuration: 3, seconds: 3 },
  ])(
    "keeps a short looping Gesture for $label",
    async ({ configuredDuration, seconds }) => {
      vi.useFakeTimers();
      const h = harness({ duration: 0.6, loop: true, configuredDuration });
      h.tick(1_000, [h.event()]);
      await h.deliver();
      expect(h.tick(1_000).state.activePlannerPoseClip?.expiresAtMs).toBe(
        1_000 + seconds * 1_000,
      );
      h.avatar.poseController!.update(seconds - 0.1);
      const looping = h.tick(1_000 + (seconds - 0.1) * 1_000);
      expect(hasBlockingNonTtsPresentationWork(looping, "run-1")).toBe(true);
      expect(h.avatar.getClipSnapshot().playing).toBe(true);
      const complete = h.tick(1_000 + seconds * 1_000);
      expect(complete.state.lastCancellationReason).toBe(
        "gesturePoseClipCompleted",
      );
    },
  );

  it("uses the same natural duration on warm replay", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.tick(1_000, [h.event()]);
    await h.deliver();
    h.avatar.poseController!.update(5);
    h.tick(6_000);
    h.tick(10_000, [h.event("long", "run-2")], "run-2");
    await Promise.resolve();
    const replay = h.tick(10_000, [], "run-2");
    expect(replay.state.activePlannerPoseClip).toMatchObject({
      startedAtMs: 10_000,
      expiresAtMs: 15_000,
    });
    h.avatar.poseController!.update(4);
    expect(h.playSfx).toHaveBeenCalledTimes(2);
    expect(
      hasBlockingNonTtsPresentationWork(h.tick(14_000, [], "run-2"), "run-2"),
    ).toBe(true);
  });

  it("does not play a cancelled Gesture when its delivery finally resolves", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.tick(1_000, [h.event()]);
    expect(h.tick(1_100, [], null).state.activePlannerPoseClip).toBeNull();
    await h.deliver();
    h.avatar.poseController!.update(5);
    expect(h.avatar.getClipSnapshot().playing).toBe(false);
    expect(h.playSfx).not.toHaveBeenCalled();
  });

  it("does not let stale delivery replace the next run's Gesture", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.tick(1_000, [h.event()]);
    h.tick(1_100, [h.event("replacement", "run-2")], "run-2");
    // A planner evaluation first cancels the previous owner, then admits the queue.
    h.tick(1_100, [], "run-2");
    await h.deliver("replacement");
    await h.deliver("long");
    const current = h.tick(1_100, [], "run-2");
    expect(current.state.activePlannerPoseClip).toMatchObject({
      clipId: "replacement",
      runId: "run-2",
      status: "active",
      expiresAtMs: 6_100,
    });
    h.avatar.poseController!.update(4);
    expect(h.avatar.getClipSnapshot().clipId).toBe("replacement");
    expect(h.playSfx).toHaveBeenCalledTimes(1);
  });

  it("keeps a pending Gesture owned while the previous thinking clip fades out", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.avatar.playAnimaPoseClip({
      schema: "animaPoseClip/2.0",
      id: "thinking",
      name: "Thinking",
      duration: 1,
      loop: true,
      beats: [],
      events: [{ id: "start", kind: "sfx", cueId: "start", time: 0 }],
    });
    h.tick(1_000, [h.event()], "run-1", {
      activePlannerPoseClip: {
        ownerId: "thinking",
        requestId: "thinking",
        runId: "run-1",
        clipId: "thinking",
        source: "thinking",
        manifestGestureId: null,
        manifestGestureType: null,
        gestureResolutionSource: null,
        sourceMotionEventId: null,
        sourceEmotionEventId: null,
        status: "active",
        requestedAtMs: 0,
        eligibleAtMs: 0,
        startedAtMs: 0,
        expiresAtMs: null,
        priority: 10,
        enterPolicy: { mode: "fadeIn", durationSec: 0.35 },
        exitPolicy: { mode: "fadeOut", durationSec: 0.35 },
      },
    });
    expect(h.avatar.poseController!.isClipActive("thinking")).toBe(true);
    const pending = h.tick(1_100);
    expect(pending.state.activePlannerPoseClip).toMatchObject({
      clipId: "long",
      status: "pending",
    });
    expect(pending.state.lastCancellationReason).not.toBe(
      "manualPoseClipActive",
    );
    h.avatar.poseController!.update(0.35);
    await h.deliver();
    expect(h.tick(1_100).state.activePlannerPoseClip).toMatchObject({
      clipId: "long",
      status: "active",
    });
  });

  it("hands a long spoken reply to talking hands after the Gesture fades out", async () => {
    vi.useFakeTimers();
    const h = harness({ duration: 1, loop: true, configuredDuration: 2 });
    const talking = (nowMs: number, events: AvatarPlannerGestureEvent[] = []) =>
      h.tick(
        nowMs,
        events,
        "run-1",
        { eligiblePlannerProceduralLayerIds: ["talkingHands"] },
        "talking",
      );
    const talkingHandsEnabled = (output: ReturnType<typeof talking>) =>
      output.actions.some(
        (action) =>
          action.type === "setProceduralPolicy" &&
          action.layerId === "talkingHands" &&
          action.enabled,
      );

    expect(talkingHandsEnabled(talking(1_000, [h.event()]))).toBe(false);
    await h.deliver();
    h.avatar.poseController!.update(1);
    expect(talkingHandsEnabled(talking(2_000))).toBe(false);

    // The looping Gesture reaches its configured length and starts fading.
    h.avatar.poseController!.update(1.1);
    const stopping = talking(3_100);
    expect(stopping.state.lastCancellationReason).toBe(
      "gesturePoseClipCompleted",
    );
    expect(talkingHandsEnabled(stopping)).toBe(false);
    h.avatar.poseController!.update(0.1);
    expect(talkingHandsEnabled(talking(3_200))).toBe(false);

    // Once the fade has released the clip, talking hands take over.
    h.avatar.poseController!.update(0.3);
    const released = talking(3_500);
    expect(released.state.talkingMotionArbitration.status).toBe(
      "gestureFinished",
    );
    expect(talkingHandsEnabled(released)).toBe(true);
  });

  it("releases presentation when the pending clip cannot be delivered", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.tick(1_000, [h.event()]);
    await h.deliver("long", true);
    const failed = h.tick(1_100);
    expect(hasBlockingNonTtsPresentationWork(failed, "run-1")).toBe(false);
    expect(failed.state.lastCancellationReason).toBe("poseClipMissing");
    expect(h.avatar.getClipSnapshot().playing).toBe(false);
  });
});
