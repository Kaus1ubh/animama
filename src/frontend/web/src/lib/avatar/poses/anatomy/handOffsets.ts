import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import { MathUtils, Quaternion } from "three";

import {
  angularDistanceDegrees,
  decomposeJointRotation,
  resolveJoint,
} from "./anatomy";
import {
  HAND_ADJUSTMENT_LIMITS,
  HAND_DIGIT_OFFSETS,
  HAND_FINGER_OFFSET_LIMIT,
  HAND_PRESETS,
  type HandDigit,
} from "./handPresetIds";
import {
  adjustHandQuaternion,
  handBoneOf,
  handSegmentOrdinal,
  handShapeRotations,
  segmentCurl,
  type HandAdjustment,
  type HandBone,
  type HandDigitOffset,
  type HandShape,
  type HandSide,
} from "./handPresets";

/**
 * Hand keys' per-finger offsets as the creator edits them. A hand key plays
 * its preset, then relative Curl and Spread, then per-finger offsets added to
 * each segment's joint-model components (`handShapeRotations`). This module
 * goes the other way: it reads offsets back from finger rotations (a Bones
 * edit of a preset-driven hand) and applies the Hands tool's Curl and Spread
 * to a hand shape, so the creator can keep a hand as a preset plus offsets.
 */

/** Offsets are kept to this many decimals of a degree. */
const OFFSET_DECIMALS = 2;

type QuaternionTuple = readonly [number, number, number, number];

/** A digit's offsets with the curl spelled out per segment, for editing. */
type ExpandedOffset = {
  curl: number[];
  /** Proximal-segment fields other than curl (splay, palmarAbduction, twist). */
  proximal: Record<string, number>;
};

export type HandShapeFit = {
  /** `shape` with offsets that play the given rotations as closely as offsets can. */
  shape: HandShape;
  /** Degrees between each given rotation and what the fitted shape plays. */
  residuals: Map<VRMHumanBoneName, number>;
  /** Given bones whose offsets were held at ±`HAND_FINGER_OFFSET_LIMIT`. */
  limited: Set<VRMHumanBoneName>;
};

/** A shape's preset, Curl and Spread without its offsets. */
function withoutOffsets(shape: HandShape): HandShape {
  return {
    preset: shape.preset,
    ...(shape.curl ? { curl: shape.curl } : {}),
    ...(shape.spread ? { spread: shape.spread } : {}),
  };
}

function expand(digit: HandDigit, offset?: HandDigitOffset): ExpandedOffset {
  const { fields, segments } = HAND_DIGIT_OFFSETS[digit];
  return {
    curl: segments.map((_, ordinal) =>
      offset ? segmentCurl(offset, ordinal) : 0,
    ),
    proximal: Object.fromEntries(
      fields
        .filter((field) => field !== "curl")
        .map((field) => [
          field,
          offset?.[field as Exclude<keyof HandDigitOffset, "curl">] ?? 0,
        ]),
    ),
  };
}

/** The stored form: one curl when every segment agrees, zeros left out. */
function compact(expanded: ExpandedOffset): HandDigitOffset | undefined {
  const offset: HandDigitOffset = {};
  const [first] = expanded.curl;
  if (expanded.curl.every((value) => value === first)) {
    if (first !== 0) offset.curl = first;
  } else offset.curl = [...expanded.curl];
  for (const [field, value] of Object.entries(expanded.proximal))
    if (value !== 0)
      offset[field as Exclude<keyof HandDigitOffset, "curl">] = value;
  return Object.keys(offset).length > 0 ? offset : undefined;
}

/** An offset at the stored precision and within the key's limit. */
function offsetValue(degrees: number): number {
  const factor = 10 ** OFFSET_DECIMALS;
  const limited = MathUtils.clamp(
    degrees,
    -HAND_FINGER_OFFSET_LIMIT,
    HAND_FINGER_OFFSET_LIMIT,
  );
  // `|| 0` turns −0 into 0, so equal shapes compare and serialize equally.
  return Math.round(limited * factor) / factor || 0;
}

/**
 * A hand shape in its stored form: zero Curl and Spread and zero offsets left
 * out, a digit's curl as one value when its segments agree.
 */
