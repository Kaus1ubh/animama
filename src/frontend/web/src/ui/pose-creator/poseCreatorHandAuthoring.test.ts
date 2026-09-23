import { describe, expect, it } from "vitest";
import { Object3D, Quaternion, Vector3 } from "three";
import type { Avatar } from "@/lib/avatar";
import { convertPoseQuaternionBasis } from "@/lib/avatar/poses/poseRetargeting";
import {
  HAND_SEGMENTS,
  handPresetQuaternion,
  adjustHandQuaternion,
} from "./poseCreatorHandAuthoring";
describe("hand adjustments", () => {
  it("curls normalized fingers in corresponding opposite directions", () => {
    const left = adjustHandQuaternion(
      new Quaternion(),
      "left",
      "index",
      "curl",
      30,
    );
    const right = adjustHandQuaternion(
      new Quaternion(),
      "right",
      "index",
      "curl",
      30,
    );
    expect(left.angleTo(new Quaternion())).toBeCloseTo(Math.PI / 6);
    expect(left.z).toBeLessThan(0);
    expect(right.z).toBeGreaterThan(0);
  });
  it("uses a stable captured pose without overwriting other rotations", () => {
    const start = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 0.4);
    const actual = adjustHandQuaternion(start, "left", "index", "curl", 30);
    const expected = start
      .clone()
      .multiply(
        new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), Math.PI / 6),
      );
    expect(actual.angleTo(expected)).toBeCloseTo(0);
    expect(
      adjustHandQuaternion(start, "left", "index", "curl", 30).toArray(),
    ).toEqual(actual.toArray());
    expect(start.x).toBeCloseTo(Math.sin(0.2));
  });
});

describe("calibrated hand directions", () => {
  it("fans fingers outward and curls the thumb inward", () => {
    const forward = new Vector3(1, 0, 0);
    expect(
      forward
        .clone()
        .applyQuaternion(
          adjustHandQuaternion(new Quaternion(), "left", "index", "spread", 30),
        ).z,
    ).toBeGreaterThan(0);
    expect(
      forward
        .clone()
        .applyQuaternion(
          adjustHandQuaternion(
            new Quaternion(),
            "left",
            "little",
            "spread",
            30,
          ),
        ).z,
    ).toBeLessThan(0);
    expect(
      adjustHandQuaternion(new Quaternion(), "left", "thumb", "curl", 30).y,
    ).toBeGreaterThan(0);
    expect(
      adjustHandQuaternion(new Quaternion(), "left", "thumb", "spread", 30).y,
    ).toBeLessThan(0);
    expect(HAND_SEGMENTS).toHaveLength(14);
    expect(
      HAND_SEGMENTS.some((segment) => segment.segment === "metacarpal"),
    ).toBe(false);
  });
  it.each(
    (["left", "right"] as const).flatMap((side) =>
      (["0", "1"] as const).flatMap((version) =>
        (["open-together", "fist"] as const).flatMap((preset) =>
          [0, 0.56].map((angle) => ({ side, version, preset, angle })),
        ),
      ),
    ),
  )(
    "fits $side $preset in VRM$version around metacarpal $angle",
    ({ side, version, preset, angle }) => {
      const hand = new Object3D();
      hand.scale.setScalar(1.7);
      hand.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), 0.4);
      const meta = new Object3D();
      hand.add(meta);
      meta.quaternion.setFromAxisAngle(
        new Vector3(0, 1, 0),
        side === "left" ? angle : -angle,
      );
      const proximal = new Object3D();
      proximal.position.set(0.0323, -0.01008, 0.03861);
      meta.add(proximal);
      const distal = new Object3D();
      distal.position.set(0.01873, -0.00081, 0.01474);
      proximal.add(distal);
      const index = new Object3D();
      index.position.set(0.05437, 0.00616, 0.01642);
      hand.add(index);
      const middle = new Object3D();
      middle.position.set(0.02762, 0, -0.00054);
      index.add(middle);
      for (const node of [proximal, distal, index, middle]) {
        if (side === "right") node.position.x *= -1;
        if (version === "0") {
          node.position.x *= -1;
          node.position.z *= -1;
        }
      }
      const nodes: Record<string, Object3D> = {
        [`${side}ThumbProximal`]: proximal,
        [`${side}ThumbDistal`]: distal,
        [`${side}IndexProximal`]: index,
        [`${side}IndexIntermediate`]: middle,
      };
      const avatar = {
        vrm: {
          meta: { metaVersion: version },
          humanoid: {
            getNormalizedBoneNode: (name: string) => nodes[name] ?? null,
          },
        },
      } as unknown as Avatar;
      const bone = {
        side,
        boneName: `${side}ThumbProximal`,
        segment: HAND_SEGMENTS.find(
          (segment) => segment.id === "thumbProximal",
        )!,
      };
      const before = meta.quaternion.clone();
      const result = handPresetQuaternion(bone, preset, avatar);
      const runtime = convertPoseQuaternionBasis(avatar.vrm, result);
      const actual = proximal
        .parent!.localToWorld(
          distal.position
            .clone()
            .applyQuaternion(runtime)
            .add(proximal.position),
        )
        .sub(proximal.getWorldPosition(new Vector3()))
        .normalize();
      // The target uses the final index preset even before that preset is written.
      index.quaternion.copy(
        convertPoseQuaternionBasis(
          avatar.vrm,
          preset === "fist"
            ? adjustHandQuaternion(new Quaternion(), side, "index", "curl", 80)
            : new Quaternion(),
        ),
      );
      const target = middle.getWorldPosition(new Vector3());
      if (preset === "fist") {
        const offset = hand
          .localToWorld(new Vector3(0, -middle.position.length() * 0.3, 0))
          .sub(hand.getWorldPosition(new Vector3()));
        target.add(offset);
      }
      target.sub(proximal.getWorldPosition(new Vector3())).normalize();
      expect(actual.distanceTo(target)).toBeLessThan(1e-7);
      expect(meta.quaternion.toArray()).toEqual(before.toArray());
      proximal.quaternion.copy(runtime);
      expect(
        handPresetQuaternion(bone, preset, avatar).angleTo(result),
      ).toBeCloseTo(0);
    },
  );
});
