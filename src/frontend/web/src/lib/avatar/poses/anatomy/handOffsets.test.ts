import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import { beforeAll, describe, expect, it } from "vitest";

import { loadTestAvatar } from "../../motion-authoring/testing/includedAvatars";
import {
  angularDistanceDegrees,
  composeJointRotation,
  decomposeJointRotation,
  resolveJoint,
} from "./anatomy";
import {
  adjustHandShape,
  fitHandShape,
  fitHandShapeOffsets,
  isOffsetExpressible,
  normalizeHandShape,
} from "./handOffsets";
import {
  adjustHandQuaternion,
  handShapeRotations,
  resolveHandBones,
  type HandShape,
} from "./handPresets";

describe.each(["Annie", "Andrew"] as const)(
  "hand offsets on %s",
  (avatarId) => {
    let vrm: VRM;
    beforeAll(async () => {
      vrm = await loadTestAvatar(avatarId);
    });

    it("reads finger rotations back as the offsets that play them", () => {
      const shape: HandShape = {
        preset: "pinch",
        curl: 5,
        fingers: {
          thumb: { curl: [3, -6], palmarAbduction: 5, twist: -4 },
          index: { curl: [5, 10, 0], splay: 4 },
          little: { curl: 12 },
        },
      };
      const rotations = handShapeRotations(vrm, "right", shape, undefined);
      const fit = fitHandShapeOffsets(
        vrm,
        "right",
        { preset: "pinch", curl: 5 },
        rotations,
        undefined,
      );
      expect(fit.shape).toEqual(shape);
      for (const residual of fit.residuals.values())
        expect(residual).toBeLessThan(0.02);
    });

    it("reports what offsets cannot express", () => {
      const rotations = handShapeRotations(
        vrm,
        "left",
        { preset: "open-spread" },
        undefined,
      );
      const bone: VRMHumanBoneName = "leftMiddleIntermediate";
      const joint = resolveJoint(bone)!;
      const values = decomposeJointRotation(joint, rotations.get(bone)!);
      // Twist and splay past the proximal segment are not offsets.
      const twisted = composeJointRotation(joint, {
        ...values,
        twist: values.twist + 8,
        splay: values.splay + 5,
      });
      const fit = fitHandShapeOffsets(
        vrm,
        "left",
        { preset: "open-spread" },
        new Map([[bone, twisted]]),
        undefined,
      );
      expect(fit.residuals.get(bone)).toBeGreaterThan(5);
      expect(fit.shape).toEqual({ preset: "open-spread" });
    });

    it("finds the preset a hand plays, without offsets when it matches", () => {
      for (const preset of ["relaxed", "soft-claw", "ok"] as const) {
        const rotations = handShapeRotations(
          vrm,
          "right",
          { preset },
          undefined,
        );
        expect(
          fitHandShape(vrm, "right", rotations, undefined, 0.5),
          preset,
        ).toEqual({ preset });
      }
    });

    it("curls and spreads some segments as offsets, as the Hands tool turns them", () => {
      const start: HandShape = { preset: "open-together" };
      const bones = resolveHandBones({ vrm }, "right").available;
      const index = bones.filter((bone) => bone.segment.digit === "index");
      const thumbBase = bones.find(
        (bone) => bone.segment.id === "thumbProximal",
      )!;
      const curled = adjustHandShape(start, "right", "curl", 30, [index[1]]);
      expect(curled).toEqual({
        preset: "open-together",
        fingers: { index: { curl: [0, 30, 0] } },
      });
      // On a straight segment, a curl offset is exactly the Hands tool's Curl.
      const before = handShapeRotations(vrm, "right", start, undefined);
      const after = handShapeRotations(vrm, "right", curled, undefined);
      const name = index[1].boneName as VRMHumanBoneName;
      expect(
        angularDistanceDegrees(
          after.get(name)!,
          adjustHandQuaternion(before.get(name)!, "right", "index", "curl", 30),
        ),
      ).toBeLessThan(1e-6);
      // Spread reaches proximal segments only: index splay, thumb curl.
      expect(
        adjustHandShape(start, "right", "spread", 10, [...index, thumbBase]),
      ).toEqual({
        preset: "open-together",
        fingers: { thumb: { curl: [-10, 0] }, index: { splay: 6.5 } },
      });
    });
  },
);

describe("isOffsetExpressible", () => {
  /** A rotation's joint-model components changed by `change` (degrees). */
  const turned = (
    bone: VRMHumanBoneName,
    start: Record<string, number>,
    change: Record<string, number>,
  ) => {
    const joint = resolveJoint(bone)!;
    const values = { ...start };
    for (const [name, value] of Object.entries(change))
      values[name] = (values[name] ?? 0) + value;
    return [
      composeJointRotation(joint, start),
      composeJointRotation(joint, values),
    ] as const;
  };
  it.each([
    ["rightIndexProximal", { curl: 12 }, true],
    ["rightIndexProximal", { splay: 6 }, true],
    ["rightIndexProximal", { twist: 6 }, false],
    ["rightIndexDistal", { curl: -20 }, true],
    ["rightIndexIntermediate", { splay: 4 }, false],
    ["leftThumbProximal", { twist: 10, palmarAbduction: -5 }, true],
    ["leftThumbDistal", { twist: 3 }, false],
  ] as const)("%s %o: %s", (bone, change, expected) => {
    // From a curled, splayed pose, as between two keys.
    const [from, to] = turned(bone, { curl: 35, splay: 8, twist: 3 }, change);
    expect(isOffsetExpressible(bone, from, to, 0.5)).toBe(expected);
  });
});

describe("hand shapes", () => {
  it("adjusts the whole hand's Curl and Spread within their limits", () => {
    const start: HandShape = { preset: "fist", curl: 40, spread: -5 };
    expect(adjustHandShape(start, "left", "curl", 70, "hand")).toEqual({
      preset: "fist",
      curl: 90,
      spread: -5,
    });
    expect(adjustHandShape(start, "left", "spread", 5, "hand")).toEqual({
      preset: "fist",
      curl: 40,
    });
  });

  it("stores offsets compactly", () => {
    expect(
      normalizeHandShape({
        preset: "relaxed",
        curl: 0,
        fingers: {
          index: { curl: [5, 5, 5], splay: 0 },
          middle: { curl: 0 },
          thumb: { curl: [0, 2], twist: 0 },
        },
      }),
    ).toEqual({
      preset: "relaxed",
      fingers: { index: { curl: 5 }, thumb: { curl: [0, 2] } },
    });
  });
});
