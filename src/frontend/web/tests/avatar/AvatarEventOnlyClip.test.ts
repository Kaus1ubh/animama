import { Group, Object3D } from "three";
import { describe, expect, it, vi } from "vitest";

import { Avatar, PoseController, parseAnimaPoseClip } from "@/lib/avatar";
import { playContentPreviewMotion } from "@/lib/content-preview/playback";
import type { PreviewRuntimeCatalogSession } from "@/lib/content-preview/PreviewRuntimeCatalogSession";
import type { ContentPreviewTarget } from "@/lib/content-preview/types";

const eventClip = parseAnimaPoseClip({
  schema: "animaPoseClip/1.0",
  id: "effects",
  name: "Effects",
  duration: 1,
  poses: {},
  poseKeyframes: [],
  events: [
    {
      id: "scene",
      kind: "scene_vfx",
      sceneKind: "background_layers",
      presetId: "comic-pop",
      time: 0,
    },
  ],
});
const bodyClip = parseAnimaPoseClip({
  ...eventClip,
  id: "body",
  poses: {
    turn: { humanoid: { head: { rotation: [0, 0.1, 0, Math.sqrt(0.99)] } } },
  },
  poseKeyframes: [{ time: 0, pose: "turn" }],
});

/** Use Avatar's public playback lifecycle with real pose/event controllers. */
function avatarHarness(automatic = true) {
  const avatar = new Avatar(new Object3D());
  const head = new Object3D();
  avatar.vrm = {
    scene: new Group(),
    update: vi.fn(),
    humanoid: {
      getNormalizedPose: () => ({
        head: { rotation: head.quaternion.toArray() },
      }),
      getNormalizedBoneNode: (name: string) => (name === "head" ? head : null),
      resetNormalizedPose: vi.fn(),
      setNormalizedPose: vi.fn(),
    },
  } as never;
  avatar.poseController = new PoseController(avatar.vrm!);
  const resetAnimations = vi.fn();
  avatar.animationManager = {
    resetAll: resetAnimations,
    update: vi.fn(),
    fadeOutAction: vi.fn(() => true),
  } as never;
  const clearOffsets = vi.fn();
  const updateProcedural = vi.fn();
  const setLayerMutes = vi.fn();
  avatar.proceduralAnimationController = {
    clearActiveOffsets: clearOffsets,
    update: updateProcedural,
    setClipLayerMutes: setLayerMutes,
  } as never;
  avatar.setAutomaticAnimationPlaybackEnabled(automatic);
  avatar.applyPose("relaxedRest");
  resetAnimations.mockClear();
  clearOffsets.mockClear();
  updateProcedural.mockClear();
  const applyDefaults = vi.spyOn(avatar.poseController, "applyDefaultPoses");
  const resetPose = vi
    .spyOn(avatar.vrm!.humanoid, "resetNormalizedPose")
    .mockClear();
  const setPose = vi
    .spyOn(avatar.vrm!.humanoid, "setNormalizedPose")
    .mockClear();
  const applyScene = vi.fn();
  const clearScene = vi.fn();
  avatar.setPoseClipExternalEventSink({
    applySceneVFX: applyScene,
    clearSceneVFX: clearScene,
  });
  return {
    avatar,
    resetAnimations,
    applyDefaults,
    resetPose,
    setPose,
    clearOffsets,
    updateProcedural,
    setLayerMutes,
    applyScene,
    clearScene,
  };
}

describe.each([true, false])(
  "Avatar event-only playback with automatic animation=%s",
  (automatic) => {
    it.each(["stop", "complete"] as const)(
      "preserves animation and pose ownership through %s",
      (ending) => {
        const h = avatarHarness(automatic);
        expect(
          h.avatar.playAnimaPoseClip(eventClip, {
            preserveProceduralOffsets: true,
          }).playing,
        ).toBe(true);
        expect(h.avatar.isAutomaticAnimationPlaybackEnabled()).toBe(automatic);
        expect(h.avatar.isPoseActive("relaxedRest")).toBe(true);
        expect(h.clearOffsets).not.toHaveBeenCalled();
        expect(h.applyScene).toHaveBeenCalledOnce();
        h.avatar.update(0.25);
        if (ending === "stop")
          h.avatar.stopClip({ preserveProceduralOffsets: true });
        else h.avatar.update(0.75);
        expect(h.avatar.isClipActive()).toBe(false);
        expect(h.clearScene).toHaveBeenCalledOnce();
        expect(h.avatar.isAutomaticAnimationPlaybackEnabled()).toBe(automatic);
        expect(h.avatar.isPoseActive("relaxedRest")).toBe(true);
        expect(h.resetAnimations).not.toHaveBeenCalled();
        expect(h.applyDefaults).not.toHaveBeenCalled();
        expect(h.resetPose).not.toHaveBeenCalled();
        expect(h.setPose).not.toHaveBeenCalled();
        expect(h.updateProcedural.mock.calls.every(([dt]) => dt > 0)).toBe(
          true,
        );
      },
    );
  },
);

describe("Avatar clip layer mutes", () => {
  it("forwards a playing clip's mutes each frame and releases them after stop", () => {
    const h = avatarHarness();
    h.avatar.playAnimaPoseClip({
      ...eventClip,
      id: "muted",
      mutedProceduralLayers: ["sway", "cursorLookAt"],
    });
    h.avatar.update(0.25);
    expect(h.setLayerMutes).toHaveBeenLastCalledWith(
      ["sway", "cursorLookAt"],
      1,
    );
    h.avatar.stopClip();
    h.avatar.update(0.1);
    expect(h.setLayerMutes).toHaveBeenLastCalledWith([], 0);
  });
});

