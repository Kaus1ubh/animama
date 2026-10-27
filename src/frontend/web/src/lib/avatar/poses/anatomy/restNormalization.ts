import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import { Matrix4, Quaternion, Vector3 } from "three";

import { isVrm0 } from "../poseRetargeting";

/**
 * Arm and hand rest normalization (R6, owner decision 4; R9).
 *
 * Hand shapes, catalog poses, Gesture hand tracks, talking hands, VRMA
 * playback and Pose creator authoring all write finger rotations for VRoid's
 * hand: in three-vrm's normalized rig every bone rests unrotated, with VRoid's
 * fingers lying straight along the arm, palms down, and its thumbs angled
 * forward. A model whose hand rests otherwise (fingers bent down, the hand
 * rolled, thumbs further forward) bends them in the wrong planes: a
 * thumbs-up points sideways.
 *
 * At load this measures each hand and finger bone's rest frame (its bone
 * direction and the palm's normal) against VRoid's and, beyond
 * {@link HAND_REST_TOLERANCE}, normalizes the hand: each such bone's rotation
 * N is transferred to the model as `W_parent⁻¹ · N · W_bone`, where `W` turns
 * the model's rest frame into VRoid's, by wrapping the instance's
 * `humanoid.update` (every `vrm.update` goes through it). So that code reading
 * the normalized rig's geometry (thumb and pinch fits, fingertip contacts,
 * Pose creator markers) sees the hand as drawn, the normalized child offsets are
 * turned by their parent's `W` too: the normalized hand is then VRoid's shape
 * with the model's lengths. The Included Avatars are within the tolerance and
 * take exactly the path they took before.
 *
 * Arms work the same way (R9): poses are authored on VRoid's T-pose, arms
 * straight out to the sides. A model resting in an A-pose (arms angled down)
 * beyond {@link ARM_REST_TOLERANCE} has its upper and lower arms normalized
 * too, so Gestures move its arms as on a T-pose model; a corrected forearm
 * carries its hand. Hands are measured against VRoid's as carried by their
 * own forearm, so an arm's tilt never counts against its hand.
 */

/** Hand corrections smaller than this (radians) are left out: about 5°. */
export const HAND_REST_TOLERANCE = (5 * Math.PI) / 180;

/**
 * Arms closer than this to a T-pose (radians, about 10°) count as one; a
 * slightly lowered or raised arm needs no correction.
 */
export const ARM_REST_TOLERANCE = (10 * Math.PI) / 180;

type Digit = "Thumb" | "Index" | "Middle" | "Ring" | "Little";
type Side = "left" | "right";

/** Each digit's segments, base first. */
const DIGIT_SEGMENTS: Readonly<Record<Digit, readonly string[]>> = {
  Thumb: ["Metacarpal", "Proximal", "Distal"],
  Index: ["Proximal", "Intermediate", "Distal"],
  Middle: ["Proximal", "Intermediate", "Distal"],
  Ring: ["Proximal", "Intermediate", "Distal"],
  Little: ["Proximal", "Intermediate", "Distal"],
};

type Vec = readonly [number, number, number];

/**
 * VRoid's left hand at rest, in VRM 1.0 normalized axes (+X the model's left,
 * +Y up, +Z forward), measured on Annie (Andrew agrees within 0.2°): the
 * hand's direction (wrist to middle-finger base), the back-of-hand normal,
 * and each segment's direction (the last segment continues the one before).
 * The right hand mirrors it in X.
 */
const VROID_LEFT_HAND: {
  along: Vec;
  back: Vec;
  segments: Readonly<Record<Digit, readonly Vec[]>>;
} = {
  along: [0.993, 0.111, 0.031],
  back: [-0.111, 0.994, 0.01],
  segments: {
    Thumb: [
      [0.757, -0.044, 0.652],
      [0.785, -0.034, 0.618],
    ],
    Index: [
      [1, 0, -0.02],
      [0.999, -0.029, -0.039],
    ],
    Middle: [
      [1, 0, 0],
      [1, 0, 0],
    ],
    Ring: [
      [1, 0, 0],
      [1, 0, 0],
    ],
    Little: [
      [1, 0, 0],
      [1, 0, 0],
    ],
  },
};

