import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import { MathUtils, Quaternion, Vector3 } from "three";

import { isVRMHumanBoneName } from "../animaPose";
import { AVATAR_POSE_CATALOG, RELAXED_REST_POSE_ID } from "../catalog";
import { convertPoseQuaternionBasis, isVrm0 } from "../poseRetargeting";
import {
  JOINT_DEFINITIONS,
  composeJointRotation,
  decomposeJointRotation,
  resolveJoint,
  type ResolvedJoint,
} from "./anatomy";
import {
  HAND_ADJUSTMENT_LIMITS,
  HAND_DIGIT_OFFSETS,
  HAND_DIGITS,
  type HandDigit,
  type HandDigitOffset,
  type HandPreset,
} from "./handPresetIds";

/**
 * The Hands tool's presets, Curl and Spread, and hand keys' per-finger
 * offsets, shared by the Gesture creator, clip playback (which fits presets
 * to each Avatar) and the motion tools. Rotations are in the canonical pose
 * basis (the VRM 1 normalized T-pose).
 */

/** Hand authoring reads only the loaded VRM, so headless tools can pass one. */
export type HandAuthoringAvatar = { vrm: VRM | null };
export type HandTarget = "left" | "right" | "both";
export type HandSide = Exclude<HandTarget, "both">;
export type HandAdjustment = "curl" | "spread";
export {
  HAND_ADJUSTMENT_LIMITS,
  HAND_PRESETS,
  type HandDigit,
  type HandDigitOffset,
  type HandPreset,
} from "./handPresetIds";

/**
 * A hand-shape key: a preset, then relative Curl and Spread, then per-finger
 * offsets, applied in that order (`handShapeRotations`).
 */
export type HandShape = {
  preset: HandPreset;
  curl?: number;
  spread?: number;
  fingers?: Partial<Record<HandDigit, HandDigitOffset>>;
};

// ── Segments ─────────────────────────────────────────────────────────────

export type HandSegment = {
  id: string;
  digit: HandDigit;
  segment: "metacarpal" | "proximal" | "intermediate" | "distal";
  label: string;
  spread: boolean;
};
const capitalize = (value: string) => value[0].toUpperCase() + value.slice(1);

/** A digit's editable segments from the knuckle out (never the thumb metacarpal). */
const digitSegments = (digit: HandDigit): readonly HandSegment["segment"][] =>
  HAND_DIGIT_OFFSETS[digit].segments;

/** The Hands tool's segments, which are also the segments offsets reach. */
export const HAND_SEGMENTS: HandSegment[] = HAND_DIGITS.flatMap((digit) =>
  digitSegments(digit).map((segment, index) => ({
    id: `${digit}${capitalize(segment)}`,
    digit,
    segment,
    label: `${capitalize(digit)} ${segment}`,
    spread: index === 0,
  })),
);
export type HandBone = {
  boneName: string;
  side: HandSide;
  segment: HandSegment;
};

const handBone = (side: HandSide, segment: HandSegment): HandBone => ({
  boneName: `${side}${capitalize(segment.id)}`,
  side,
  segment,
});

/** A segment's place in its digit from the knuckle out (0 is proximal). */
export function handSegmentOrdinal(segment: HandSegment): number {
  return digitSegments(segment.digit).indexOf(segment.segment);
}

/** Every finger bone of a side, whether or not an Avatar has it. */
export function handBones(side: HandSide): HandBone[] {
  return HAND_SEGMENTS.map((segment) => handBone(side, segment));
}

/** The finger bone a humanoid bone name such as `leftIndexDistal` names. */
export function handBoneOf(boneName: string): HandBone | null {
  for (const side of ["left", "right"] as const)
    for (const bone of handBones(side))
      if (bone.boneName === boneName) return bone;
  return null;
}