export function normalizeHandShape(shape: HandShape): HandShape {
  const fingers: NonNullable<HandShape["fingers"]> = {};
  for (const [digit, offset] of Object.entries(shape.fingers ?? {})) {
    const compacted = compact(expand(digit as HandDigit, offset));
    if (compacted) fingers[digit as HandDigit] = compacted;
  }
  return {
    ...withoutOffsets(shape),
    ...(Object.keys(fingers).length > 0 ? { fingers } : {}),
  };
}

/**
 * The offsets that make `shape` play `rotations` on this Avatar (canonical
 * basis; thumbs fitted with the metacarpal at `metacarpal`). Each given bone's
 * rotation is read relative to the shape's preset, Curl and Spread, and the
 * difference becomes that segment's offsets; bones not given keep the shape's
 * offsets. Offsets cannot express finger twist, splay, abduction or twist past
 * the proximal segment, or more than ±`HAND_FINGER_OFFSET_LIMIT`°; those parts
 * are dropped, and `residuals` reports how far each given bone ends up from
 * its rotation, so callers can tell an exact fit from an approximation.
 */
export function fitHandShapeOffsets(
  vrm: VRM | null,
  side: HandSide,
  shape: HandShape,
  rotations: ReadonlyMap<VRMHumanBoneName, Quaternion>,
  metacarpal: QuaternionTuple | undefined,
): HandShapeFit {
  const base = handShapeRotations(vrm, side, withoutOffsets(shape), metacarpal);
  const digits = new Map<HandDigit, ExpandedOffset>();
  const limited = new Set<VRMHumanBoneName>();
  for (const [bone, rotation] of rotations) {
    const from = base.get(bone);
    const hand = handBoneOf(bone);
    const joint = resolveJoint(bone);
    if (!from || !hand || hand.side !== side || !joint) continue;
    const { digit } = hand.segment;
    const ordinal = handSegmentOrdinal(hand.segment);
    const start = decomposeJointRotation(joint, from);
    const target = decomposeJointRotation(joint, rotation, start);
    const offset = digits.get(digit) ?? expand(digit, shape.fingers?.[digit]);
    for (const field of HAND_DIGIT_OFFSETS[digit].fields) {
      if (field !== "curl" && ordinal !== 0) continue;
      const change = target[field] - start[field];
      if (Math.abs(change) > HAND_FINGER_OFFSET_LIMIT) limited.add(bone);
      if (field === "curl") offset.curl[ordinal] = offsetValue(change);
      else offset.proximal[field] = offsetValue(change);
    }
    digits.set(digit, offset);
  }
  const fingers: NonNullable<HandShape["fingers"]> = { ...shape.fingers };
  for (const [digit, offset] of digits) {
    const compacted = compact(offset);
    if (compacted) fingers[digit] = compacted;
    else delete fingers[digit];
  }
  const fitted = normalizeHandShape({ ...shape, fingers });
  const played = handShapeRotations(vrm, side, fitted, metacarpal);
  const residuals = new Map<VRMHumanBoneName, number>();
  for (const [bone, rotation] of rotations) {
    const result = played.get(bone);
    if (result) residuals.set(bone, angularDistanceDegrees(result, rotation));
  }
  return { shape: fitted, residuals, limited };
}

/**
 * Whether turning a finger bone from `from` to `to` changes only what a hand
 * key's offsets carry: curl on any segment, and on the proximal segment
 * splay (fingers) or palmar abduction and twist (thumb). Other joint-model
 * components (finger twist, splay or abduction past the proximal segment)
 * may change by at most `tolerance` degrees. This judges an edit, not the
 * pose: a hand between two keys that offsets only approximate can still take
 * an edit offsets express. The ±`HAND_FINGER_OFFSET_LIMIT` range is checked
 * by `fitHandShapeOffsets` (`limited`). False for bones that are not fingers.
 */
