import { createHash } from "node:crypto";
import type { VRM, VRMHumanBoneName, VRMPose } from "@pixiv/three-vrm";
import { beforeAll, describe, expect, it } from "vitest";
import { Object3D, Quaternion, Vector3 } from "three";
import type { Avatar } from "@/lib/avatar";
import {
  applyCanonicalPose,
  rawBoneWorldPosition,
} from "@/lib/avatar/motion-authoring/kinematics";
import {
  VRM0_FIXTURE_ID,
  loadTestAvatar,
} from "@/lib/avatar/motion-authoring/testing/includedAvatars";
import {
  AVATAR_POSE_CATALOG,
  RELAXED_REST_POSE_ID,
  getResolvedAvatarPose,
} from "@/lib/avatar/poses/catalog";
import { convertPoseQuaternionBasis } from "@/lib/avatar/poses/poseRetargeting";
import {
  JOINT_DEFINITIONS,
  angularDistanceDegrees,
  composeJointRotation,
  decomposeJointRotation,
  resolveJoint,
  type JointComponentDefinition,
} from "./anatomy";
import {
  HAND_PRESETS,
  HAND_SEGMENTS,
  handPresetQuaternion,
  handShapeRotations,
  adjustHandQuaternion,
  type HandShape,
  type HandSide,
} from "./handPresets";
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
      if (preset === "fist" && angle === 0)
        // With an unrotated metacarpal, crossing the fist would need a thumb
        // curl of about 97°; the fit stops at the joint's anatomical limit.
        expect(
          decomposeJointRotation(resolveJoint(bone.boneName)!, result).curl,
        ).toBeCloseTo(JOINT_DEFINITIONS.thumb.components.curl.hard[1], 6);
      else expect(actual.distanceTo(target)).toBeLessThan(1e-7);
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
          else if (preset === "thumbs-up" && segment.segment === "distal")
            // The thumbs-up tip bends back, as real ones do.
            expect(
              angularDistanceDegrees(
                actual,
                adjustHandQuaternion(
                  new Quaternion(),
                  side,
                  "thumb",
                  "curl",
                  -25,
                ),
              ),
            ).toBeLessThan(1e-6);
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
      // It swings toward the index side only as far as the joint's natural
      // range allows (the distal segment then bends back the rest of the way).
      expect(
        decomposeJointRotation(resolveJoint(bone.boneName)!, result).curl,
      ).toBeCloseTo(JOINT_DEFINITIONS.thumb.components.curl.soft[0], 6);
      expect(direction.dot(outward)).toBeGreaterThan(0.85);
      proximal.quaternion.copy(result);
      expect(
        handPresetQuaternion(bone, "thumbs-up", avatar).angleTo(result),
      ).toBeCloseTo(0);
      expect(meta.quaternion.toArray()).toEqual(before.toArray());
    },
  );
});

const base = getResolvedAvatarPose(RELAXED_REST_POSE_ID).humanoid ?? {};
const SIDES = ["left", "right"] as const;
/** The VRM 0 test fixture and both Included Avatars. */
const AVATAR_IDS = [VRM0_FIXTURE_ID, "Annie", "Andrew"] as const;
type AvatarLabel = "none" | (typeof AVATAR_IDS)[number];

/** Rotations of a hand shape with the base pose's thumb metacarpal. */
const shapeOf = (vrm: VRM | null, side: HandSide, shape: HandShape) =>
  handShapeRotations(
    vrm,
    side,
    shape,
    base[`${side}ThumbMetacarpal`]?.rotation,
  );