/** Availability is per actual bone, so Both never invents a missing counterpart. */
export function resolveHandBones(
  avatar: HandAuthoringAvatar | null,
  target: HandTarget,
  segmentIds = HAND_SEGMENTS.map((segment) => segment.id),
) {
  const available: HandBone[] = [];
  const unavailable: HandBone[] = [];
  const sides: HandSide[] = target === "both" ? ["left", "right"] : [target];
  for (const side of sides)
    for (const segment of HAND_SEGMENTS) {
      if (!segmentIds.includes(segment.id)) continue;
      const bone = handBone(side, segment);
      (normalizedBoneNode(avatar, bone.boneName)
        ? available
        : unavailable
      ).push(bone);
    }
  return { available, unavailable };
}

// ── Curl and Spread ──────────────────────────────────────────────────────

const spreadWeight: Record<HandDigit, number> = {
  thumb: 1,
  index: -0.65,
  middle: -0.15,
  ring: 0.3,
  little: 0.7,
};
/**
 * Local quaternion delta in the editor's normalized T-pose basis (XYZ at the
 * draft boundary). No raw VRM-version sign conversion belongs here. The initial
 * angles are calibration candidates; only the delta is bounded, never the pose.
 */
export function adjustHandQuaternion(
  start: Quaternion,
  side: HandSide,
  digit: HandDigit,
  adjustment: HandAdjustment,
  degrees: number,
): Quaternion {
  if (
    !Number.isFinite(degrees) ||
    !start.toArray().every(Number.isFinite) ||
    start.lengthSq() < 1e-12
  )
    throw new Error("Invalid hand rotation. The pose was left unchanged.");
  const amount = MathUtils.clamp(
    degrees,
    -HAND_ADJUSTMENT_LIMITS[adjustment],
    HAND_ADJUSTMENT_LIMITS[adjustment],
  );
  const sign = side === "left" ? -1 : 1;
  // Thumb flexion adducts across the palm; finger spread fans away from it.
  const axis =
    adjustment === "curl"
      ? new Vector3(
          0,
          digit === "thumb" ? -sign : 0,
          digit === "thumb" ? 0 : sign,
        )
      : new Vector3(0, digit === "thumb" ? sign : -sign, 0);
  const angle = amount * (adjustment === "spread" ? spreadWeight[digit] : 1);
  return start
    .clone()
    .normalize()
    .multiply(
      new Quaternion().setFromAxisAngle(axis, MathUtils.degToRad(angle)),
    )
    .normalize();
}

// ── Presets ──────────────────────────────────────────────────────────────

/**
 * Thumb curl (proximal, distal) of the original presets, in degrees. The
 * distal value always applies; the proximal one only when the thumb cannot be
 * fitted to the Avatar. The thumbs-up tip bends back, as real ones do, so the
 * thumb still reads upright with its proximal joint held to the natural range.
 */
const THUMB_CURL: Partial<Record<HandPreset, readonly [number, number]>> = {
  fist: [65, 15],
  "open-together": [38, 0],
  "thumbs-up": [-50, -25],
};

/**
 * Fits shared by the bones of one hand shape (one side, one preset and one
 * thumb metacarpal pose), so `handShapeRotations` fits a pinch once per hand
 * instead of once per bone.
 */
type HandShapeFits = { pinch?: PinchFit | null };

/** Presets replace all available finger rotations and are therefore idempotent. */
export function handPresetQuaternion(
  bone: HandBone,
  preset: HandPreset,
  avatar?: HandAuthoringAvatar | null,
): Quaternion {
  return presetQuaternion(bone, preset, avatar, {});
}