/** What `installRestNormalization` found and applies. */
export type RestNormalization = {
  /**
   * Per corrected bone, the rotation turning its rest frame into VRoid's, and
   * its nearest corrected ancestor (null for an upper arm, or a hand whose arm
   * is not corrected).
   */
  readonly bones: ReadonlyMap<
    VRMHumanBoneName,
    { rotation: Quaternion; parent: VRMHumanBoneName | null }
  >;
  /** The largest correction, in degrees. */
  readonly maxDegrees: number;
};

/** How far the model's rest is from VRoid's T-pose, and what was normalized. */
export type RestPoseCheck = {
  /** The largest upper or lower arm angle from a T-pose, in degrees. */
  readonly armDegrees: number;
  /**
   * The largest hand or finger frame difference from VRoid's, measured on
   * each hand's own forearm, in degrees (0 for a hand without a palm to
   * measure).
   */
  readonly handDegrees: number;
  /** Whether the arms were corrected (their hands then ride along). */
  readonly armsNormalized: boolean;
  /** Whether the hands themselves were corrected, beyond riding an arm. */
  readonly handsNormalized: boolean;
  /** Null when nothing needed normalizing. */
  readonly normalization: RestNormalization | null;
};

const installed = new WeakMap<VRM, RestPoseCheck>();

/**
 * A rotation turning frame (dir, up) into frame (refDir, refUp); identity when
 * a direction runs along its up vector, which leaves no frame to compare.
 */
function frameRotation(
  dir: Vector3,
  up: Vector3,
  refDir: Vector3,
  refUp: Vector3,
): Quaternion {
  const basis = (x: Vector3, hint: Vector3) => {
    const z = x.clone().cross(hint);
    if (z.lengthSq() < 1e-12) return null;
    z.normalize();
    const y = z.clone().cross(x).normalize();
    return new Matrix4().makeBasis(x.clone().normalize(), y, z);
  };
  const model = basis(dir, up);
  const reference = basis(refDir, refUp);
  if (!model || !reference) return new Quaternion();
  return new Quaternion().setFromRotationMatrix(
    reference.multiply(model.transpose()),
  );
}

/**
 * Measure the arms and hands and, where they differ from VRoid's beyond the
 * tolerances, install the normalization (once per model). Returns the check,
 * with what was installed.
 */
export function installRestNormalization(vrm: VRM): RestPoseCheck {
  const known = installed.get(vrm);
  if (known) return known;
  const check = measureRest(vrm);
  installed.set(vrm, check);
  if (check.normalization) {
    applyRestOffsets(vrm, check.normalization);
    wrapHumanoidUpdate(vrm, check.normalization);
  }
  return check;
}

/** The largest rotation angle among `rotations`, in radians. */
function largestAngle(rotations: Iterable<Quaternion>): number {
  let max = 0;
  for (const rotation of rotations)
    max = Math.max(max, 2 * Math.acos(Math.min(1, Math.abs(rotation.w))));
  return max;
}

