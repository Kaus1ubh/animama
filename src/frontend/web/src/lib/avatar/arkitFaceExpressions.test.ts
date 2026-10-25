import { describe, expect, it } from "vitest";

import { ARKIT_BLENDSHAPES } from "./arkit";
import { registerArkitFace } from "./arkitFaceExpressions";
import { applyEyelidClosureCorrection } from "./eyelidClosure";
import { ExpressionController } from "./ExpressionController";
import { morphInfluence, syntheticFaceVrm } from "./testing/syntheticFaceVrm";

/**
 * A converted-VRChat-style face: every ARKit shape under a `_L`/`_R`
 * spelling, the converter's blink on the ARKit eyelids, and an authored `sad`
 * preset on a morph of its own.
 */
function arkitAvatar(options: { omit?: string; extraMorphs?: string[] } = {}) {
  const spell = (shape: string) =>
    shape.replace(/Left$/, "_L").replace(/Right$/, "_R");
  const morphs = ARKIT_BLENDSHAPES.filter((shape) => shape !== options.omit)
    .map(spell)
    .concat("Sad_Authored", ...(options.extraMorphs ?? []));
  return syntheticFaceVrm({
    morphs,
    presetBinds: {
      blink: ["eyeBlink_L", "eyeBlink_R"],
      sad: ["Sad_Authored"],
    },
  });
}

/** Run the controller long enough for emotion fades to settle. */
function settle(controller: ExpressionController) {
  for (let frame = 0; frame < 120; frame += 1) controller.update(1 / 30);
}

describe("ARKit face expressions", () => {
  it("plays mood presets as ARKit mixes, replacing authored ones", () => {
    const { vrm, mesh } = arkitAvatar();
    const authoredSad = vrm.expressionManager!.getExpression("sad");
    const face = registerArkitFace(vrm);
    const manager = vrm.expressionManager!;

    expect(face.playsFacesWithArkit).toBe(true);
    expect(manager.getExpression("sad")).not.toBe(authoredSad);
    manager.setValue("happy", 1);
    manager.setValue("sad", 0.5);
    manager.update();
    expect(morphInfluence(mesh, "mouthSmile_L")).toBeCloseTo(1, 5);
    expect(morphInfluence(mesh, "cheekSquint_R")).toBeCloseTo(0.8, 5);
    // happy's 0.2 plus half of sad's 0.9.
    expect(morphInfluence(mesh, "browInnerUp")).toBeCloseTo(0.65, 5);
    expect(morphInfluence(mesh, "Sad_Authored")).toBe(0);

    const happy = manager.getExpression("happy");
    registerArkitFace(vrm);
    expect(manager.getExpression("happy"), "a second call keeps it").toBe(
      happy,
    );
  });

  it("leaves an Avatar missing a table shape as it was", () => {
    const { vrm } = arkitAvatar({ omit: "noseSneerLeft" });
    const authoredSad = vrm.expressionManager!.getExpression("sad");
    const face = registerArkitFace(vrm);
    expect(face.playsFacesWithArkit).toBe(false);
    expect(vrm.expressionManager!.getExpression("sad")).toBe(authoredSad);
    expect(vrm.expressionManager!.getExpression("happy")).toBeNull();
    expect(vrm.expressionManager!.getExpression("Fcl_BRW_Joy")).toBeNull();
  });

  it("leaves a VRoid face with added ARKit shapes as authored", () => {
    // A VRoid model with "Perfect Sync" shapes keeps its own parts and presets.
    const { vrm, mesh } = arkitAvatar({ extraMorphs: ["Fcl_MTH_Fun"] });
    const authoredSad = vrm.expressionManager!.getExpression("sad");
    const controller = new ExpressionController(vrm);

    expect(vrm.expressionManager!.getExpression("sad")).toBe(authoredSad);
    controller.setExpressionOverlay("reaction", { Fcl_MTH_Fun: 1 });
    controller.update(1 / 30);
    expect(morphInfluence(mesh, "Fcl_MTH_Fun")).toBeCloseTo(1, 5);
    expect(morphInfluence(mesh, "mouthSmile_L")).toBe(0);
    controller.dispose();
  });

  it("keeps a non-mood VRoid part the file has as a morph", () => {
    const { vrm, mesh } = arkitAvatar({ extraMorphs: ["Fcl_EYE_Close"] });
    const controller = new ExpressionController(vrm);
    expect(controller.getAvailableExpressions()).toContain("happy");
    vrm.expressionManager!.setValue("Fcl_EYE_Close", 1);
    vrm.expressionManager!.update();
    expect(morphInfluence(mesh, "Fcl_EYE_Close")).toBeCloseTo(1, 5);
    expect(morphInfluence(mesh, "eyeBlink_L")).toBe(0);
    controller.dispose();
  });

  it("plays emotions and VRoid-part Reactions, mouths included", () => {
    const { vrm, mesh } = arkitAvatar();
    const controller = new ExpressionController(vrm);

    controller.playEmotion("gloom", 2);
    settle(controller);
    expect(morphInfluence(mesh, "mouthFrown_L")).toBeCloseTo(0.5, 2);

    controller.playEmotion("delight", 1);
    controller.setExpressionOverlay("reaction", {
      Fcl_BRW_Angry: 0.5,
      Fcl_MTH_Angry: 0.5,
    });
    settle(controller);
    // Delight 1 keys Fcl_MTH_Fun 0.6: the mouth part plays instead of the
    // relaxed fallback a part-less Avatar gets.
    expect(morphInfluence(mesh, "mouthSmile_L")).toBeCloseTo(0.6, 2);
    expect(morphInfluence(mesh, "browDown_R")).toBeCloseTo(0.45, 2);
    expect(morphInfluence(mesh, "mouthPress_L")).toBeCloseTo(0.3, 2);
    // Only the angry mouth's frown remains; gloom's has faded out.
    expect(morphInfluence(mesh, "mouthFrown_L")).toBeCloseTo(0.3, 2);
    controller.dispose();
  });

  it("lists each ARKit shape once, under its canonical name", () => {
    const { vrm } = arkitAvatar();
    const controller = new ExpressionController(vrm);
    const available = controller.getAvailableExpressions();
    expect(available).toContain("mouthSmileLeft");
    expect(available).not.toContain("mouthSmile_L");
    expect(available).toContain("Fcl_EYE_Sorrow");
    controller.dispose();
  });

  it("keeps blink from closing the eyelids past shut under a mix", () => {
    const { vrm, mesh } = arkitAvatar();
    registerArkitFace(vrm);
    applyEyelidClosureCorrection(vrm, null);
    const manager = vrm.expressionManager!;

    manager.setValue("relaxed", 1);
    manager.setValue("blink", 1);
    manager.update();
    // relaxed holds the lids 0.15 closed, so blink adds only the remaining 0.85.
    expect(morphInfluence(mesh, "eyeBlink_L")).toBeCloseTo(1, 5);
    expect(morphInfluence(mesh, "eyeBlink_R")).toBeCloseTo(1, 5);

    manager.setValue("relaxed", 0);
    manager.update();
    expect(morphInfluence(mesh, "eyeBlink_L")).toBeCloseTo(1, 5);
  });

  it("lets the open eye blink fully during a wink", () => {
    const { vrm, mesh } = arkitAvatar();
    registerArkitFace(vrm);
    applyEyelidClosureCorrection(vrm, null);
    const manager = vrm.expressionManager!;

    manager.setValue("Fcl_EYE_Close_L", 1);
    manager.setValue("blink", 1);
    manager.update();
    expect(morphInfluence(mesh, "eyeBlink_R")).toBeCloseTo(1, 5);
  });
});