function presetQuaternion(
  bone: HandBone,
  preset: HandPreset,
  avatar: HandAuthoringAvatar | null | undefined,
  fits: HandShapeFits,
): Quaternion {
  const offsetPreset = OFFSET_PRESETS[preset];
  if (offsetPreset)
    return offsetPresetQuaternion(bone, offsetPreset, avatar, fits);
  if (preset === "relaxed") {
    const rotation = Object.entries(
      AVATAR_POSE_CATALOG[RELAXED_REST_POSE_ID].humanoid ?? {},
    ).find(([name]) => name === bone.boneName)?.[1]?.rotation;
    if (!rotation)
      throw new Error(`Missing Relaxed Rest finger rotation: ${bone.boneName}`);
    return new Quaternion(...rotation);
  }
  if (preset === "point" || preset === "peace") {
    if (
      bone.segment.digit === "index" ||
      (preset === "peace" && bone.segment.digit === "middle")
    ) {
      if (preset === "peace" && bone.segment.segment === "proximal") {
        const angle =
          (bone.side === "left" ? 1 : -1) *
          (bone.segment.digit === "index" ? -15 : 15);
        return new Quaternion().setFromAxisAngle(
          new Vector3(0, 1, 0),
          MathUtils.degToRad(angle),
        );
      }
      return new Quaternion();
    }
    return presetQuaternion(bone, "fist", avatar, fits);
  }
  if (preset === "thumbs-up" && bone.segment.digit !== "thumb")
    return presetQuaternion(bone, "fist", avatar, fits);
  if (bone.segment.digit === "thumb") {
    if (bone.segment.segment === "proximal" && avatar) {
      const fitted = fitThumbPreset(avatar, bone.side, preset);
      if (fitted)
        return withinJointRange(
          handJoint(bone.boneName),
          fitted,
          preset === "thumbs-up" ? "soft" : "hard",
        );
    }
    const [proximal, distal] = THUMB_CURL[preset] ?? [0, 0];
    return adjustHandQuaternion(
      new Quaternion(),
      bone.side,
      "thumb",
      "curl",
      bone.segment.segment === "proximal" ? proximal : distal,
    );
  }
  let result = new Quaternion();
  if (preset === "fist") {
    const angle = bone.segment.segment === "distal" ? 60 : 80;
    result = adjustHandQuaternion(
      result,
      bone.side,
      bone.segment.digit,
      "curl",
      angle,
    );
  }
  if (bone.segment.spread)
    result = adjustHandQuaternion(
      result,
      bone.side,
      bone.segment.digit,
      "spread",
      preset === "open-spread" ? 30 : 0,
    );
  return result;
}

/**
 * A preset written in the same offsets a hand key's `fingers` carry: finger
 * offsets from a straight finger, thumb offsets from the thumb of
 * `thumbFrom`. `pinch` fits index and thumb together on each Avatar
 * (`fitPinch`); without an Avatar, or on a rig that lacks those bones, the
 * index keeps its listed curl and the thumb starts from `open-together`.
 */
type OffsetPreset = {
  thumbFrom: "open-together" | "open-spread" | "pinch";
  digits: Record<HandDigit, HandDigitOffset>;
};

const OFFSET_PRESETS: Partial<Record<HandPreset, OffsetPreset>> = {
  // A soft bowl: claps, cradling, a palm resting on a rounded surface.
  cupped: {
    thumbFrom: "open-together",
    digits: {
      thumb: { curl: [6, 10], palmarAbduction: 14 },
      index: { curl: [16, 22, 14], splay: -1 },
      middle: { curl: [18, 24, 14] },
      ring: { curl: [20, 26, 16], splay: 1 },
      little: { curl: [22, 28, 18], splay: 3 },
    },
  },
  // Fanned fingers bent at the middle joints: paws, "rawr", grabbing air.
  "soft-claw": {
    thumbFrom: "open-spread",
    digits: {
      thumb: { curl: [14, 25], palmarAbduction: 10 },
      index: { curl: [18, 55, 40], splay: 10 },
      middle: { curl: [16, 58, 42], splay: 2 },
      ring: { curl: [18, 58, 42], splay: -6 },
      little: { curl: [22, 55, 40], splay: -14 },
    },
  },
  // Straight, slightly extended fingers: a palm pressed flat on something.
  "palm-flat": {
    thumbFrom: "open-together",
    digits: {
      thumb: { curl: -4 },
      index: { curl: [-4, -2, 0], splay: -1 },
      middle: { curl: [-4, -2, 0] },
      ring: { curl: [-4, -2, 0], splay: 1 },
      little: { curl: [-3, -2, 0], splay: 2 },
    },
  },
  // Index and thumb pads together, other fingers folded: a kiss, a pinch.
  pinch: {
    thumbFrom: "pinch",
    digits: {
      thumb: { curl: [0, 18] },
      index: { curl: [40, 46, 28] },
      middle: { curl: [34, 48, 30], splay: -2 },
      ring: { curl: [42, 52, 30], splay: -1 },
      little: { curl: [50, 54, 30], splay: 2 },
    },
  },
  // The pinch with the other fingers raised and fanned: the OK sign.
  ok: {
    thumbFrom: "pinch",
    digits: {
      thumb: { curl: [0, 18] },
      index: { curl: [40, 46, 28] },
      middle: { curl: [6, 6, 4], splay: -4 },
      ring: { curl: [10, 8, 4], splay: -10 },
      little: { curl: [14, 10, 6], splay: -18 },
    },
  },
};