function measureRest(vrm: VRM): RestPoseCheck {
  const humanoid = vrm.humanoid;
  const node = (bone: string) =>
    humanoid?.getNormalizedBoneNode(bone as VRMHumanBoneName) ?? null;
  const vrm0 = isVrm0(vrm);
  // VRoid's reference, in this model's normalized axes and side.
  const reference = (v: Vec, side: Side) =>
    new Vector3(
      (side === "right" ? -v[0] : v[0]) * (vrm0 ? -1 : 1),
      v[1],
      v[2] * (vrm0 ? -1 : 1),
    ).normalize();
  const bones = new Map<
    VRMHumanBoneName,
    { rotation: Quaternion; parent: VRMHumanBoneName | null }
  >();
  const arms = new Map<
    VRMHumanBoneName,
    { rotation: Quaternion; parent: VRMHumanBoneName | null }
  >();
  const directions = new Map<VRMHumanBoneName, Vector3>();
  // Per hand: its forearm's correction, each bone's corrected parent, and
  // each bone's rotation against VRoid's carried by its forearm (null when
  // the palm cannot be measured).
  const sides: {
    forearm: Quaternion | undefined;
    parents: Map<VRMHumanBoneName, VRMHumanBoneName | null>;
    relative: Map<VRMHumanBoneName, Quaternion> | null;
  }[] = [];
  for (const side of ["left", "right"] as const) {
    // Arms: each segment's direction against a T-pose's, straight out.
    const upperArm = `${side}UpperArm` as VRMHumanBoneName;
    const lowerArm = `${side}LowerArm` as VRMHumanBoneName;
    const lower = node(lowerArm);
    const wrist = node(`${side}Hand`);
    if (node(upperArm) && lower && wrist) {
      const out = reference([1, 0, 0], side);
      arms.set(upperArm, {
        rotation: new Quaternion().setFromUnitVectors(
          lower.position.clone().normalize(),
          out,
        ),
        parent: null,
      });
      arms.set(lowerArm, {
        rotation: new Quaternion().setFromUnitVectors(
          wrist.position.clone().normalize(),
          out,
        ),
        parent: upperArm,
      });
    }
  }
  const armAngle = largestAngle(
    [...arms.values()].map(({ rotation }) => rotation),
  );
  const armsNormalized = armAngle >= ARM_REST_TOLERANCE;
  for (const side of ["left", "right"] as const) {
    const hand = `${side}Hand` as VRMHumanBoneName;
    if (!node(hand)) continue;
    const lowerArm = `${side}LowerArm` as VRMHumanBoneName;
    const forearm = arms.get(lowerArm)?.rotation;
    // Hands are measured against VRoid's carried by this forearm's own rest
    // direction, so a forearm within the arm tolerance does not count
    // against its hand.
    const toForearm = forearm ? forearm.clone().invert() : new Quaternion();
    const handReference = (v: Vec) =>
      reference(v, side).applyQuaternion(toForearm);
    // The hand's bones the model has, each with the bone three-vrm parents it
    // to: the nearest present one before it in its digit, else the hand.
    const chain: {
      bone: VRMHumanBoneName;
      parent: VRMHumanBoneName;
      ordinal: number;
      digit: Digit;
    }[] = [];
    for (const [digit, segments] of Object.entries(DIGIT_SEGMENTS) as [
      Digit,
      readonly string[],
    ][]) {
      let parent: VRMHumanBoneName = hand;
      segments.forEach((segment, ordinal) => {
        const bone = `${side}${digit}${segment}` as VRMHumanBoneName;
        if (!node(bone)) return;
        chain.push({ bone, parent, ordinal, digit });
        parent = bone;
      });
    }
    const index = node(`${side}IndexProximal`);
    const middle = node(`${side}MiddleProximal`);
    const little = node(`${side}LittleProximal`);
    const parents = new Map<VRMHumanBoneName, VRMHumanBoneName | null>([
      [hand, armsNormalized && forearm ? lowerArm : null],
      ...chain.map(({ bone, parent }) => [bone, parent] as const),
    ]);
    if (!index || !middle || !little) {
      // No palm to measure: under a corrected forearm the hand and its
      // fingers follow it rigidly, so they stay on the drawn arm.
      sides.push({ forearm, parents, relative: null });
      continue;
    }
    // Normalized bones rest unrotated: each child's position is its offset.
    const along = middle.position.clone().normalize();
    const across = index.position.clone().sub(little.position);
    const back = (
      side === "left"
        ? across.clone().cross(along)
        : along.clone().cross(across)
    ).normalize();
    const refBack = handReference(VROID_LEFT_HAND.back);
    const relative = new Map<VRMHumanBoneName, Quaternion>([
      [
        hand,
        frameRotation(
          along,
          back,
          handReference(VROID_LEFT_HAND.along),
          refBack,
        ),
      ],
    ]);
    chain.forEach(({ bone, parent, ordinal, digit }, i) => {
      const next = chain[i + 1];
      const child = next?.parent === bone ? node(next.bone) : null;
      // The last bone continues the one before it in its digit.
      const before = parent === hand ? null : parent;
      const direction =
        child && child.position.lengthSq() > 1e-12
          ? child.position.clone().normalize()
          : before
            ? (directions.get(before) ?? null)
            : null;
      if (direction) directions.set(bone, direction);
      const refSegments = VROID_LEFT_HAND.segments[digit];
      relative.set(
        bone,
        direction
          ? frameRotation(
              direction,
              back,
              handReference(
                refSegments[Math.min(ordinal, refSegments.length - 1)]!,
              ),
              refBack,
            )
          : // Nothing to measure (a lone bone): it follows its parent rigidly.
            relative.get(parent)!.clone(),
      );
    });
    sides.push({ forearm, parents, relative });
  }
  // Relative to each forearm, so an A-posed arm does not count here.
  const handAngle = largestAngle(
    sides.flatMap(({ relative }) => (relative ? [...relative.values()] : [])),
  );
  const handsNormalized = handAngle >= HAND_REST_TOLERANCE;
  for (const { forearm, parents, relative } of sides) {
    // A corrected forearm carries its hand: the forearm's correction, then
    // the hand's own when the hands are corrected.
    const carried = armsNormalized && forearm ? forearm : null;
    for (const [bone, parent] of parents) {
      const own = handsNormalized ? relative?.get(bone) : undefined;
      if (!carried && !own) continue;
      const rotation = carried
        ? own
          ? new Quaternion().multiplyQuaternions(carried, own)
          : carried.clone()
        : own!;
      bones.set(bone, { rotation, parent });
    }
  }
  const degrees = (radians: number) => (radians * 180) / Math.PI;
  const corrected = new Map([...(armsNormalized ? arms : []), ...bones]);
  return {
    armDegrees: degrees(armAngle),
    handDegrees: degrees(handAngle),
    armsNormalized,
    handsNormalized,
    normalization:
      corrected.size > 0
        ? {
            bones: corrected,
            maxDegrees: degrees(
              largestAngle(
                [...corrected.values()].map(({ rotation }) => rotation),
              ),
            ),
          }
        : null,
  };
}

