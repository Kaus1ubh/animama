import { Object3D } from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Avatar } from "@/lib/avatar/Avatar";
import { PoseController } from "@/lib/avatar/poses/PoseController";
import type { AnimaPoseClipV2 } from "@/lib/avatar/poses/animaPoseClip";
import type { AvatarMotionCatalog } from "@/lib/avatar/motion/AvatarMotionCatalog";
import { BUILT_IN_AVATAR_MOTION_CATALOG } from "@/lib/avatar/motion/AvatarMotionCatalog";
import {
  evaluateManifestIdleEntries,
  selectManifestIdleCandidateFromEntries,
  type ManifestAnimation,
} from "@/lib/avatar/animationManifest";
import {
  buildEmotionRuntimeState,
  createEmptyEmotionStateMap,
} from "@/lib/emotion";

const emotion = buildEmotionRuntimeState(createEmptyEmotionStateMap());
const clip: AnimaPoseClipV2 = {
  schema: "animaPoseClip/2.0",
  id: "idle:test",
  name: "Idle",
  duration: 0.5,
  loop: true,
  beats: [],
  events: [{ id: "tap", kind: "sfx", cueId: "tap", time: 0.25 }],
};

function harness(type: "vrma" | "animaPoseClip") {
  const entry: ManifestAnimation = {
    id: "idle:test",
    name: "Idle",
    file: "idle:test",
    type,
    animation_type: "idle",
    emotions: {},
    duration: 0.5,
    time_scale: 2,
    loop_type: "repeat",
    loop_count: 2,
    idle_playback: true,
  };
  let ready!: () => void;
  const delivery = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const catalog: AvatarMotionCatalog = Object.assign(
    Object.create(BUILT_IN_AVATAR_MOTION_CATALOG),
    {
      evaluateIdleAnimations: () =>
        evaluateManifestIdleEntries([entry], emotion),
      selectIdleAnimation: (
        args: Parameters<AvatarMotionCatalog["selectIdleAnimation"]>[0],
      ) =>
        selectManifestIdleCandidateFromEntries({ ...args, entries: [entry] }),
      resolveVrma: () => ({ url: "blob:idle", cacheKey: "idle" }),
      loadPoseClip: async () => {
        await delivery;
        return clip;
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
  const playSfx = vi.fn();
  avatar.setPoseClipExternalEventSink({ playSfx });
  const playLoop = vi.fn(async () => {
    await delivery;
  });
  avatar.animationManager = {
    playLoop,
    fadeOutAction: vi.fn(),
    resetAll: vi.fn(),
  } as never;
  avatar.expressionController = { applyEmotionPreset: vi.fn() } as never;
  const tick = (nowMs: number, phase: "idle" | "thinking" = "idle") => {
    vi.setSystemTime(nowMs);
    return avatar.updateState(
      { emotionalState: emotion, signals: { interactionPhase: phase } },
      {
        nowMs,
        animaId: "test",
        activeRunId: null,
        activeVrmaActions: [],
        randomRolls: [0],
      },
    )!;
  };
  return { avatar, tick, ready, playSfx, playLoop };
}

afterEach(() => vi.useRealTimers());

describe("Avatar finite idle player integration", () => {
  it.each(["vrma", "animaPoseClip"] as const)(
    "starts the %s horizon after delivery and begins quiet after completion",
    async (type) => {
      vi.useFakeTimers();
      const h = harness(type);
      h.tick(1_000);
      h.tick(181_000);
      const loading = h.tick(190_000);
      expect(loading.state.idleStint.activeStartedAtMs).toBeNull();
      h.ready();
      await vi.waitFor(() =>
        expect(h.tick(190_000).state.idleStint.activeStartedAtMs).toBe(190_000),
      );
      const active = h.tick(190_250);
      expect(active.state.idleStint.phase).toBe("active");
      if (type === "animaPoseClip") {
        h.avatar.poseController!.update(0.5);
        expect(h.playSfx).toHaveBeenCalledTimes(2);
      }
      const done = h.tick(190_500);
      expect(done.state.idleStint.phase).toBe("quiet");
      expect(done.state.idleStint.nextDueAtMs).toBe(370_500);
    },
  );

  it("interrupts pending idle work when manual motion disables automatic playback", async () => {
    vi.useFakeTimers();
    const h = harness("animaPoseClip");
    h.tick(1_000);
    h.tick(181_000);
    h.avatar.setAutomaticAnimationPlaybackEnabled(false);
    const manual = h.tick(181_001);
    expect(manual.state.activePlannerPoseClip).toBeNull();
    h.ready();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.playSfx).not.toHaveBeenCalled();
  });

  it("does not resurrect an idle clip whose delivery finishes after interruption", async () => {
    vi.useFakeTimers();
    const h = harness("animaPoseClip");
    h.tick(1_000);
    h.tick(181_000);
    h.tick(181_001, "thinking");
    h.ready();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.avatar.poseController!.isClipActive()).toBe(false);
    expect(h.playSfx).not.toHaveBeenCalled();
  });
});