function offsetPresetQuaternion(
  bone: HandBone,
  preset: OffsetPreset,
  avatar: HandAuthoringAvatar | null | undefined,
  fits: HandShapeFits,
): Quaternion {
  const { digit, segment } = bone.segment;
  const pinch = () => {
    if (preset.thumbFrom !== "pinch" || !avatar) return null;
    if (fits.pinch === undefined)
      fits.pinch = fitPinch(avatar, bone.side, preset.digits.index);
    return fits.pinch;
  };
  if (digit === "index") {
    const indexCurl = pinch()?.indexCurl;
    return applyDigitOffset(
      bone,
      new Quaternion(),
      indexCurl
        ? { ...preset.digits.index, curl: indexCurl }
        : preset.digits.index,
    );
  }
  if (digit !== "thumb")
    return applyDigitOffset(bone, new Quaternion(), preset.digits[digit]);
  const start =
    (segment === "proximal" ? pinch()?.thumb : undefined) ??
    presetQuaternion(
      bone,
      preset.thumbFrom === "pinch" ? "open-together" : preset.thumbFrom,
      avatar,
      fits,
    );
  return applyDigitOffset(bone, start, preset.digits.thumb);
}

// ── Offsets ──────────────────────────────────────────────────────────────

/**
 * Add a digit's offsets to one of its segments' rotations: `curl` on every
 * segment and the other fields on the proximal segment only.
 */
function applyDigitOffset(
  bone: HandBone,
  rotation: Quaternion,
  offset: HandDigitOffset | undefined,
): Quaternion {
  if (!offset) return rotation;
  const { digit } = bone.segment;
  const ordinal = handSegmentOrdinal(bone.segment);
  const values: Record<string, number> = {};
  for (const field of HAND_DIGIT_OFFSETS[digit].fields)
    values[field] =
      field === "curl"
        ? segmentCurl(offset, ordinal)
        : ordinal === 0
          ? (offset[field] ?? 0)
          : 0;
  return addJointOffsets(handJoint(bone.boneName), rotation, values);
}

/** A segment's curl offset: the single value, or its entry in the list. */
export function segmentCurl(offset: HandDigitOffset, ordinal: number): number {
  return typeof offset.curl === "number"
    ? offset.curl
    : (offset.curl?.[ordinal] ?? 0);
}

/**
 * Offset a rotation's joint-model components (degrees). All-zero offsets
 * return the rotation unchanged, so an empty offset is exactly a no-op.
 */
function addJointOffsets(
  joint: ResolvedJoint,
  rotation: Quaternion,
  offsets: Readonly<Record<string, number>>,
): Quaternion {
  if (!Object.values(offsets).every(Number.isFinite))
    throw new Error(`Invalid finger offset on ${joint.id}.`);
  if (Object.values(offsets).every((value) => value === 0)) return rotation;
  const values = decomposeJointRotation(joint, rotation);
  for (const [name, value] of Object.entries(offsets))
    values[name] = (values[name] ?? 0) + value;
  return composeJointRotation(joint, values);
}

