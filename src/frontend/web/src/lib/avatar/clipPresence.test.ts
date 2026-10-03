import type { VRM } from "@pixiv/three-vrm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  buildEmotionRuntimeState,
  createEmptyEmotionStateMap,
} from "@/lib/emotion";
import { ExpressionController } from "./ExpressionController";
import { ProceduralAnimationController } from "./ProceduralAnimationController";
import { loadTestAvatar } from "./motion-authoring/testing/includedAvatars";
import { PoseController } from "./poses/PoseController";
import type { AnimaPoseClip } from "./poses/animaPoseClip";
import { SwayProceduralAnimationLayer } from "./proc-animation/SwayProceduralAnimationLayer";
import { BreathingProceduralAnimationLayer } from "./proc-animation/BreathingProceduralAnimationLayer";

let vrm: VRM;
beforeAll(async () => {
  vrm = await loadTestAvatar("AvatarSample_A_1_New");
});
afterEach(() => vi.restoreAllMocks());

const context = {
  avatarState: "idle" as const,
  emotionLabel: "neutral" as const,
  emotionalState: buildEmotionRuntimeState(createEmptyEmotionStateMap()),
  globalRestPoseActive: false,
};

/** Activation weights each layer receives over successive frames. */
function recordWeights(
  controller: ProceduralAnimationController,
  frames: number,
  mutes: Parameters<ProceduralAnimationController["setClipLayerMutes"]>,
) {
  const sway = vi.spyOn(SwayProceduralAnimationLayer.prototype, "update");
  const breathing = vi.spyOn(
    BreathingProceduralAnimationLayer.prototype,
    "update",
  );
  const result = { sway: [] as number[], breathing: [] as number[] };
  for (let frame = 0; frame < frames; frame += 1) {
    controller.setClipLayerMutes(...mutes);
    controller.update(1 / 60, context);
    result.sway.push(sway.mock.calls.at(-1)![1].layerActivationWeight ?? 1);
    result.breathing.push(
      breathing.mock.calls.at(-1)![1].layerActivationWeight ?? 1,
    );
  }
  sway.mockRestore();
  breathing.mockRestore();
  return result;
}

describe("clip layer mutes", () => {
  it("fades muted layers out and back in without touching others", () => {
    const controller = new ProceduralAnimationController(vrm);
    const before = controller
      .getSnapshot()
      .layers.map((layer) => [layer.id, layer.enabled]);
    // Let default layers finish activating.
    recordWeights(controller, 30, [[], 0]);

    const muted = recordWeights(controller, 30, [["sway"], 1]);
    expect(muted.sway[0]).toBeGreaterThan(0.9);
    expect(muted.sway[8]).toBeGreaterThan(0.3);
    expect(muted.sway.at(-1)).toBe(0);
    expect(new Set(muted.breathing)).toEqual(new Set([1]));

    const released = recordWeights(controller, 30, [[], 0]);
    expect(released.sway[0]).toBeLessThan(0.1);
    expect(released.sway.at(-1)).toBe(1);
    expect(
      controller.getSnapshot().layers.map((layer) => [layer.id, layer.enabled]),
    ).toEqual(before);
    controller.dispose();
  });

  it("follows a partial clip weight", () => {
    const controller = new ProceduralAnimationController(vrm);
    recordWeights(controller, 30, [[], 0]);
    const half = recordWeights(controller, 40, [["sway", "breathing"], 0.5]);
    expect(half.sway.at(-1)).toBeCloseTo(0.5);
    expect(half.breathing.at(-1)).toBeCloseTo(0.5);
    controller.dispose();
  });
});

const clip: AnimaPoseClip = {
  schema: "animaPoseClip/1.0",
  id: "smile",
  name: "Smile",
  duration: 1,
  mutedProceduralLayers: ["sway", "cursorLookAt"],
  fadeIn: { duration: 0.2, easing: "linear" },
  fadeOut: { duration: 0.2, easing: "linear" },
  poses: {
    a: { expressions: { happy: 0.4 } },
    b: { expressions: { happy: 1 } },
  },
  poseKeyframes: [
    { time: 0, pose: "a" },
    { time: 1, pose: "b" },
  ],
};

