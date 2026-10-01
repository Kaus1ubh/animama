import { MathUtils, Quaternion, Vector3 } from "three";
import type { Avatar } from "@/lib/avatar";
import {
  AVATAR_POSE_CATALOG,
  RELAXED_REST_POSE_ID,
} from "@/lib/avatar/poses/catalog";
import {
  convertPoseQuaternionBasis,
  isVrm0,
} from "@/lib/avatar/poses/poseRetargeting";
import { getPoseCreatorNormalizedBoneNode } from "./poseCreatorAuthoring";

export type HandTarget = "left" | "right" | "both";
export type HandSide = Exclude<HandTarget, "both">;
export type HandDigit = "thumb" | "index" | "middle" | "ring" | "little";
export type HandAdjustment = "curl" | "spread";
export const HAND_PRESETS = [
  { id: "fist", name: "Fist" },
  { id: "open-spread", name: "Open · spread" },
  { id: "open-together", name: "Open · together" },
  { id: "relaxed", name: "Relaxed" },
  { id: "point", name: "Point" },
  { id: "peace", name: "Peace" },
  { id: "thumbs-up", name: "Thumbs up" },
] as const;
export type HandPreset = (typeof HAND_PRESETS)[number]["id"];
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
    ? (["proximal", "distal"] as const)
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
/** Presets replace all available finger rotations and are therefore idempotent. */
export function handPresetQuaternion(
  bone: HandBone,
  preset: HandPreset,
  avatar?: Avatar | null,
): Quaternion {
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
    return handPresetQuaternion(bone, "fist", avatar);
  }
  if (preset === "thumbs-up" && bone.segment.digit !== "thumb")
    return handPresetQuaternion(bone, "fist", avatar);
  if (bone.segment.digit === "thumb") {
    if (bone.segment.segment === "proximal" && avatar) {
      const fitted = fitThumbPreset(avatar, bone.side, preset);
      if (fitted) return fitted;
    }
    return adjustHandQuaternion(
      new Quaternion(),
      bone.side,
      "thumb",
      "curl",
      preset === "fist"
        ? bone.segment.segment === "proximal"
          ? 65
          : 15
        : bone.segment.segment === "proximal" && preset === "open-together"
          ? 38
          : bone.segment.segment === "proximal" && preset === "thumbs-up"
            ? -50
            : 0,
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

/** Fit the two editable thumb joints around the retained metacarpal pose.
 * Normalized joint offsets provide the rest directions without altering the rig.
 */
function fitThumbPreset(
  avatar: Avatar,
  side: HandSide,
  preset: HandPreset,
): Quaternion | null {
  const node = (name: string) =>
    getPoseCreatorNormalizedBoneNode(avatar, `${side}${name}`);
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
