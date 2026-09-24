import { describe, expect, it } from "vitest";
import { Object3D, Quaternion, Vector3 } from "three";
import type { Avatar } from "@/lib/avatar";
import {
  AVATAR_POSE_CATALOG,
  RELAXED_REST_POSE_ID,
} from "@/lib/avatar/poses/catalog";
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
      meta.position.set(0.00293, -0.00836, 0.01333);
      if (angle)
        meta.quaternion.multiply(
          new Quaternion().setFromAxisAngle(
            new Vector3(0, 0, 1),
            side === "left" ? -0.164 : 0.164,
          ),
        );
      const proximal = new Object3D();
      proximal.position.set(0.02937, -0.00172, 0.02528);
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
      const ring = new Object3D();
      ring.position.set(0.05449, 0.00616, -0.01135);
      hand.add(ring);
      const ringTip = new Object3D();
      ringTip.position.set(0.02854, 0, 0);
      ring.add(ringTip);
      const little = new Object3D();
      little.position.set(0.05073, 0.00616, -0.02437);
      hand.add(little);
      for (const node of [
        meta,
        proximal,
        distal,
        index,
        middle,
        ring,
        ringTip,
        little,
      ]) {
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
        [`${side}RingProximal`]: ring,
        [`${side}RingIntermediate`]: ringTip,
        [`${side}LittleProximal`]: little,
      };
      const avatar = {
        vrm: {
          meta: { metaVersion: version },
          humanoid: {
            getNormalizedBoneNode: (name: string) => nodes[name] ?? null,
          },
        },
      } as unknown as Avatar;
      meta.quaternion.copy(
        convertPoseQuaternionBasis(avatar.vrm, meta.quaternion),
      );
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
      ring.quaternion.copy(index.quaternion);
      const target = (preset === "fist" ? ringTip : middle).getWorldPosition(
        new Vector3(),
      );
      const localOffset =
        preset === "fist"
          ? new Vector3(0, -middle.position.length() * 0.15, 0)
          : index.position
              .clone()
              .sub(little.position)
              .normalize()
              .multiplyScalar(middle.position.length() * 0.6);
      target.add(
        hand
          .localToWorld(localOffset)
          .sub(hand.getWorldPosition(new Vector3())),
      );
      target.sub(proximal.getWorldPosition(new Vector3())).normalize();
      expect(actual.distanceTo(target)).toBeLessThan(1e-7);
      const directionInHand = actual
        .clone()
        .applyQuaternion(hand.getWorldQuaternion(new Quaternion()).invert());
      const outward = index.position.clone().sub(little.position).normalize();
      if (preset === "fist") {
        // The thumb crosses toward the other fingers instead of dangling along the index.
        expect(directionInHand.dot(outward)).toBeLessThan(-0.25);
        const tipRotation = handPresetQuaternion(
          {
            ...bone,
            segment: HAND_SEGMENTS.find(
              (segment) => segment.id === "thumbDistal",
            )!,
          },
          preset,
          avatar,
        );
        expect(tipRotation.angleTo(new Quaternion())).toBeLessThan(
          (20 * Math.PI) / 180,
        );
        expect(tipRotation.angleTo(new Quaternion())).toBeGreaterThan(
          (10 * Math.PI) / 180,
        );
      } else {
        const baseInHand = hand.worldToLocal(
          proximal.getWorldPosition(new Vector3()),
        );
        const indexJoint = middle.position.clone().add(index.position);
        const distance = (indexJoint.x - baseInHand.x) / directionInHand.x;
        const thumbAtIndex = baseInHand.addScaledVector(
          directionInHand,
          distance,
        );
        // A visible margin remains on the thumb side of the open index.
        expect(thumbAtIndex.sub(indexJoint).dot(outward)).toBeGreaterThan(
          middle.position.length() * 0.5,
        );
      }
      expect(meta.quaternion.toArray()).toEqual(before.toArray());
      proximal.quaternion.copy(runtime);
      expect(
        handPresetQuaternion(bone, preset, avatar).angleTo(result),
      ).toBeCloseTo(0);
    },
  );
});