describe("PoseController.getClipPresence", () => {
  it("reports fade weight, mutes and raw expressions until the clip ends", () => {
    const controller = new PoseController(vrm);
    expect(controller.getClipPresence()).toBeNull();
    controller.playAnimaPoseClip(clip);
    controller.update(0.1);
    const fading = controller.getClipPresence()!;
    expect(fading.weight).toBeCloseTo(0.5, 1);
    expect(fading.mutedLayers).toEqual(["sway", "cursorLookAt"]);
    // easeInOutSine from 0.4 toward 1 at a tenth of the segment.
    expect(fading.expressions.happy).toBeCloseTo(0.415, 3);
    controller.update(0.4);
    expect(controller.getClipPresence()!.weight).toBe(1);
    controller.update(0.6);
    controller.update(0.1);
    expect(controller.getClipPresence()!.weight).toBeLessThan(0.6);
    controller.update(0.2);
    expect(controller.getClipPresence()).toBeNull();
  });

  it("releases immediately when stopped", () => {
    const controller = new PoseController(vrm);
    controller.playAnimaPoseClip(clip);
    controller.update(0.5);
    controller.stopClip({ immediate: true });
    expect(controller.getClipPresence()).toBeNull();
  });
});

describe("ExpressionController clip precedence", () => {
  const value = (name: string) => vrm.expressionManager!.getValue(name) ?? 0;

  // The emotion system drives face morphs such as `Fcl_MTH_Fun`.
  it("replaces the emotion face with the clip's keyed expressions", () => {
    const controller = new ExpressionController(vrm);
    controller.applyEmotionPreset("affection", 3);
    controller.update(1);
    const emotion = value("Fcl_MTH_Fun");
    expect(emotion).toBeGreaterThan(0.3);

    controller.setClipExpressionPrecedence({
      weight: 1,
      expressions: { happy: 0.8 },
    });
    controller.update(1 / 60);
    expect(value("happy")).toBeCloseTo(0.8, 2);
    expect(value("Fcl_MTH_Fun")).toBe(0);

    controller.setClipExpressionPrecedence({
      weight: 0.5,
      expressions: { happy: 0.8 },
    });
    controller.update(1 / 60);
    expect(value("happy")).toBeCloseTo(0.4, 2);
    expect(value("Fcl_MTH_Fun")).toBeCloseTo(emotion * 0.5, 2);

    controller.setClipExpressionPrecedence(null);
    controller.update(1 / 60);
    expect(value("happy")).toBe(0);
    expect(value("Fcl_MTH_Fun")).toBeCloseTo(emotion, 2);
    controller.dispose();
  });

  it("keeps lip-sync over keyed mouth shapes while speaking", () => {
    const controller = new ExpressionController(vrm);
    controller.setClipExpressionPrecedence({
      weight: 1,
      expressions: { aa: 0.8 },
    });
    controller.update(1 / 60);
    expect(value("aa")).toBeCloseTo(0.8, 2);
    // Simulate an active vowel lip-sync frame (normally driven by TTS audio).
    const lipSync = (
      controller as unknown as { _lipSync: { getCurrentFrame: () => unknown } }
    )._lipSync;
    vi.spyOn(lipSync, "getCurrentFrame").mockReturnValue({
      format: "vowel5",
      values: [0.2, 0, 0, 0, 0],
    });
    controller.update(1 / 60);
    expect(value("aa")).toBeCloseTo(0.2, 2);
    controller.dispose();
  });

  it("blends a keyed blink with automatic blinking by weight", () => {
    const controller = new ExpressionController(vrm);
    for (let frame = 0; frame < 30; frame += 1) {
      controller.setClipExpressionPrecedence({
        weight: 0.5,
        expressions: { blink: 1 },
      });
      controller.update(1 / 60);
      expect(value("blink")).toBeGreaterThanOrEqual(0.5 - 1e-6);
    }
    controller.dispose();
  });

  it("leaves emotions alone for clips that key no emotion preset", () => {
    const controller = new ExpressionController(vrm);
    controller.applyEmotionPreset("affection", 3);
    controller.update(1);
    const emotion = value("Fcl_MTH_Fun");
    controller.setClipExpressionPrecedence({
      weight: 1,
      expressions: { blink: 1 },
    });
    controller.update(1 / 60);
    expect(value("Fcl_MTH_Fun")).toBeCloseTo(emotion, 2);
    expect(value("blink")).toBe(1);
    controller.setClipExpressionPrecedence({ weight: 1, expressions: {} });
    controller.update(1 / 60);
    expect(value("Fcl_MTH_Fun")).toBeCloseTo(emotion, 2);
    controller.dispose();
  });
});