export function isOffsetExpressible(
  bone: VRMHumanBoneName,
  from: Quaternion,
  to: Quaternion,
  tolerance: number,
): boolean {
  const hand = handBoneOf(bone);
  const joint = resolveJoint(bone);
  if (!hand || !joint) return false;
  const ordinal = handSegmentOrdinal(hand.segment);
  const fields: readonly string[] =
    HAND_DIGIT_OFFSETS[hand.segment.digit].fields;
  const start = decomposeJointRotation(joint, from);
  const end = decomposeJointRotation(joint, to, start);
  return Object.keys(start).every(
    (name) =>
      (fields.includes(name) && (name === "curl" || ordinal === 0)) ||
      Math.abs(end[name] - start[name]) <= tolerance,
  );
}

/**
 * The simplest hand shape that plays `rotations` within `tolerance` degrees
 * on this Avatar: of the presets whose offsets fit every bone, the one that
 * needs the smallest offsets (a preset that matches exactly needs none).
 * Null when no preset fits.
 */
export function fitHandShape(
  vrm: VRM | null,
  side: HandSide,
  rotations: ReadonlyMap<VRMHumanBoneName, Quaternion>,
  metacarpal: QuaternionTuple | undefined,
  tolerance: number,
): HandShape | null {
  let best: { shape: HandShape; size: number } | null = null;
  for (const { id: preset } of HAND_PRESETS) {
    const fit = fitHandShapeOffsets(
      vrm,
      side,
      { preset },
      rotations,
      metacarpal,
    );
    if ([...fit.residuals.values()].some((residual) => residual > tolerance))
      continue;
    const size = Object.entries(fit.shape.fingers ?? {}).reduce(
      (sum, [digit, offset]) => {
        const { curl, proximal } = expand(digit as HandDigit, offset);
        return (
          sum +
          [...curl, ...Object.values(proximal)].reduce(
            (total, value) => total + Math.abs(value),
            0,
          )
        );
      },
      0,
    );
    if (!best || size < best.size) best = { shape: fit.shape, size };
  }
  return best?.shape ?? null;
}

/**
 * A hand shape after the Hands tool's Curl or Spread by `degrees`. When the
 * adjustment reaches the whole hand (`"hand"`), it changes the key's relative
 * Curl or Spread, within their limits. Otherwise it offsets the given
 * segments by the joint-model change the same Curl or Spread makes to a
 * straight segment (Spread reaches proximal segments only), so one finger can
 * curl without the others.
 */
export function adjustHandShape(
  shape: HandShape,
  side: HandSide,
  adjustment: HandAdjustment,
  degrees: number,
  reach: readonly HandBone[] | "hand",
): HandShape {
  if (!Number.isFinite(degrees))
    throw new Error("Invalid hand rotation. The pose was left unchanged.");
  if (reach === "hand") {
    const limit = HAND_ADJUSTMENT_LIMITS[adjustment];
    return normalizeHandShape({
      ...shape,
      [adjustment]: MathUtils.clamp(
        (shape[adjustment] ?? 0) + degrees,
        -limit,
        limit,
      ),
    });
  }
  const fingers: NonNullable<HandShape["fingers"]> = { ...shape.fingers };
  const digits = new Map<HandDigit, ExpandedOffset>();
  for (const bone of reach) {
    const joint = resolveJoint(bone.boneName);
    if (bone.side !== side || !joint) continue;
    if (adjustment === "spread" && !bone.segment.spread) continue;
    const { digit } = bone.segment;
    const ordinal = handSegmentOrdinal(bone.segment);
    const change = decomposeJointRotation(
      joint,
      adjustHandQuaternion(new Quaternion(), side, digit, adjustment, degrees),
    );
    const offset = digits.get(digit) ?? expand(digit, fingers[digit]);
    for (const field of HAND_DIGIT_OFFSETS[digit].fields) {
      if (Math.abs(change[field]) < 1e-9) continue;
      if (field === "curl")
        offset.curl[ordinal] = offsetValue(
          offset.curl[ordinal] + change[field],
        );
      else if (ordinal === 0)
        offset.proximal[field] = offsetValue(
          offset.proximal[field] + change[field],
        );
    }
    digits.set(digit, offset);
  }
  for (const [digit, offset] of digits) {
    const compacted = compact(offset);
    if (compacted) fingers[digit] = compacted;
    else delete fingers[digit];
  }
  return normalizeHandShape({ ...shape, fingers });
}