describe("additional hand presets", () => {
  it.each(["left", "right"] as const)(
    "copies exact Relaxed Rest finger rotations on %s",
    (side) => {
      for (const segment of HAND_SEGMENTS) {
        const boneName = `${side}${segment.id[0].toUpperCase()}${segment.id.slice(1)}`;
        const expected = Object.entries(
          AVATAR_POSE_CATALOG[RELAXED_REST_POSE_ID].humanoid!,
        ).find(([name]) => name === boneName)![1].rotation;
        expect(
          handPresetQuaternion(
            { side, boneName, segment },
            "relaxed",
          ).toArray(),
        ).toEqual(expected);
      }
    },
  );
  it.each(["left", "right"] as const)(
    "extends the requested digits and folds the remaining %s fingers",
    (side) => {
      for (const segment of HAND_SEGMENTS) {
        const bone = {
          side,
          boneName: `${side}${segment.id[0].toUpperCase()}${segment.id.slice(1)}`,
          segment,
        };
        for (const preset of ["point", "peace", "thumbs-up"] as const) {
          const actual = handPresetQuaternion(bone, preset);
          const extended =
            preset === "thumbs-up"
              ? segment.digit === "thumb"
              : segment.digit === "index" ||
                (preset === "peace" && segment.digit === "middle");
          if (!extended)
            expect(actual.toArray()).toEqual(
              handPresetQuaternion(bone, "fist").toArray(),
            );
          else if (
            !(preset === "peace" && segment.segment === "proximal") &&
            !(preset === "thumbs-up" && segment.segment === "proximal")
          )
            expect(actual.angleTo(new Quaternion())).toBeCloseTo(0);
          if (
            preset === "peace" &&
            extended &&
            segment.segment === "proximal"
          ) {
            expect(actual.angleTo(new Quaternion())).toBeCloseTo(Math.PI / 12);
            expect(Math.sign(actual.y)).toBe(
              (side === "left" ? 1 : -1) * (segment.digit === "index" ? -1 : 1),
            );
          }
          expect(handPresetQuaternion(bone, preset).toArray()).toEqual(
            actual.toArray(),
          );
        }
      }
    },
  );
  it.each(["left", "right"] as const)(
    "extends the %s thumb away from the folded fingers without changing its metacarpal",
    (side) => {
      const sign = side === "left" ? 1 : -1;
      const hand = new Object3D();
      const meta = new Object3D();
      hand.add(meta);
      meta.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.56 * sign);
      const proximal = new Object3D();
      meta.add(proximal);
      const distal = new Object3D();
      distal.position.set(0.01873 * sign, -0.00081, 0.01474);
      proximal.add(distal);
      const index = new Object3D();
      index.position.set(0.05437 * sign, 0.00616, 0.01642);
      hand.add(index);
      const middle = new Object3D();
      middle.position.set(0.02762 * sign, 0, -0.00054);
      index.add(middle);
      const little = new Object3D();
      little.position.set(0.05073 * sign, 0.00616, -0.02437);
      hand.add(little);
      const nodes = Object.fromEntries(
        [
          ["ThumbProximal", proximal],
          ["ThumbDistal", distal],
          ["IndexProximal", index],
          ["IndexIntermediate", middle],
          ["LittleProximal", little],
        ].map(([name, node]) => [`${side}${name}`, node]),
      );
      const avatar = {
        vrm: {
          meta: { metaVersion: "1" },
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
      const result = handPresetQuaternion(bone, "thumbs-up", avatar);
      const direction = distal.position
        .clone()
        .applyQuaternion(result)
        .applyQuaternion(meta.quaternion)
        .normalize();
      const outward = index.position.clone().sub(little.position).normalize();
      expect(direction.dot(outward)).toBeGreaterThan(0.97);
      proximal.quaternion.copy(result);
      expect(
        handPresetQuaternion(bone, "thumbs-up", avatar).angleTo(result),
      ).toBeCloseTo(0);
      expect(meta.quaternion.toArray()).toEqual(before.toArray());
    },
  );
});
