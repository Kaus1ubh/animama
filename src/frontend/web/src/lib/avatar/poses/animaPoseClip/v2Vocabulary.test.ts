import { describe, expect, it } from "vitest";

import { JOINT_DEFINITIONS, JOINT_IDS, resolveJoint } from "../anatomy/anatomy";
import {
  HAND_ADJUSTMENT_LIMITS,
  HAND_DIGIT_OFFSETS,
  HAND_DIGITS,
  HAND_FINGER_OFFSET_LIMIT,
  HAND_PRESETS,
} from "../anatomy/handPresetIds";
import vocabulary from "./fixtures/v2-vocabulary.json";
import {
  ANIMA_POSE_CLIP_EASES,
  ANIMA_POSE_CLIP_V2_LIMITS,
  ANIMA_POSE_CLIP_V2_MIN_SPACING,
  ANIMA_POSE_CLIP_V2_VALUE_BOUNDS,
} from "./schemaV2";

// The backend validator reads the same file (tests/test_pose_clip_v2.py), so
// a vocabulary change here must be mirrored there.
describe("animaPoseClip/2.0 shared vocabulary", () => {
  it("matches the frontend joint model, hand vocabulary, eases and limits", () => {
    expect(vocabulary.joints).toEqual(
      Object.fromEntries(
        JOINT_IDS.map((id) => [
          id,
          Object.keys(JOINT_DEFINITIONS[resolveJoint(id)!.type].components),
        ]),
      ),
    );
    expect(vocabulary.handPresets).toEqual(HAND_PRESETS.map(({ id }) => id));
    expect(vocabulary.handAdjustmentLimits).toEqual(HAND_ADJUSTMENT_LIMITS);
    expect(Object.keys(vocabulary.handDigitOffsets)).toEqual(HAND_DIGITS);
    expect(vocabulary.handDigitOffsets).toEqual(HAND_DIGIT_OFFSETS);
    expect(vocabulary.handFingerOffsetLimit).toBe(HAND_FINGER_OFFSET_LIMIT);
    expect([...vocabulary.eases].sort()).toEqual(
      [...ANIMA_POSE_CLIP_EASES].sort(),
    );
    expect(vocabulary.minSpacingSeconds).toBe(ANIMA_POSE_CLIP_V2_MIN_SPACING);
    expect(vocabulary.limits).toEqual({
      durationSeconds: ANIMA_POSE_CLIP_V2_LIMITS.duration,
      beats: ANIMA_POSE_CLIP_V2_LIMITS.beats,
      tracks: ANIMA_POSE_CLIP_V2_LIMITS.tracks,
      keys: ANIMA_POSE_CLIP_V2_LIMITS.keys,
      beatIdLength: ANIMA_POSE_CLIP_V2_LIMITS.idLength,
      labelLength: ANIMA_POSE_CLIP_V2_LIMITS.labelLength,
    });
    expect(vocabulary.valueBounds).toEqual(ANIMA_POSE_CLIP_V2_VALUE_BOUNDS);
  });

  it("offsets only components of each digit's finger joints", () => {
    const capital = (name: string) => name[0].toUpperCase() + name.slice(1);
    for (const [digit, { fields, segments }] of Object.entries(
      HAND_DIGIT_OFFSETS,
    ))
      for (const segment of segments) {
        const joint = resolveJoint(`left${capital(digit)}${capital(segment)}`);
        expect(joint, `${digit} ${segment}`).not.toBeNull();
        expect(Object.keys(JOINT_DEFINITIONS[joint!.type].components)).toEqual(
          expect.arrayContaining([...fields]),
        );
      }
  });
});