/**
 * Clamp a fitted rotation's joint components to the joint's anatomical
 * (`hard`) or natural (`soft`) range. A fit aims a segment at a direction,
 * which on some rigs or thumb metacarpal poses asks more of the joint than it
 * allows. Fitted thumbs use the anatomical range, so every fit that was
 * already possible stays exactly as it was; `thumbs-up` uses the natural
 * range, because its fit reached a curl of about −70° on the Included Avatars
 * even with their own metacarpals. Rotations already in range return
 * unchanged.
 */
function withinJointRange(
  joint: ResolvedJoint,
  rotation: Quaternion,
  range: "hard" | "soft",
): Quaternion {
  const values = decomposeJointRotation(joint, rotation);
  let clamped = false;
  for (const [name, component] of Object.entries(
    JOINT_DEFINITIONS[joint.type].components,
  )) {
    const [min, max] = component[range];
    const value = MathUtils.clamp(values[name], min, max);
    if (value === values[name]) continue;
    values[name] = value;
    clamped = true;
  }
  return clamped ? composeJointRotation(joint, values) : rotation;
}

function handJoint(boneName: string): ResolvedJoint {
  const joint = resolveJoint(boneName);
  if (!joint) throw new Error(`Not a hand joint: ${boneName}`);
  return joint;
}

// ── Fitting ──────────────────────────────────────────────────────────────

/**
 * Rigs end at the distal joint, so a fingertip is estimated as the distal
 * segment extended by this fraction of the segment before it.
 */
const DISTAL_LENGTH_RATIO = 0.8;
/** Range and steps of the pinch fit's search over the listed index curl. */
const PINCH_CURL_SCALE = { min: 0.4, max: 2, steps: 24 } as const;

type PinchFit = { indexCurl: number[]; thumb: Quaternion };

/**
 * Fit a pinch to this Avatar's hand so the index and thumb pads meet whatever
 * its finger proportions: scale the listed index curl until the index tip is
 * one thumb length from the thumb's base, then aim the thumb at that tip.
 * Works in the hand's normalized frame with the thumb metacarpal as currently
 * posed (`handShapeRotations` holds it at the base pose's value). A tip that
 * never comes within reach ends at the most curled scale. Null when the rig
 * lacks the thumb or index bones.
 */