describe("Avatar body-clip coordination", () => {
  it("continues an automatic rest transition while an effect-only clip runs", () => {
    const h = avatarHarness();
    expect(h.avatar.fadeOutAnimation("idle", 0.4)).toBe(true);
    h.avatar.playAnimaPoseClip(eventClip);
    h.setPose.mockClear();
    h.avatar.update(0.2);
    expect(h.setPose).toHaveBeenCalledOnce();
    expect(h.avatar.isClipActive("effects")).toBe(true);
    h.avatar.update(0.2);
    expect(h.setPose).toHaveBeenCalledTimes(2);
    expect(h.avatar.isClipActive("effects")).toBe(true);
    expect(h.clearScene).not.toHaveBeenCalled();
    h.avatar.stopClip();
    expect(h.clearScene).toHaveBeenCalledOnce();
  });

  it("still interrupts an automatic rest transition for a body clip", () => {
    const h = avatarHarness();
    h.avatar.fadeOutAnimation("idle", 0.4);
    h.avatar.playAnimaPoseClip(bodyClip);
    h.setPose.mockClear();
    h.avatar.update(0.2);
    // The body clip is the only pose writer; no rest sample is mixed into it.
    expect(h.setPose).toHaveBeenCalledOnce();
    expect(h.setPose.mock.calls[0]![0].head?.rotation).toEqual([
      0,
      0.1,
      0,
      Math.sqrt(0.99),
    ]);
    expect(h.avatar.isClipActive("body")).toBe(true);
  });

  it("restores a replaced body clip before an effect-only successor runs", () => {
    const h = avatarHarness();
    h.avatar.playAnimaPoseClip(bodyClip);
    expect(h.avatar.isAutomaticAnimationPlaybackEnabled()).toBe(false);
    h.avatar.playAnimaPoseClip(eventClip);
    expect(h.avatar.isAutomaticAnimationPlaybackEnabled()).toBe(true);
    expect(h.avatar.isClipActive("effects")).toBe(true);
    expect(h.clearScene).toHaveBeenCalledOnce();
    const appliedDefaults = h.applyDefaults.mock.calls.length;
    h.avatar.stopClip();
    expect(h.applyDefaults).toHaveBeenCalledTimes(appliedDefaults);
    expect(h.clearScene).toHaveBeenCalledTimes(2);
  });

  it.each(["stop", "complete"] as const)(
    "still suspends and restores automatic animation through %s",
    (ending) => {
      const h = avatarHarness();
      expect(h.avatar.playAnimaPoseClip(bodyClip).playing).toBe(true);
      expect(h.avatar.isAutomaticAnimationPlaybackEnabled()).toBe(false);
      expect(h.resetAnimations).toHaveBeenCalledOnce();
      expect(h.applyDefaults).toHaveBeenCalledOnce();
      if (ending === "stop") h.avatar.stopClip();
      else h.avatar.update(1);
      expect(h.avatar.isAutomaticAnimationPlaybackEnabled()).toBe(true);
      expect(h.avatar.isClipActive()).toBe(false);
      expect(h.applyDefaults).toHaveBeenCalledTimes(2);
      expect(h.clearScene).toHaveBeenCalledOnce();
    },
  );
});

describe("finite idle preview completion", () => {
  it("moves preview status to Ready once the actual clip clock finishes", async () => {
    const h = avatarHarness(false);
    const onFinished = vi.fn();
    let status = "playing";
    const catalog = {
      loadPoseClip: async () => bodyClip,
    } as unknown as PreviewRuntimeCatalogSession;
    // No event dependencies are needed for this completion observation.
    const clip = parseAnimaPoseClip({ ...bodyClip, events: [], loop: true });
    catalog.loadPoseClip = async () => clip;
    await playContentPreviewMotion({
      avatar: h.avatar,
      catalog,
      loop: false,
      target: {
        kind: "anima_pose_clip",
        slot: "gesture",
        runtimeId: "body",
        idlePlayback: {
          timeScale: 0.5,
          repetitions: 3,
          loopType: "repeat",
          durationSeconds: 6,
        },
      } as ContentPreviewTarget,
      onFinished: () => {
        onFinished();
        status = "ready";
      },
    });
    h.avatar.update(5.9);
    expect(status).toBe("playing");
    expect(onFinished).not.toHaveBeenCalled();
    h.avatar.update(0.1);
    expect(h.avatar.isClipActive()).toBe(false);
    expect(status).toBe("ready");
    h.avatar.update(1);
    expect(onFinished).toHaveBeenCalledOnce();
  });

  it.each(["stop", "replace"] as const)(
    "does not report a cancelled finite preview as naturally finished after %s",
    (ending) => {
      const h = avatarHarness(false);
      const onFinished = vi.fn();
      h.avatar.playAnimaPoseClip(bodyClip, {
        finitePlayback: { timeScale: 1, repetitions: 1 },
        onFinished,
      });
      h.avatar.update(0.25);
      if (ending === "stop") h.avatar.stopClip();
      else h.avatar.playAnimaPoseClip(eventClip);
      h.avatar.update(2);
      expect(onFinished).not.toHaveBeenCalled();
    },
  );
});
