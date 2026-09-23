import { MathUtils, Quaternion, Vector3 } from "three";
import type { Avatar } from "@/lib/avatar";
import { getPoseCreatorNormalizedBoneNode } from "./poseCreatorAuthoring";

export type HandTarget = "left" | "right" | "both";
export type HandSide = Exclude<HandTarget, "both">;
export type HandDigit = "thumb" | "index" | "middle" | "ring" | "little";
export type HandAdjustment = "curl" | "spread";
export type HandPreset = "fist" | "open-spread" | "open-together";
export type HandSegment = {
  id: string;
  digit: HandDigit;
  segment: "metacarpal" | "proximal" | "intermediate" | "distal";
  label: string;
  spread: boolean;
};
const capitalize = (value: string) => value[0].toUpperCase() + value.slice(1);
export const HAND_SEGMENTS: HandSegment[] = (
  ["thumb", "index", "middle", "ring", "little"] as const
).flatMap((digit) =>
  (digit === "thumb"
    ? (["metacarpal", "proximal", "distal"] as const)
    : (["proximal", "intermediate", "distal"] as const)
  ).map((segment, index) => ({
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
/** Availability is per actual bone, so Both never invents a missing counterpart. */
export function resolveHandBones(
  avatar: Avatar | null,
  target: HandTarget,
  segmentIds = HAND_SEGMENTS.map((segment) => segment.id),
) {
  const available: HandBone[] = [];
  const unavailable: HandBone[] = [];
  const sides: HandSide[] = target === "both" ? ["left", "right"] : [target];
  for (const side of sides)
    for (const segment of HAND_SEGMENTS) {
      if (!segmentIds.includes(segment.id)) continue;
      const bone = {
        boneName: `${side}${capitalize(segment.id)}`,
        side,
        segment,
      };
      (getPoseCreatorNormalizedBoneNode(avatar, bone.boneName)
        ? available
        : unavailable
      ).push(bone);
    }
  return { available, unavailable };
}
export const HAND_ADJUSTMENT_LIMITS = { curl: 90, spread: 30 } as const;
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
  // Thumb flexion crosses the palm on Y; its base abduction uses Z.
  const axis =
    adjustment === "curl"
      ? new Vector3(
          0,
          digit === "thumb" ? sign : 0,
          digit === "thumb" ? 0 : sign,
        )
      : new Vector3(
          0,
          digit === "thumb" ? 0 : sign,
          digit === "thumb" ? sign : 0,
        );
  const angle = amount * (adjustment === "spread" ? spreadWeight[digit] : 1);
  return start
    .clone()
    .normalize()
    .multiply(
      new Quaternion().setFromAxisAngle(axis, MathUtils.degToRad(angle)),
    )
    .normalize();
}
/** Presets replace all available finger rotations and are therefore idempotent. */
export function handPresetQuaternion(
  bone: HandBone,
  preset: HandPreset,
): Quaternion {
  let result = new Quaternion();
  if (preset === "fist") {
    const angle =
      bone.segment.digit === "thumb"
        ? bone.segment.spread
          ? 35
          : 45
        : bone.segment.segment === "distal"
          ? 60
          : 80;
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
      preset === "open-spread" ? 30 : bone.segment.digit === "thumb" ? 10 : 0,
    );
  return result;
}