describe("hand shapes on the Included Avatars and the VRM 0 fixture", () => {
  const avatars = {} as Record<AvatarLabel, VRM | null>;
  beforeAll(async () => {
    avatars.none = null;
    for (const id of AVATAR_IDS) avatars[id] = await loadTestAvatar(id);
  });

  /**
   * Digests of both hands' rotations for each original preset, alone and with
   * Curl 12 and Spread −8, quantized to 1e-6 (w ≥ 0). Computed from the
   * implementation at `bfc0de4f`, before the offset presets were added: a
   * change here changes the hands of existing Gestures. Only `thumbs-up`
   * changed deliberately since then: its fitted thumb reached a curl of about
   * −70°, past the joint's −60° limit, so its thumb now stops at the natural
   * range (−50°) and its tip bends back 25°. No Included Gesture uses it.
   * Other fitted thumbs change only where they were past the anatomical limit,
   * which these Relaxed Rest metacarpals never are. Andrew's digests were
   * recorded from the current implementation when he became Included, and
   * re-recorded for his 2026-10-22 model, whose hands are smaller.
   */
  const ORIGINAL_PRESET_DIGESTS: Record<AvatarLabel, Record<string, string>> = {
    none: {
      fist: "882e3f1e56f37a88",
      "open-spread": "fb472dc83541b19b",
      "open-together": "3c61b8a4a0f30521",
      relaxed: "6407426a36961be2",
      point: "6db2fd76ed175618",
      peace: "8a4105c55ef65a11",
      "thumbs-up": "5df640c4b37f9db2",
    },
    AvatarSample_Y_0: {
      fist: "31338597d0f7499c",
      "open-spread": "e31722b0ab246a6a",
      "open-together": "cd19f47770ccce52",
      relaxed: "6407426a36961be2",
      point: "20df92a1f8bb414b",
      peace: "8aff13e1c7fe05a5",
      "thumbs-up": "11f1d7cd1914577c",
    },
    Annie: {
      fist: "8cc64460c8b066bb",
      "open-spread": "c96cd3f3c49c9296",
      "open-together": "bfbecb03c2e57f0e",
      relaxed: "6407426a36961be2",
      point: "29fd8cd5ba298dee",
      peace: "772b821ede66c545",
      "thumbs-up": "feb9dcb6aaebe6a2",
    },
    Andrew: {
      fist: "d43139ecd608f3e7",
      "open-spread": "06b350735db69962",
      "open-together": "0c793decc4b5eab1",
      relaxed: "6407426a36961be2",
      point: "4c80775bbac49380",
      peace: "9cd8dfb86ab5f64a",
      "thumbs-up": "06fdd8a453e5ea21",
    },
  };
  const ORIGINAL_PRESETS = Object.keys(ORIGINAL_PRESET_DIGESTS.none);
  const NEW_PRESETS = HAND_PRESETS.map(({ id }) => id).filter(
    (id) => !ORIGINAL_PRESETS.includes(id),
  );

  const presetDigest = (vrm: VRM | null, preset: HandShape["preset"]) => {
    const lines: string[] = [];
    for (const shape of [{ preset }, { preset, curl: 12, spread: -8 }])
      for (const side of SIDES)
        for (const [bone, q] of shapeOf(vrm, side, shape)) {
          const sign = q.w < 0 ? -1 : 1;
          const values = q
            .toArray()
            .map((value) => Math.round(sign * value * 1e6) + 0);
          lines.push(`${JSON.stringify(shape)} ${bone} ${values.join(",")}`);
        }
    return createHash("sha256")
      .update(lines.sort().join("\n"))
      .digest("hex")
      .slice(0, 16);
  };

  it.each(["none", ...AVATAR_IDS] as const)(
    "keeps the original presets' rotations (%s)",
    (label) => {
      expect(
        Object.fromEntries(
          ORIGINAL_PRESETS.map((preset) => [
            preset,
            presetDigest(avatars[label], preset as HandShape["preset"]),
          ]),
        ),
      ).toEqual(ORIGINAL_PRESET_DIGESTS[label]);
    },
  );

  /** Thumb metacarpals to fit around: unrotated and every Library Pose's. */
  const METACARPALS: Record<
    string,
    Record<HandSide, [number, number, number, number] | undefined>
  > = {
    identity: { left: [0, 0, 0, 1], right: [0, 0, 0, 1] },
    ...Object.fromEntries(
      Object.entries(AVATAR_POSE_CATALOG).map(([id, pose]) => [
        id,
        {
          left: pose.humanoid?.leftThumbMetacarpal?.rotation,
          right: pose.humanoid?.rightThumbMetacarpal?.rotation,
        },
      ]),
    ),
  };

  it.each(AVATAR_IDS)(
    "keeps every preset's finger and thumb joints within their hard limits on %s",
    (id) => {
      const outside: string[] = [];
      for (const side of SIDES)
        for (const [pose, metacarpal] of Object.entries(METACARPALS))
          for (const { id: preset } of HAND_PRESETS)
            for (const [bone, rotation] of handShapeRotations(
              avatars[id],
              side,
              { preset },
              metacarpal[side],
            )) {
              const joint = resolveJoint(bone)!;
              const values = decomposeJointRotation(joint, rotation);
              const components: Record<string, JointComponentDefinition> =
                JOINT_DEFINITIONS[joint.type].components;
              for (const [name, { hard }] of Object.entries(components))
                if (
                  values[name] < hard[0] - 1e-6 ||
                  values[name] > hard[1] + 1e-6
                )
                  outside.push(
                    `${pose} ${preset} ${bone}.${name} ${values[name].toFixed(1)} (${hard.join("..")})`,
                  );
            }
      expect(outside).toEqual([]);
    },
  );

  /** A thumb proximal rotation of `preset` fitted around a Pose's metacarpal. */
  const fittedThumb = (
    id: (typeof AVATAR_IDS)[number],
    side: HandSide,
    pose: string,
    preset: HandShape["preset"],
  ) =>
    handShapeRotations(
      avatars[id],
      side,
      { preset },
      METACARPALS[pose][side],
    ).get(`${side}ThumbProximal`)!;

  it("keeps thumb fits the joint can reach exactly as at bfc0de4f", () => {
    // Both are outside the natural range but within the anatomical limit
    // (curl 78.9° and −53.7°), so they must not be clamped.
    const cases = [
      {
        pose: "single-hand-on-heart",
        side: "right",
        preset: "fist",
        expected: [-0.0417048945, -0.635280029, -0.0882344939, 0.7660905042],
      },
      {
        pose: "left-ok-sign",
        side: "left",
        preset: "open-together",
        expected: [-0.2024676902, -0.4078119551, 0.2364227026, 0.8583708694],
      },
    ] as const;
    for (const { pose, side, preset, expected } of cases)
      expect(
        angularDistanceDegrees(
          fittedThumb(VRM0_FIXTURE_ID, side, pose, preset),
          new Quaternion(...expected),
        ),
      ).toBeLessThan(1e-5);
  });

  it("stops a thumb fit the joint cannot reach at its anatomical limit", () => {
    // At bfc0de4f, a fist around an unrotated metacarpal needed curl 96.4°.
    const joint = resolveJoint("leftThumbProximal")!;
    const before = decomposeJointRotation(
      joint,
      new Quaternion(0.1509016834, 0.7262834686, -0.1529950152, 0.6529422107),
    );
    expect(before.curl).toBeGreaterThan(96);
    expect(
      angularDistanceDegrees(
        fittedThumb(VRM0_FIXTURE_ID, "left", "identity", "fist"),
        composeJointRotation(joint, {
          ...before,
          curl: JOINT_DEFINITIONS.thumb.components.curl.hard[1],
        }),
      ),
    ).toBeLessThan(1e-5);
  });

  it("adds five presets that each differ from Relaxed", () => {
    expect(NEW_PRESETS).toEqual([
      "cupped",
      "soft-claw",
      "palm-flat",
      "pinch",
      "ok",
    ]);
    for (const label of ["none", ...AVATAR_IDS] as const)
      for (const side of SIDES) {
        const relaxed = shapeOf(avatars[label], side, { preset: "relaxed" });
        for (const preset of NEW_PRESETS) {
          const shape = shapeOf(avatars[label], side, { preset });
          expect([...shape.keys()]).toEqual([...relaxed.keys()]);
          const largest = Math.max(
            ...[...shape].map(([bone, q]) =>
              angularDistanceDegrees(q, relaxed.get(bone)!),
            ),
          );
          expect(largest, `${label} ${side} ${preset}`).toBeGreaterThan(10);
        }
      }
  });

  it.each(
    AVATAR_IDS.flatMap((id) =>
      (["pinch", "ok"] as const).flatMap((preset) =>
        SIDES.map((side) => ({ id, preset, side })),
      ),
    ),
  )(
    "fits $preset so the $side thumb and index tips meet on $id",
    async ({ id, preset, side }) => {
      // A fresh copy: posing must not disturb the other tests' Avatars.
      const vrm = await loadTestAvatar(id);
      const pose: VRMPose = { ...base };
      for (const [bone, q] of shapeOf(vrm, side, { preset }))
        pose[bone] = {
          rotation: q.toArray() as [number, number, number, number],
        };
      applyCanonicalPose(vrm, pose);
      // Rigs end at the distal joint: extend the last segment by 0.8 of the one before.
      const tip = (digit: "Thumb" | "Index", previous: string) => {
        const at = (segment: string) =>
          rawBoneWorldPosition(
            vrm,
            `${side}${digit}${segment}` as VRMHumanBoneName,
          )!;
        const distal = at("Distal");
        return distal
          .clone()
          .addScaledVector(distal.clone().sub(at(previous)), 0.8);
      };
      const gap = tip("Thumb", "Proximal").distanceTo(
        tip("Index", "Intermediate"),
      );
      expect(gap).toBeLessThan(0.01);
    },
  );

  it("falls back to the listed pinch without thumb bones or an Avatar", () => {
    const vrm = avatars.Annie!;
    const withoutThumbs = {
      meta: vrm.meta,
      humanoid: {
        getNormalizedBoneNode: (name: VRMHumanBoneName) =>
          name.includes("Thumb")
            ? null
            : vrm.humanoid.getNormalizedBoneNode(name),
      },
    } as unknown as VRM;
    const listed = [40, 46, 28];
    for (const rig of [withoutThumbs, null]) {
      const shape = shapeOf(rig, "right", { preset: "pinch" });
      (["Proximal", "Intermediate", "Distal"] as const).forEach(
        (segment, index) =>
          expect(
            angularDistanceDegrees(
              shape.get(`rightIndex${segment}`)!,
              composeJointRotation(resolveJoint(`rightIndex${segment}`)!, {
                curl: listed[index],
              }),
            ),
          ).toBeLessThan(1e-6),
      );
      expect(shape.has("rightThumbProximal")).toBe(rig === null);
    }
    // Without an Avatar the thumb starts from the unfitted Open · together.
    expect(
      angularDistanceDegrees(
        shapeOf(null, "right", { preset: "pinch" }).get("rightThumbProximal")!,
        adjustHandQuaternion(new Quaternion(), "right", "thumb", "curl", 38),
      ),
    ).toBeLessThan(1e-6);
  });

  const OFFSETS: HandShape["fingers"] = {
    thumb: { curl: [8, -4], palmarAbduction: 5, twist: -3 },
    index: { curl: [10, -5, 3], splay: 6 },
    little: { curl: 7 },
  };
  /** Expected component changes per bone for `OFFSETS`. */
  const expectedOffset = (bone: string): Record<string, number> | null => {
    if (bone.endsWith("ThumbProximal"))
      return { curl: 8, palmarAbduction: 5, twist: -3 };
    if (bone.endsWith("ThumbDistal"))
      return { curl: -4, palmarAbduction: 0, twist: 0 };
    const index = { Proximal: 0, Intermediate: 1, Distal: 2 }[
      bone.replace(/^(left|right)(Index|Little)/, "")
    ];
    if (bone.includes("Index") && index !== undefined)
      return {
        curl: [10, -5, 3][index],
        splay: index === 0 ? 6 : 0,
        twist: 0,
      };
    if (bone.includes("Little")) return { curl: 7, splay: 0, twist: 0 };
    return null;
  };

  it.each(
    (["none", ...AVATAR_IDS] as const).flatMap((label) =>
      (["relaxed", "fist", "cupped", "pinch"] as const).map((preset) => ({
        label,
        preset,
      })),
    ),
  )(
    "adds finger offsets to $preset after Curl and Spread ($label)",
    ({ label, preset }) => {
      for (const side of SIDES) {
        const shape: HandShape = { preset, curl: 5, spread: 4 };
        const before = shapeOf(avatars[label], side, shape);
        const after = shapeOf(avatars[label], side, {
          ...shape,
          fingers: OFFSETS,
        });
        expect([...after.keys()]).toEqual([...before.keys()]);
        for (const [bone, rotation] of after) {
          const expected = expectedOffset(bone);
          if (!expected) {
            expect(rotation.toArray()).toEqual(before.get(bone)!.toArray());
            continue;
          }
          const joint = resolveJoint(bone)!;
          const from = decomposeJointRotation(joint, before.get(bone)!);
          const to = decomposeJointRotation(joint, rotation, from);
          for (const [component, change] of Object.entries(expected))
            expect(
              to[component] - from[component],
              `${bone}.${component}`,
            ).toBeCloseTo(change, 9);
        }
      }
    },
  );

  it.each(["none", ...AVATAR_IDS] as const)(
    "treats zero offsets as no change (%s)",
    (label) => {
      for (const side of SIDES) {
        const shape: HandShape = { preset: "ok", curl: -6 };
        const before = shapeOf(avatars[label], side, shape);
        const after = shapeOf(avatars[label], side, {
          ...shape,
          fingers: {
            thumb: { curl: [0, 0], palmarAbduction: 0, twist: 0 },
            index: { curl: 0, splay: 0 },
            middle: {},
          },
        });
        for (const [bone, rotation] of after)
          expect(rotation.toArray()).toEqual(before.get(bone)!.toArray());
      }
    },
  );
});
