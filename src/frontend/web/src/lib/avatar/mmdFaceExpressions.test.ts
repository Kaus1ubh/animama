import type * as THREE from "three";
import { describe, expect, it } from "vitest";

import { ARKIT_BLENDSHAPES } from "./arkit";
import {
  applyEyelidClosureCorrection,
  CLOSED_LID_PEAK_SHARE,
} from "./eyelidClosure";
import { ExpressionController } from "./ExpressionController";
import { prepareLoadedVrm } from "./prepareLoadedVrm";
import { morphInfluence, syntheticFaceVrm } from "./testing/syntheticFaceVrm";

/** MMD's standard face morphs, as Japanese VRChat models name them. */
const MMD_MORPHS = [
  "にこり",
  "困る",
  "怒り",
  "上",
  "笑い",
  "なごみ",
  "びっくり",
  "じと目",
  "にっこり",
  "お",
];

const arkitSpelling = (shape: string) =>
  shape.replace(/Left$/, "_L").replace(/Right$/, "_R");

/**
 * A converted-VRChat-style face with MMD morphs, the converter's presets on
 * morphs of their own, a blink and an `aa` viseme; optionally every ARKit
 * shape as well.
 */
function mmdAvatar(options: { arkit?: boolean } = {}) {
  const arkit = options.arkit ? ARKIT_BLENDSHAPES.map(arkitSpelling) : [];
  return syntheticFaceVrm({
    morphs: [
      ...MMD_MORPHS,
      "Blink_Authored",
      "Happy_Authored",
      "Sad_Authored",
      "Viseme_A",
      ...arkit,
    ],
    presetBinds: {
      blink: [options.arkit ? "eyeBlink_L" : "Blink_Authored"],
      happy: ["Happy_Authored"],
      sad: ["Sad_Authored"],
      aa: ["Viseme_A"],
    },
  });
}

/** Run the controller long enough for emotion fades to settle. */
function settle(controller: ExpressionController) {
  for (let frame = 0; frame < 120; frame += 1) controller.update(1 / 30);
}

/** Make `name` move `share` of blink's motion on blink's own vertex. */
function closeLidsWith(mesh: THREE.Mesh, name: string, share: number) {
  const index = (morph: string) => mesh.morphTargetDictionary![morph]!;
  const targets = mesh.geometry.morphAttributes.position!;
  const blinkVertex = index("Blink_Authored");
  targets[index(name)]!.setY(blinkVertex, 0.01 * share);
}

