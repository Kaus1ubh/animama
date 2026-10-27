import { describe, expect, it } from "vitest";

import { ARKIT_BLENDSHAPES } from "./arkit";
import { arkitMixOf } from "./arkitFaceExpressions";
import { prepareLoadedVrm } from "./prepareLoadedVrm";
import { morphInfluence, syntheticFaceVrm } from "./testing/syntheticFaceVrm";

/** Every ARKit shape plus a blink on the ARKit eyelids. */
function arkitFace() {
  return syntheticFaceVrm({
    morphs: ARKIT_BLENDSHAPES,
    presetBinds: { blink: ["eyeBlinkLeft", "eyeBlinkRight"] },
  });
}

describe("prepareLoadedVrm", () => {
  it("registers ARKit faces before measuring the eyelid correction", () => {
    const { vrm, mesh } = arkitFace();
    const prepared = prepareLoadedVrm(vrm, { vrmSha256: null });
    const manager = vrm.expressionManager!;

    expect(prepared.arkitFace.playsFacesWithArkit).toBe(true);
    expect(arkitMixOf(manager.getExpression("relaxed")!)).not.toBeNull();
    // relaxed partly closes the lids, so a full blink fills only the rest:
    // the correction saw the mix, which exists only because ARKit ran first.
    manager.setValue("relaxed", 1);
    manager.setValue("blink", 1);
    manager.update();
    expect(morphInfluence(mesh, "eyeBlinkLeft")).toBeCloseTo(1, 5);
    expect(prepared.eyelidClosure).not.toBeNull();
  });

  it("is safe to call twice on the same model", () => {
    const { vrm } = arkitFace();
    prepareLoadedVrm(vrm, { vrmSha256: null });
    const happy = vrm.expressionManager!.getExpression("happy");
    prepareLoadedVrm(vrm, { vrmSha256: null });
    expect(vrm.expressionManager!.getExpression("happy")).toBe(happy);
  });

  it("leaves a model without blink uncorrected", () => {
    const { vrm } = syntheticFaceVrm({ morphs: ["aa"], presets: ["aa"] });
    expect(prepareLoadedVrm(vrm, { vrmSha256: null }).eyelidClosure).toBeNull();
  });
});