function fitPinch(
  avatar: HandAuthoringAvatar,
  side: HandSide,
  index: HandDigitOffset,
): PinchFit | null {
  const vrm = avatar.vrm;
  const node = (name: string) => normalizedBoneNode(avatar, `${side}${name}`);
  const thumbProximal = node("ThumbProximal");
  const thumbDistal = node("ThumbDistal");
  const indexNodes = digitSegments("index").map((segment) =>
    node(`Index${capitalize(segment)}`),
  );
  const [indexProximal, indexIntermediate, indexDistal] = indexNodes;
  const hand = indexProximal?.parent;
  if (
    !vrm ||
    !thumbProximal?.parent ||
    !thumbDistal ||
    thumbDistal.position.lengthSq() < 1e-12 ||
    !indexProximal ||
    !indexIntermediate ||
    !indexDistal ||
    !hand
  )
    return null;
  const indexBones = HAND_SEGMENTS.filter(
    (segment) => segment.digit === "index",
  ).map((segment) => handBone(side, segment));
  // Normalized bones rest unrotated, so each child's `position` is its
  // parent segment's vector; chain the segments' rotations along them.
  const segmentVectors = [
    indexIntermediate.position,
    indexDistal.position,
    indexDistal.position.clone().multiplyScalar(DISTAL_LENGTH_RATIO),
  ];
  const indexTip = (curl: number[]) => {
    const tip = indexProximal.position.clone();
    const turn = new Quaternion();
    indexBones.forEach((bone, ordinal) => {
      const rotation = applyDigitOffset(bone, new Quaternion(), {
        ...index,
        curl,
      });
      turn.multiply(convertPoseQuaternionBasis(vrm, rotation));
      tip.add(segmentVectors[ordinal].clone().applyQuaternion(turn));
    });
    return tip;
  };
  const listed = indexBones.map((_, ordinal) => segmentCurl(index, ordinal));
  const scaled = (scale: number) => listed.map((value) => value * scale);

  // Updates the hand and metacarpal world matrices too.
  thumbProximal.updateWorldMatrix(true, false);
  const thumbBase = hand.worldToLocal(
    thumbProximal.getWorldPosition(new Vector3()),
  );
  const reach = thumbDistal.position.length() * (1 + DISTAL_LENGTH_RATIO);
  let low: number = PINCH_CURL_SCALE.min;
  let high: number = PINCH_CURL_SCALE.max;
  for (let step = 0; step < PINCH_CURL_SCALE.steps; step += 1) {
    const middle = (low + high) / 2;
    if (indexTip(scaled(middle)).distanceTo(thumbBase) > reach) low = middle;
    else high = middle;
  }
  const indexCurl = scaled((low + high) / 2);
  const target = thumbProximal.parent
    .worldToLocal(hand.localToWorld(indexTip(indexCurl)))
    .sub(thumbProximal.position);
  if (target.lengthSq() < 1e-12) return null;
  const runtime = new Quaternion().setFromUnitVectors(
    thumbDistal.position.clone().normalize(),
    target.normalize(),
  );
  return {
    indexCurl,
    thumb: withinJointRange(
      handJoint(`${side}ThumbProximal`),
      convertPoseQuaternionBasis(vrm, runtime),
      "hard",
    ),
  };
}

/** Fit the two editable thumb joints around the retained metacarpal pose.
 * Normalized joint offsets provide the rest directions without altering the rig.
 */
function fitThumbPreset(
  avatar: HandAuthoringAvatar,
  side: HandSide,
  preset: HandPreset,
): Quaternion | null {
  const node = (name: string) => normalizedBoneNode(avatar, `${side}${name}`);
  const proximal = node("ThumbProximal");
  const distal = node("ThumbDistal");
  const index = node("IndexProximal");
  const indexMiddle = node("IndexIntermediate");
  const little = node("LittleProximal");
  if (
    !proximal?.parent ||
    !distal ||
    !index?.parent ||
    !indexMiddle ||
    ((preset === "open-spread" || preset === "thumbs-up") && !little)
  )
    return null;
  const restDirection = distal.position.clone();
  if (restDirection.lengthSq() < 1e-12) return null;
  const parentRotation = proximal.parent.getWorldQuaternion(new Quaternion());
  const handRotation = index.parent.getWorldQuaternion(new Quaternion());
  let targetDirection: Vector3;
  if (preset === "open-spread" || preset === "thumbs-up") {
    const forward = indexMiddle.position.clone().normalize();
    const outward = index.position.clone().sub(little!.position).normalize();
    targetDirection = forward
      .multiplyScalar(preset === "thumbs-up" ? 0.15 : 1)
      .addScaledVector(outward, preset === "thumbs-up" ? 1 : 0.85)
      .normalize()
      .applyQuaternion(handRotation);
  } else {
    // Cross the folded fingers toward the ring finger; aiming at the index
    // alone points the thumb down beside the fist instead of across it.
    const crossFinger =
      preset === "fist"
        ? ["Ring", "Middle"]
            .map((digit) => ({
              base: node(`${digit}Proximal`),
              tip: node(`${digit}Intermediate`),
            }))
            .find((pair) => pair.base?.parent === index.parent && pair.tip)
        : undefined;
    const crossBase = crossFinger?.base ?? index;
    const crossTip = crossFinger?.tip ?? indexMiddle;
    const fingerRotation =
      preset === "fist"
        ? adjustHandQuaternion(new Quaternion(), side, "index", "curl", 80)
        : new Quaternion();
    const target = crossTip.position
      .clone()
      .applyQuaternion(convertPoseQuaternionBasis(avatar.vrm, fingerRotation))
      .add(crossBase.position);
    if (preset === "fist") {
      // A small palmward clearance keeps the thumb outside the folded mesh.
      target.y -= indexMiddle.position.length() * 0.15;
    } else {
      const outward = little
        ? index.position.clone().sub(little.position).normalize()
        : new Vector3(0, 0, isVrm0(avatar.vrm) ? -1 : 1);
      // Keep a visible thumb-width gap instead of driving into the index mesh.
      target.addScaledVector(outward, indexMiddle.position.length() * 0.6);
    }
    index.parent.updateWorldMatrix(true, false);
    index.parent.localToWorld(target);
    proximal.parent.updateWorldMatrix(true, false);
    targetDirection = proximal.parent
      .worldToLocal(target)
      .sub(proximal.position);
    if (targetDirection.lengthSq() < 1e-12) return null;
    const runtime = new Quaternion().setFromUnitVectors(
      restDirection.normalize(),
      targetDirection.normalize(),
    );
    return convertPoseQuaternionBasis(avatar.vrm, runtime);
  }
  if (targetDirection.lengthSq() < 1e-12) return null;
  targetDirection.applyQuaternion(parentRotation.invert()).normalize();
  const runtime = new Quaternion().setFromUnitVectors(
    restDirection.normalize(),
    targetDirection,
  );
  return convertPoseQuaternionBasis(avatar.vrm, runtime);
}