describe("MMD face shapes", () => {
  it("plays each mapped region as its MMD morph", () => {
    const { vrm, mesh } = mmdAvatar();
    prepareLoadedVrm(vrm, { vrmSha256: null });
    const manager = vrm.expressionManager!;

    manager.setValue("Fcl_BRW_Joy", 1);
    manager.setValue("Fcl_EYE_Fun", 1);
    manager.setValue("Fcl_MTH_Surprised", 1);
    manager.update();
    expect(morphInfluence(mesh, "にこり")).toBeCloseTo(1, 5);
    expect(morphInfluence(mesh, "なごみ")).toBeCloseTo(1, 5);
    expect(morphInfluence(mesh, "お")).toBeCloseTo(1, 5);
    expect(morphInfluence(mesh, "Happy_Authored")).toBe(0);
  });

  it("composes a mood MMD covers fully and keeps a preset it covers partly", () => {
    const { vrm, mesh } = mmdAvatar();
    const authoredSad = vrm.expressionManager!.getExpression("sad");
    const face = prepareLoadedVrm(vrm, { vrmSha256: null }).arkitFace;
    const manager = vrm.expressionManager!;

    expect(face.moods.happy).toEqual({ brow: "mmd", eye: "mmd", mouth: "mmd" });
    // Sad has only an MMD brow; one preset cannot be split by region.
    expect(face.moods.sad).toEqual({
      brow: "preset",
      eye: "preset",
      mouth: "preset",
    });
    expect(manager.getExpression("sad")).toBe(authoredSad);
    // Without a preset of its own, angry plays its MMD regions only.
    expect(face.moods.angry).toEqual({
      brow: "mmd",
      eye: "mmd",
      mouth: "none",
    });

    manager.setValue("happy", 1);
    manager.update();
    expect(morphInfluence(mesh, "にこり")).toBeCloseTo(1, 5);
    expect(morphInfluence(mesh, "笑い")).toBeCloseTo(1, 5);
    expect(morphInfluence(mesh, "にっこり")).toBeCloseTo(1, 5);
    expect(morphInfluence(mesh, "Happy_Authored")).toBe(0);
    // A Reaction's sad brows still play the MMD brow.
    manager.setValue("happy", 0);
    manager.setValue("Fcl_BRW_Sorrow", 1);
    manager.update();
    expect(morphInfluence(mesh, "困る")).toBeCloseTo(1, 5);
    expect(morphInfluence(mesh, "Sad_Authored")).toBe(0);
  });

  it("treats presets that bind nothing as absent", () => {
    // three-vrm registers every preset, even an empty one.
    const { vrm, mesh } = syntheticFaceVrm({
      morphs: [...MMD_MORPHS, "Blink_Authored"],
      presetBinds: {
        blink: ["Blink_Authored"],
        happy: [],
        relaxed: [],
        sad: [],
        angry: [],
        surprised: [],
      },
    });
    const face = prepareLoadedVrm(vrm, { vrmSha256: null }).arkitFace;
    expect(face.moods.sad).toEqual({ brow: "mmd", eye: "none", mouth: "none" });
    const controller = new ExpressionController(vrm);
    controller.playEmotion("gloom", 3);
    settle(controller);
    expect(morphInfluence(mesh, "困る")).toBeGreaterThan(0);
    controller.dispose();
  });

  it("fills the regions MMD leaves with ARKit mixes", () => {
    const { vrm, mesh } = mmdAvatar({ arkit: true });
    const face = prepareLoadedVrm(vrm, { vrmSha256: null }).arkitFace;
    const manager = vrm.expressionManager!;

    expect(face.moods.sad).toEqual({
      brow: "mmd",
      eye: "arkit",
      mouth: "arkit",
    });
    expect(face.moods.angry).toEqual({
      brow: "mmd",
      eye: "mmd",
      mouth: "arkit",
    });
    manager.setValue("sad", 1);
    manager.update();
    expect(morphInfluence(mesh, "困る")).toBeCloseTo(1, 5);
    // MMD fills the brows, so the ARKit brow shapes stay still…
    expect(morphInfluence(mesh, "browDown_L")).toBe(0);
    // …while ARKit plays the eyes and mouth.
    expect(morphInfluence(mesh, "mouthFrown_L")).toBeGreaterThan(0);
    expect(morphInfluence(mesh, "Sad_Authored")).toBe(0);
  });

  it("smiles with the MMD mouth for positive emotions instead of relaxed", () => {
    const { vrm, mesh } = mmdAvatar();
    prepareLoadedVrm(vrm, { vrmSha256: null });
    const controller = new ExpressionController(vrm);
    controller.playEmotion("delight", 2);
    settle(controller);
    expect(morphInfluence(mesh, "にっこり")).toBeGreaterThan(0.9);
    // Its wider smile adds `Fcl_MTH_Large`, which needs ARKit's `jawOpen`.
    controller.playEmotion("affection", 3);
    expect(controller.unresolvedExpressionNames).toContain("Fcl_MTH_Large");
    controller.dispose();
  });

  it("keeps blink within shut under 笑い", () => {
    const { vrm, mesh } = mmdAvatar();
    closeLidsWith(mesh, "笑い", 0.6);
    prepareLoadedVrm(vrm, { vrmSha256: null });
    const manager = vrm.expressionManager!;
    manager.setValue("Fcl_EYE_Joy", 1);
    manager.setValue("blink", 1);
    manager.update();
    // 笑い closes 0.6 of blink's motion at the lid, which counts as most of a
    // closed smile: blink adds less than the remaining 0.4.
    expect(morphInfluence(mesh, "Blink_Authored")).toBeCloseTo(
      1 - Math.min(1, 0.6 / CLOSED_LID_PEAK_SHARE),
      5,
    );
    expect(morphInfluence(mesh, "Blink_Authored")).toBeLessThanOrEqual(0.4);
    expect(applyEyelidClosureCorrection(vrm, null)?.source).toBe("measured");
  });

  it("leaves lip-sync visemes to lip sync", () => {
    const { vrm, mesh } = mmdAvatar();
    prepareLoadedVrm(vrm, { vrmSha256: null });
    const controller = new ExpressionController(vrm);
    controller.playEmotion("alarm", 3);
    settle(controller);
    // The surprised mouth is MMD's お, never the `aa` viseme.
    expect(morphInfluence(mesh, "お")).toBeGreaterThan(0);
    expect(morphInfluence(mesh, "Viseme_A")).toBe(0);
    controller.dispose();
  });
});
