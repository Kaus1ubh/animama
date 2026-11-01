import { describe, expect, it } from "vitest";

import { ARKIT_BLENDSHAPES } from "./arkit";
import { resolveArkitFaceCapability } from "./arkitFaceCapability";
import {
  ARKIT_COMPOSITION_SHAPES,
  ARKIT_MOOD_MIXES,
  ARKIT_PART_MIXES,
  ARKIT_VOWEL_MIXES,
  ARKIT_VOWEL_SHAPES,
  arkitVowelWeights,
  shapesVowelsWithArkit,
  VOWEL5_CHANNELS,
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

  it("gives each vowel5 channel a mouth-only mix of canonical shapes", () => {
    expect(Object.keys(ARKIT_VOWEL_MIXES).sort()).toEqual(
      [...VOWEL5_CHANNELS].sort(),
    );
    for (const shape of ARKIT_VOWEL_SHAPES) {
      expect(ARKIT_BLENDSHAPES).toContain(shape);
      expect(shape).toMatch(/^(jaw|mouth)/);
    }
    // The vowel table does not feed the mood table's bar.
    const moodAndPartShapes = new Set(
      [
        ...Object.values(ARKIT_MOOD_MIXES),
        ...Object.values(ARKIT_PART_MIXES),
      ].flatMap((mix) => Object.keys(mix)),
    );
    expect([...ARKIT_COMPOSITION_SHAPES].sort()).toEqual(
      [...moodAndPartShapes].sort(),
    );
  });

  it("sums vowel channels into clamped shape weights, listing every shape", () => {
    const weights = arkitVowelWeights([1, 0, 0, 1, 0]);
    expect(Object.keys(weights).sort()).toEqual([...ARKIT_VOWEL_SHAPES].sort());
    // A and O both open the jaw.
    expect(weights.jawOpen).toBeCloseTo(
      ARKIT_VOWEL_MIXES.A.jawOpen! + ARKIT_VOWEL_MIXES.O.jawOpen!,
      5,
    );
    expect(arkitVowelWeights([0, 0, 0, 0, 0]).jawOpen).toBe(0);
    expect(arkitVowelWeights([9, 9, 9, 9, 9]).jawOpen).toBeLessThanOrEqual(1);
  });

  it("shapes vowels only with every vowel shape", () => {
    expect(
      shapesVowelsWithArkit(resolveArkitFaceCapability(ARKIT_BLENDSHAPES)),
    ).toBe(true);
    expect(
      shapesVowelsWithArkit(
        resolveArkitFaceCapability(
          ARKIT_BLENDSHAPES.filter((shape) => shape !== "mouthPucker"),
        ),
      ),
    ).toBe(false);
  });
});
