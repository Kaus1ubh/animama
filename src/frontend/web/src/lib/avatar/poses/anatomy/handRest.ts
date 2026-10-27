import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import { Matrix4, Quaternion, Vector3 } from "three";

import { isVrm0 } from "../poseRetargeting";

/**
 * Hand rest normalization (R6, owner decision 4).
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
 */

/** Corrections smaller than this (radians) are left out: about 5°. */
export const HAND_REST_TOLERANCE = (5 * Math.PI) / 180;

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

/** What `installHandRestNormalization` found and applies. */
export type HandRestNormalization = {
  /**
   * Per corrected bone, the rotation turning its rest frame into VRoid's, and
   * its nearest corrected ancestor (null for a hand).
   */
  readonly bones: ReadonlyMap<
    VRMHumanBoneName,
    { rotation: Quaternion; parent: VRMHumanBoneName | null }
  >;
  /** The largest correction, in degrees. */
  readonly maxDegrees: number;
};

const installed = new WeakMap<VRM, HandRestNormalization | null>();

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
 * Measure the hands and, when they differ from VRoid's beyond the tolerance,
 * install the normalization (once per model). Returns what is installed, or
 * null when nothing needed it.
 */
export function installHandRestNormalization(
  vrm: VRM,
): HandRestNormalization | null {
  if (installed.has(vrm)) return installed.get(vrm) ?? null;
  const normalization = measureHandRest(vrm);
  installed.set(vrm, normalization);
  if (!normalization) return null;
  applyRestOffsets(vrm, normalization);
  wrapHumanoidUpdate(vrm, normalization);
  return normalization;
}

function measureHandRest(vrm: VRM): HandRestNormalization | null {
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
  for (const side of ["left", "right"] as const) {
    const hand = `${side}Hand` as VRMHumanBoneName;
    const index = node(`${side}IndexProximal`);
    const middle = node(`${side}MiddleProximal`);
    const little = node(`${side}LittleProximal`);
    if (!node(hand) || !index || !middle || !little) continue;
    // Normalized bones rest unrotated: each child's position is its offset.
    const along = middle.position.clone().normalize();
    const across = index.position.clone().sub(little.position);
    const back = (
      side === "left"
        ? across.clone().cross(along)
        : along.clone().cross(across)
    ).normalize();
    const refBack = reference(VROID_LEFT_HAND.back, side);
    const handRotation = frameRotation(
      along,
      back,
      reference(VROID_LEFT_HAND.along, side),
      refBack,
    );
    bones.set(hand, { rotation: handRotation, parent: null });
    for (const [digit, segments] of Object.entries(DIGIT_SEGMENTS) as [
      Digit,
      readonly string[],
    ][]) {
      // The digit's bones the model has; three-vrm parents each to the
      // nearest one before it, so its offset is measured from that one.
      const present = segments
        .map((segment, ordinal) => ({
          bone: `${side}${digit}${segment}` as VRMHumanBoneName,
          ordinal,
        }))
        .filter(({ bone }) => node(bone));
      const refSegments = VROID_LEFT_HAND.segments[digit];
      let parent: VRMHumanBoneName = hand;
      let direction: Vector3 | null = null;
      present.forEach(({ bone, ordinal }, i) => {
        const child = present[i + 1] ? node(present[i + 1]!.bone) : null;
        // The last bone continues the one before it.
        if (child && child.position.lengthSq() > 1e-12)
          direction = child.position.clone().normalize();
        const rotation = direction
          ? frameRotation(
              direction,
              back,
              reference(
                refSegments[Math.min(ordinal, refSegments.length - 1)]!,
                side,
              ),
              refBack,
            )
          : // Nothing to measure (a lone bone): it follows its parent rigidly.
            bones.get(parent)!.rotation.clone();
        bones.set(bone, { rotation, parent });
        parent = bone;
      });
    }
  }
  let max = 0;
  for (const { rotation } of bones.values())
    max = Math.max(max, 2 * Math.acos(Math.min(1, Math.abs(rotation.w))));
  if (max < HAND_REST_TOLERANCE) return null;
  return { bones, maxDegrees: (max * 180) / Math.PI };
}

/**
 * Turn each corrected bone's normalized rest offset by its corrected parent's
 * rotation, in the nodes and in three-vrm's normalized rest pose (which
 * `resetNormalizedPose` and `setNormalizedPose` use), so the normalized hand
 * has VRoid's shape.
 */
function applyRestOffsets(
  vrm: VRM,
  normalization: HandRestNormalization,
): void {
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
function wrapHumanoidUpdate(
  vrm: VRM,
  normalization: HandRestNormalization,
): void {
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