/**
 * Turn each corrected bone's normalized rest offset by its corrected parent's
 * rotation, in the nodes and in three-vrm's normalized rest pose (which
 * `resetNormalizedPose` and `setNormalizedPose` use), so the normalized hand
 * has VRoid's shape.
 */
function applyRestOffsets(vrm: VRM, normalization: RestNormalization): void {
  const humanoid = vrm.humanoid;
  const updates: [VRMHumanBoneName, Vector3][] = [];
  for (const [bone, { parent }] of normalization.bones) {
    const node = humanoid.getNormalizedBoneNode(bone);
    if (!parent || !node) continue;
    const rotation = normalization.bones.get(parent)!.rotation;
    updates.push([bone, node.position.clone().applyQuaternion(rotation)]);
  }
  const rest = humanoid.normalizedRestPose;
  for (const [bone, position] of updates) {
    humanoid.getNormalizedBoneNode(bone)!.position.copy(position);
    const entry = rest[bone];
    if (entry?.position) entry.position = position.toArray();
  }
}

/**
 * Transfer each corrected bone's normalized rotation N as
 * `W_parent⁻¹ · N · W_bone`: the instance's `humanoid.update` sets those for
 * the transfer and restores the authored values after, so callers keep
 * reading what they wrote.
 */
function wrapHumanoidUpdate(vrm: VRM, normalization: RestNormalization): void {
  const humanoid = vrm.humanoid;
  const entries: {
    node: { quaternion: Quaternion };
    parentInverse: Quaternion;
    rotation: Quaternion;
    saved: Quaternion;
  }[] = [];
  for (const [bone, { rotation, parent }] of normalization.bones) {
    const node = humanoid.getNormalizedBoneNode(bone);
    if (!node) continue;
    entries.push({
      node,
      parentInverse: parent
        ? normalization.bones.get(parent)!.rotation.clone().invert()
        : new Quaternion(),
      rotation,
      saved: new Quaternion(),
    });
  }
  const update = humanoid.update.bind(humanoid);
  humanoid.update = () => {
    for (const entry of entries) {
      entry.saved.copy(entry.node.quaternion);
      entry.node.quaternion
        .premultiply(entry.parentInverse)
        .multiply(entry.rotation);
    }
    try {
      update();
    } finally {
      for (const entry of entries) entry.node.quaternion.copy(entry.saved);
    }
  };
}
