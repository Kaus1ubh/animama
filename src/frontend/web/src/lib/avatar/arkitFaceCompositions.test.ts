import { describe, expect, it } from "vitest";

import { ARKIT_BLENDSHAPES } from "./arkit";
import { resolveArkitFaceCapability } from "./arkitFaceCapability";
import {
  ARKIT_COMPOSITION_SHAPES,
  ARKIT_MOOD_MIXES,
  ARKIT_PART_MIXES,
  playsFacesWithArkit,
} from "./arkitFaceCompositions";

describe("ARKit face compositions", () => {
  it("uses only canonical ARKit shapes with weights in 0..1", () => {
    for (const shape of ARKIT_COMPOSITION_SHAPES) {
      expect(ARKIT_BLENDSHAPES).toContain(shape);
    }
    for (const mix of [
      ...Object.values(ARKIT_MOOD_MIXES),
      ...Object.values(ARKIT_PART_MIXES),
    ]) {
      for (const value of Object.values(mix)) {
        expect(value).toBeGreaterThan(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("defines every mood preset as the union of its regions", () => {
    expect(Object.keys(ARKIT_MOOD_MIXES).sort()).toEqual([
      "angry",
      "happy",
      "relaxed",
      "sad",
      "surprised",
    ]);
    expect(ARKIT_MOOD_MIXES.sad).toEqual({
      browInnerUp: 0.9,
      browDownLeft: 0.15,
      browDownRight: 0.15,
      eyeBlinkLeft: 0.2,
      eyeBlinkRight: 0.2,
      eyeSquintLeft: 0.2,
      eyeSquintRight: 0.2,
      mouthFrownLeft: 1,
      mouthFrownRight: 1,
      mouthStretchLeft: 0.3,
      mouthStretchRight: 0.3,
      mouthShrugLower: 0.4,
    });
  });

  it("gives each VRoid mood part its region and keeps the extra parts", () => {
    expect(ARKIT_PART_MIXES.Fcl_BRW_Angry).toEqual({
      browDownLeft: 0.9,
      browDownRight: 0.9,
    });
    expect(ARKIT_PART_MIXES.Fcl_MTH_Fun).toEqual({
      mouthSmileLeft: 1,
      mouthSmileRight: 1,
    });
    expect(ARKIT_PART_MIXES.Fcl_ALL_Surprised).toEqual(
      ARKIT_MOOD_MIXES.surprised,
    );
    expect(ARKIT_PART_MIXES.Fcl_EYE_Close_L).toEqual({ eyeBlinkLeft: 1 });
    // Every mood part content keys is covered.
    for (const mood of ["Joy", "Fun", "Sorrow", "Surprised", "Angry"]) {
      for (const part of ["ALL", "BRW", "EYE", "MTH"]) {
        expect(ARKIT_PART_MIXES[`Fcl_${part}_${mood}`]).toBeDefined();
      }
    }
  });

  it("needs every shape the table uses", () => {
    expect(
      playsFacesWithArkit(resolveArkitFaceCapability(ARKIT_BLENDSHAPES)),
    ).toBe(true);
    expect(
      playsFacesWithArkit(
        resolveArkitFaceCapability(
          ARKIT_BLENDSHAPES.filter((shape) => shape !== "noseSneerLeft"),
        ),
      ),
    ).toBe(false);
  });
});
