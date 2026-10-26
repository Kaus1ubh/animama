import { describe, expect, it } from "vitest";

import { ARKIT_BLENDSHAPES } from "./arkit";
import {
  resolveArkitFaceCapability,
  resolveArkitFacesPerMesh,
} from "./arkitFaceCapability";

const resolvedOf = (names: string[]) =>
  Object.fromEntries(resolveArkitFaceCapability(names).resolved);

describe("resolveArkitFaceCapability", () => {
  it("resolves every canonical ARKit name to itself", () => {
    const capability = resolveArkitFaceCapability([
      ...ARKIT_BLENDSHAPES,
      "Fcl_MTH_A",
    ]);
    expect(capability.missing).toEqual([]);
    expect(capability.ambiguous.size).toBe(0);
    for (const name of ARKIT_BLENDSHAPES) {
      expect(capability.resolved.get(name)).toEqual([name]);
    }
  });

  it("matches case, separator and side variants", () => {
    expect(
      resolvedOf([
        "JawOpen",
        "MouthSmile_L",
        "mouthsmileright",
        "eyeBlink.L",
        "EYE_BLINK_R",
        "browDown-Left",
        "mouthLowerDownR",
      ]),
    ).toEqual({
      jawOpen: ["JawOpen"],
      mouthSmileLeft: ["MouthSmile_L"],
      mouthSmileRight: ["mouthsmileright"],
      eyeBlinkLeft: ["eyeBlink.L"],
      eyeBlinkRight: ["EYE_BLINK_R"],
      browDownLeft: ["browDown-Left"],
      mouthLowerDownRight: ["mouthLowerDownR"],
    });
  });

  it("matches SRanipal names with the side in the middle", () => {
    expect(
      resolvedOf([
        "Eye_Left_Blink",
        "Eye_Right_Wide",
        "Jaw_Open",
        "Mouth_Smile_Left",
        "Mouth_Sad_Right",
        "Mouth_Pout",
        "Mouth_O_Shape",
        "Mouth_Upper_Inside",
      ]),
    ).toEqual({
      eyeBlinkLeft: ["Eye_Left_Blink"],
      eyeWideRight: ["Eye_Right_Wide"],
      jawOpen: ["Jaw_Open"],
      mouthSmileLeft: ["Mouth_Smile_Left"],
      mouthFrownRight: ["Mouth_Sad_Right"],
      mouthPucker: ["Mouth_Pout"],
      mouthFunnel: ["Mouth_O_Shape"],
      mouthRollUpper: ["Mouth_Upper_Inside"],
    });
  });

  it("matches Unified Expressions names and joins split unsided shapes", () => {
    expect(
      resolvedOf([
        "EyeClosedLeft",
        "BrowLowererRight",
        "MouthCornerPullLeft",
        "MouthClosed",
        "BrowInnerUpLeft",
        "BrowInnerUpRight",
        "CheekPuffLeft",
        "CheekPuffRight",
        "LipSuckLower",
      ]),
    ).toEqual({
      eyeBlinkLeft: ["EyeClosedLeft"],
      browDownRight: ["BrowLowererRight"],
      mouthSmileLeft: ["MouthCornerPullLeft"],
      mouthClose: ["MouthClosed"],
      browInnerUp: ["BrowInnerUpLeft", "BrowInnerUpRight"],
      cheekPuff: ["CheekPuffLeft", "CheekPuffRight"],
      mouthRollLower: ["LipSuckLower"],
    });
  });

  it("prefers the exact name, then case, then key, then alias", () => {
    expect(
      resolvedOf(["mouthSmileLeft", "MouthSmile_L", "MouthCornerPullLeft"])
        .mouthSmileLeft,
    ).toEqual(["mouthSmileLeft"]);
    expect(
      resolvedOf(["JAWOPEN", "Jaw_Open"]).jawOpen,
      "a case-insensitive match beats a key match",
    ).toEqual(["JAWOPEN"]);
    expect(
      resolvedOf(["MouthSmile_L", "MouthCornerPullLeft"]).mouthSmileLeft,
    ).toEqual(["MouthSmile_L"]);
    expect(
      resolvedOf(["browInnerUp", "BrowInnerUpLeft", "BrowInnerUpRight"])
        .browInnerUp,
      "an unsided shape beats a pair of halves",
    ).toEqual(["browInnerUp"]);
  });

  it("reports equal candidates as ambiguous instead of guessing", () => {
    const capability = resolveArkitFaceCapability([
      "MouthSmile_L",
      "mouth_smile_left",
    ]);
    expect(capability.resolved.has("mouthSmileLeft")).toBe(false);
    expect(capability.ambiguous.get("mouthSmileLeft")).toEqual([
      "MouthSmile_L",
      "mouth_smile_left",
    ]);
    expect(capability.missing).toContain("mouthSmileLeft");
  });

  it("does not treat a lone side letter or unrelated names as shapes", () => {
    const capability = resolveArkitFaceCapability([
      "L",
      "Fcl_EYE_Close_L",
      "vrc.v_aa",
      "happy",
    ]);
    expect(capability.resolved.size).toBe(0);
    expect(capability.missing).toHaveLength(ARKIT_BLENDSHAPES.length);
  });
});

describe("resolveArkitFacesPerMesh", () => {
  it("resolves each mesh's own spelling and merges the summary", () => {
    const faces = resolveArkitFacesPerMesh([
      ["MouthSmile_L", "Jaw_Open"],
      ["mouthSmileLeft", "MouthSmile_L"],
      ["Mouth_Smile_R", "MouthSmile_R"],
    ]);
    expect(faces.meshes.map((mesh) => Object.fromEntries(mesh))).toEqual([
      { mouthSmileLeft: ["MouthSmile_L"], jawOpen: ["Jaw_Open"] },
      { mouthSmileLeft: ["mouthSmileLeft"] },
      {},
    ]);
    expect(faces.capability.resolved.get("mouthSmileLeft")).toEqual([
      "MouthSmile_L",
      "mouthSmileLeft",
    ]);
    // Ambiguous only because no mesh resolves it.
    expect(faces.capability.ambiguous.get("mouthSmileRight")).toEqual([
      "Mouth_Smile_R",
      "MouthSmile_R",
    ]);
    expect(faces.capability.missing).toContain("mouthSmileRight");
  });

  it("reports a mesh's ambiguity even when another mesh resolves the shape", () => {
    const faces = resolveArkitFacesPerMesh([
      ["MouthSmile_L", "Mouth_Smile_L"],
      ["mouthSmileLeft"],
    ]);
    expect(faces.capability.resolved.get("mouthSmileLeft")).toEqual([
      "mouthSmileLeft",
    ]);
    expect(faces.capability.ambiguous.get("mouthSmileLeft")).toEqual([
      "MouthSmile_L",
      "Mouth_Smile_L",
    ]);
    expect(faces.capability.missing).not.toContain("mouthSmileLeft");
  });
});
