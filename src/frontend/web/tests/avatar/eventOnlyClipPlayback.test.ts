import type { VRM } from "@pixiv/three-vrm";
import { Object3D } from "three";
import { describe, expect, it, vi } from "vitest";

import {
  PoseController,
  parseAnimaPoseClip,
  type AnimaPoseClipEventSink,
  type AnimaPoseClipVFXEvent,
  type AnimaPoseClipEventContext,
} from "@/lib/avatar";
import { createAnimaPoseClipProgram } from "@/lib/avatar/poses/animaPoseClip/program";
import { ReactionClipPlayer } from "@/lib/avatar/reaction/ReactionClipPlayer";

const clip = parseAnimaPoseClip({
  schema: "animaPoseClip/2.0",
  id: "effect-only",
  name: "Effect only",
  duration: 1,
  beats: [],
  events: [
    { id: "avatar", kind: "avatar_vfx", effectId: "star", time: 0 },
    { id: "particle", kind: "particle_vfx", effectId: "sparkles", time: 0 },
    {
      id: "scene",
      kind: "scene_vfx",
      sceneKind: "background_layers",
      presetId: "scene-vfx-emotion-joy",
      time: 0,
    },
  ],
});

/** Track observable apply/clear ownership at the players' VFX boundary. */
function effectsSink() {
  const active = new Set<string>();
  const applied: string[] = [];
  const cleared: string[] = [];
  const apply = (
    _event: AnimaPoseClipVFXEvent,
    context: AnimaPoseClipEventContext,
  ) => {
    applied.push(context.eventId);
    active.add(context.appliedId);
  };
  const clear = (
    _event: AnimaPoseClipVFXEvent,
    context: AnimaPoseClipEventContext,
  ) => {
    cleared.push(context.eventId);
    active.delete(context.appliedId);
  };
  const sink: AnimaPoseClipEventSink = {
    applyAvatarVFX: apply,
    clearAvatarVFX: clear,
    applyParticleVFX: apply,
    clearParticleVFX: clear,
    applySceneVFX: apply,
    clearSceneVFX: clear,
  };
  return { active, applied, cleared, sink };
}

describe("event-only clip sampling", () => {
  it("has no authored pose or expression sample at any playback time", () => {
    const program = createAnimaPoseClipProgram(clip, {
      resolvePose: () => null,
    });
    expect(program.hasPose).toBe(false);
    expect(program.expressionNames).toEqual([]);
    for (const time of [0, 0.5, 1, 2]) {
      expect(program.sample(time)).toEqual({
        sample: {},
        diagnostics: { missingPoseRefs: [] },
      });
    }
  });
});

describe.each(["stop", "complete", "fade"] as const)(
  "event-only Gesture %s",
  (ending) => {
    it("plays and clears all VFX lanes while preserving the active pose", () => {
      const head = new Object3D();
      const humanoid = {
        getNormalizedPose: () => ({
          head: { rotation: head.quaternion.toArray() },
        }),
        getNormalizedBoneNode: (name: string) =>
          name === "head" ? head : null,
        resetNormalizedPose: vi.fn(),
        setNormalizedPose: vi.fn(),
      };
      const controller = new PoseController({ humanoid } as unknown as VRM);
      controller.applyPose("relaxedRest");
      expect(controller.isPoseActive("relaxedRest")).toBe(true);
      humanoid.resetNormalizedPose.mockClear();
      humanoid.setNormalizedPose.mockClear();
      const effects = effectsSink();
      controller.setClipEventSink(effects.sink);
      controller.playAnimaPoseClip({
        ...clip,
        ...(ending === "fade"
          ? { fadeIn: { duration: 0.1 }, fadeOut: { duration: 0.1 } }
          : {}),
      });
      controller.update(0.2);
      expect(effects.applied).toEqual(["avatar", "particle", "scene"]);
      expect(effects.active.size).toBe(3);
      if (ending === "complete") controller.update(0.8);
      else {
        controller.stopClip({ immediate: ending === "stop" });
        if (ending === "fade") controller.update(0.1);
      }
      expect(effects.cleared).toEqual(effects.applied);
      expect(effects.active.size).toBe(0);
      expect(controller.isClipActive()).toBe(false);
      expect(controller.isPoseActive("relaxedRest")).toBe(true);
      expect(humanoid.resetNormalizedPose).not.toHaveBeenCalled();
      expect(humanoid.setNormalizedPose).not.toHaveBeenCalled();
    });
  },
);

describe.each(["stop", "complete"] as const)(
  "event-only Reaction %s",
  (ending) => {
    it("plays and clears all VFX lanes without adding expression weights", () => {
      const effects = effectsSink();
      const setExpressionOverlay = vi
        .fn<(owner: string, expressions: Record<string, number>) => boolean>()
        .mockReturnValue(true);
      const clearExpressionOverlay = vi.fn(() => true);
      const player = new ReactionClipPlayer(
        { setExpressionOverlay, clearExpressionOverlay },
        { eventSink: effects.sink },
      );
      player.play({
        ownerId: "owner",
        runId: "run",
        sourceEventId: "source",
        emotionEventId: "emotion",
        clip,
      });
      player.update(0.2);
      expect(effects.applied).toEqual(["avatar", "particle", "scene"]);
      expect(effects.active.size).toBe(3);
      if (ending === "complete") player.update(0.8);
      else player.clear(null, { immediate: true });
      expect(effects.cleared).toEqual(effects.applied);
      expect(effects.active.size).toBe(0);
      expect(
        setExpressionOverlay.mock.calls.every(
          (call) => Object.keys(call[1] ?? {}).length === 0,
        ),
      ).toBe(true);
      expect(clearExpressionOverlay).toHaveBeenCalledWith("owner");
    });
  },
);
