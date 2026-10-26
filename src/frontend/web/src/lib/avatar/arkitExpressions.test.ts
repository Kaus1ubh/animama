import { describe, expect, it } from "vitest";

import { ExpressionController } from "./ExpressionController";
import { loadTestAvatar } from "./motion-authoring/testing/includedAvatars";
import { morphInfluence, syntheticFaceVrm } from "./testing/syntheticFaceVrm";

describe("ARKit expressions", () => {
  it("drives an Avatar's own ARKit morphs by canonical name", () => {
    const { vrm, mesh } = syntheticFaceVrm({
      morphs: [
        "MouthSmile_L",
        "Jaw_Open",
        "BrowInnerUpLeft",
        "BrowInnerUpRight",
      ],
    });
    const controller = new ExpressionController(vrm);
    const manager = vrm.expressionManager!;

    manager.setValue("mouthSmileLeft", 0.6);
    manager.setValue("jawOpen", 0.3);
    manager.setValue("browInnerUp", 0.5);
    manager.update();

    expect(morphInfluence(mesh, "MouthSmile_L")).toBeCloseTo(0.6, 5);
    expect(morphInfluence(mesh, "Jaw_Open")).toBeCloseTo(0.3, 5);
    expect(morphInfluence(mesh, "BrowInnerUpLeft")).toBeCloseTo(0.5, 5);
    expect(morphInfluence(mesh, "BrowInnerUpRight")).toBeCloseTo(0.5, 5);
    expect(controller.getArkitFaceCapability().resolved.size).toBe(3);
    controller.dispose();
  });

  it("binds each mesh's own spelling of a shape", () => {
    const face = syntheticFaceVrm({ morphs: ["MouthSmile_L"] });
    const teeth = syntheticFaceVrm({ morphs: ["mouthSmileLeft"] }).mesh;
    face.vrm.scene.add(teeth);
    const controller = new ExpressionController(face.vrm);

    face.vrm.expressionManager!.setValue("mouthSmileLeft", 0.4);
    face.vrm.expressionManager!.update();
    expect(morphInfluence(face.mesh, "MouthSmile_L")).toBeCloseTo(0.4, 5);
    expect(morphInfluence(teeth, "mouthSmileLeft")).toBeCloseTo(0.4, 5);
    controller.dispose();
  });

  it("keeps an expression the file already authored under an ARKit name", () => {
    const { vrm, mesh } = syntheticFaceVrm({
      morphs: ["jawOpen", "JawOpenAlt"],
      presets: ["jawOpen"],
    });
    const authored = vrm.expressionManager!.getExpression("jawOpen");
    const controller = new ExpressionController(vrm);

    expect(vrm.expressionManager!.getExpression("jawOpen")).toBe(authored);
    vrm.expressionManager!.setValue("jawOpen", 1);
    vrm.expressionManager!.update();
    expect(morphInfluence(mesh, "jawOpen")).toBeCloseTo(1, 5);
    expect(morphInfluence(mesh, "JawOpenAlt")).toBe(0);
    controller.dispose();
  });

  it("finds no ARKit shapes on an Included VRoid Avatar", async () => {
    const vrm = await loadTestAvatar("AvatarSample_A_1_New");
    const controller = new ExpressionController(vrm);
    expect(controller.getArkitFaceCapability().resolved.size).toBe(0);
    controller.dispose();
  });
});