function normalizedBoneNode(
  avatar: HandAuthoringAvatar | null | undefined,
  boneName: string,
) {
  if (!isVRMHumanBoneName(boneName)) return null;
  return avatar?.vrm?.humanoid.getNormalizedBoneNode(boneName) ?? null;
}

// ── Hand keys ────────────────────────────────────────────────────────────

/**
 * Finger rotations (canonical basis) for a hand shape, exactly as the Hands
 * tool applies a preset followed by relative Curl and Spread, then the key's
 * per-finger offsets. Thumbs are fitted to the Avatar with its thumb
 * metacarpal held at `metacarpal` (the base pose's value; hand shapes never
 * move it), so the result does not depend on the pose the Avatar happens to
 * hold. Without an Avatar, thumbs and the pinch use the unfitted presets.
 * Bones the Avatar lacks are left out. Thumb metacarpals are never written.
 */
export function handShapeRotations(
  vrm: VRM | null,
  side: HandSide,
  shape: HandShape,
  metacarpal: readonly [number, number, number, number] | undefined,
): Map<VRMHumanBoneName, Quaternion> {
  const avatar = vrm ? { vrm } : null;
  const bones: HandBone[] = avatar
    ? resolveHandBones(avatar, side).available
    : handBones(side);
  const node = normalizedBoneNode(avatar, `${side}ThumbMetacarpal`);
  const saved = node?.quaternion.clone();
  if (node && vrm)
    node.quaternion.copy(
      convertPoseQuaternionBasis(
        vrm,
        new Quaternion(...(metacarpal ?? [0, 0, 0, 1])),
      ),
    );
  try {
    const rotations = new Map<VRMHumanBoneName, Quaternion>();
    const fits: HandShapeFits = {};
    for (const bone of bones) {
      const { digit } = bone.segment;
      let rotation = presetQuaternion(bone, shape.preset, avatar, fits);
      if (shape.curl)
        rotation = adjustHandQuaternion(
          rotation,
          bone.side,
          digit,
          "curl",
          shape.curl,
        );
      if (shape.spread && bone.segment.spread)
        rotation = adjustHandQuaternion(
          rotation,
          bone.side,
          digit,
          "spread",
          shape.spread,
        );
      rotation = applyDigitOffset(bone, rotation, shape.fingers?.[digit]);
      rotations.set(bone.boneName as VRMHumanBoneName, rotation);
    }
    return rotations;
  } finally {
    if (node && saved) node.quaternion.copy(saved);
  }
}
