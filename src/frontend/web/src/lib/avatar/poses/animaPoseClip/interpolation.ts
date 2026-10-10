import type {
  VRMHumanBoneName,
  VRMPose,
  VRMPoseTransform,
} from "@pixiv/three-vrm";
import { MathUtils, Quaternion } from "three";

import { isVRMHumanBoneName } from "../animaPose";
import type {
  AnimaPoseClipEasing,
  AnimaPoseClipRotationInterpolation,
  AnimaPoseClipSample,
  AnimaPoseClipScalarInterpolation,
  QuaternionTuple,
  ResolvedAnimaPoseClipTransition,
  VectorTuple,
} from "./clipVocabulary";
import { ANIMA_POSE_CLIP_EPSILON } from "./clipVocabulary";

const SOFT_BACK_BLEND_WEIGHT = 0.1;
const SOFT_ELASTIC_BLEND_WEIGHT = 0.1;
const SOFT_BOUNCE_BLEND_WEIGHT = 0.1;

export function interpolateSamples(
  fromSample: AnimaPoseClipSample,
  toSample: AnimaPoseClipSample,
  segmentProgress: number,
  easedProgress: number,
  transition: ResolvedAnimaPoseClipTransition,
): AnimaPoseClipSample {
  const humanoid = interpolateHumanoidPose(
    fromSample.humanoid,
    toSample.humanoid,
    segmentProgress,
    easedProgress,
    transition,
  );
  const expressions = interpolateExpressionWeights(
    fromSample.expressions,
    toSample.expressions,
    segmentProgress,
    easedProgress,
    transition.interpolation.expression,
  );

  return {
    ...(humanoid ? { humanoid } : {}),
    ...(expressions ? { expressions } : {}),
  };
}

export function easeProgress(t: number, easing: AnimaPoseClipEasing): number {
  const clamped = MathUtils.clamp(t, 0, 1);
  switch (easing) {
    case "linear":
      return clamped;
    case "easeInSine":
      return 1 - Math.cos((clamped * Math.PI) / 2);
    case "easeOutSine":
      return Math.sin((clamped * Math.PI) / 2);
    case "easeInOutSine":
      return easeInOutSine(clamped);
    case "easeInCubic":
      return clamped * clamped * clamped;
    case "easeOutCubic":
      return 1 - Math.pow(1 - clamped, 3);
    case "easeInOutCubic":
      return clamped < 0.5
        ? 4 * clamped * clamped * clamped
        : 1 - Math.pow(-2 * clamped + 2, 3) / 2;
    case "back":
      return blendWithEaseInOutSine(
        clamped,
        easeOutBack(clamped),
        SOFT_BACK_BLEND_WEIGHT,
      );
    case "elastic":
      return blendWithEaseInOutSine(
        clamped,
        easeOutElastic(clamped),
        SOFT_ELASTIC_BLEND_WEIGHT,
      );
    case "bounce":
      return blendWithEaseInOutSine(
        clamped,
        easeOutBounce(clamped),
        SOFT_BOUNCE_BLEND_WEIGHT,
      );
  }
}

function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

function blendWithEaseInOutSine(
  t: number,
  stylizedProgress: number,
  stylizedWeight: number,
): number {
  return MathUtils.lerp(easeInOutSine(t), stylizedProgress, stylizedWeight);
}

function easeOutBack(t: number): number {
  const overshoot = 1.70158;
  const shifted = t - 1;
  return (
    1 +
    (overshoot + 1) * shifted * shifted * shifted +
    overshoot * shifted * shifted
  );
}

function easeOutElastic(t: number): number {
  if (t === 0 || t === 1) return t;
  const period = (2 * Math.PI) / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * period) + 1;
}

function easeOutBounce(t: number): number {
  const bounce = 7.5625;
  const segment = 2.75;

  if (t < 1 / segment) {
    return bounce * t * t;
  }
  if (t < 2 / segment) {
    const shifted = t - 1.5 / segment;
    return bounce * shifted * shifted + 0.75;
  }
  if (t < 2.5 / segment) {
    const shifted = t - 2.25 / segment;
    return bounce * shifted * shifted + 0.9375;
  }

  const shifted = t - 2.625 / segment;
  return bounce * shifted * shifted + 0.984375;
}

function interpolateHumanoidPose(
  fromPose: VRMPose | undefined,
  toPose: VRMPose | undefined,
  segmentProgress: number,
  easedProgress: number,
  transition: ResolvedAnimaPoseClipTransition,
): VRMPose | undefined {
  const boneNames = new Set<VRMHumanBoneName>([
    ...getPoseBoneNames(fromPose),
    ...getPoseBoneNames(toPose),
  ]);
  if (boneNames.size === 0) return undefined;

  const pose: VRMPose = {};
  for (const boneName of boneNames) {
    const transform = interpolatePoseTransform(
      fromPose?.[boneName],
      toPose?.[boneName],
      segmentProgress,
      easedProgress,
      transition,
    );
    if (transform) {
      pose[boneName] = transform;
    }
  }

  return Object.keys(pose).length > 0 ? pose : undefined;
}

function interpolatePoseTransform(
  fromTransform: VRMPoseTransform | undefined,
  toTransform: VRMPoseTransform | undefined,
  segmentProgress: number,
  easedProgress: number,
  transition: ResolvedAnimaPoseClipTransition,
): VRMPoseTransform | null {
  if (!fromTransform && !toTransform) return null;

  const position = interpolateVectorTuple(
    toVectorTuple(fromTransform?.position),
    toVectorTuple(toTransform?.position),
    segmentProgress,
    easedProgress,
    transition.interpolation.humanoidPosition,
  );
  const rotation = interpolateQuaternionTuple(
    toQuaternionTuple(fromTransform?.rotation),
    toQuaternionTuple(toTransform?.rotation),
    segmentProgress,
    easedProgress,
    transition.interpolation.humanoidRotation,
  );

  return {
    ...(position ? { position } : {}),
    ...(rotation ? { rotation } : {}),
  };
}

function interpolateExpressionWeights(
  fromExpressions: Record<string, number> | undefined,
  toExpressions: Record<string, number> | undefined,
  segmentProgress: number,
  easedProgress: number,
  interpolation: AnimaPoseClipScalarInterpolation,
): Record<string, number> | undefined {
  const expressionNames = new Set<string>([
    ...Object.keys(fromExpressions ?? {}),
    ...Object.keys(toExpressions ?? {}),
  ]);
  if (expressionNames.size === 0) return undefined;

  const expressions: Record<string, number> = {};
  for (const expressionName of expressionNames) {
    const fromValue = fromExpressions?.[expressionName];
    const toValue = toExpressions?.[expressionName];
    expressions[expressionName] = interpolateScalar(
      fromValue,
      toValue,
      segmentProgress,
      easedProgress,
      interpolation,
    );
  }

  return expressions;
}

function interpolateVectorTuple(
  fromValue: VectorTuple | null,
  toValue: VectorTuple | null,
  segmentProgress: number,
  easedProgress: number,
  interpolation: AnimaPoseClipScalarInterpolation,
): VectorTuple | null {
  if (!fromValue && !toValue) return null;
  if (!fromValue) return cloneVectorTuple(toValue);
  if (!toValue) return cloneVectorTuple(fromValue);
  if (interpolation === "step") {
    return cloneVectorTuple(segmentProgress >= 1 ? toValue : fromValue);
  }
  return [
    MathUtils.lerp(fromValue[0], toValue[0], easedProgress),
    MathUtils.lerp(fromValue[1], toValue[1], easedProgress),
    MathUtils.lerp(fromValue[2], toValue[2], easedProgress),
  ];
}

function interpolateQuaternionTuple(
  fromValue: QuaternionTuple | null,
  toValue: QuaternionTuple | null,
  segmentProgress: number,
  easedProgress: number,
  interpolation: AnimaPoseClipRotationInterpolation,
): QuaternionTuple | null {
  if (!fromValue && !toValue) return null;
  if (!fromValue) return cloneQuaternionTuple(toValue);
  if (!toValue) return cloneQuaternionTuple(fromValue);

  if (interpolation === "step") {
    return cloneQuaternionTuple(segmentProgress >= 1 ? toValue : fromValue);
  }
  if (interpolation === "nlerp") {
    return nlerpQuaternionTuples(fromValue, toValue, easedProgress);
  }
  return slerpQuaternionTuples(fromValue, toValue, easedProgress);
}

function interpolateScalar(
  fromValue: number | undefined,
  toValue: number | undefined,
  segmentProgress: number,
  easedProgress: number,
  interpolation: AnimaPoseClipScalarInterpolation,
): number {
  // Expression keyframes are intentionally sparse. An omitted channel means
  // the neutral expression weight, not "inherit whichever side defined it".
  // Treating absence as zero lets authoring omit zero-valued expressions while
  // still producing smooth fade-ins and fade-outs between landmarks.
  const from = fromValue ?? 0;
  const to = toValue ?? 0;
  if (interpolation === "step") {
    return segmentProgress >= 1 ? to : from;
  }
  return MathUtils.lerp(from, to, easedProgress);
}

function slerpQuaternionTuples(
  fromValue: QuaternionTuple,
  toValue: QuaternionTuple,
  t: number,
): QuaternionTuple {
  const quaternion = new Quaternion().fromArray(fromValue);
  quaternion.slerp(new Quaternion().fromArray(toValue), t).normalize();
  return quaternion.toArray([0, 0, 0, 1] as QuaternionTuple, 0);
}

function nlerpQuaternionTuples(
  fromValue: QuaternionTuple,
  toValue: QuaternionTuple,
  t: number,
): QuaternionTuple {
  const fromQuaternion = new Quaternion().fromArray(fromValue).normalize();
  const toQuaternion = new Quaternion().fromArray(toValue).normalize();
  if (fromQuaternion.dot(toQuaternion) < 0) {
    toQuaternion.set(
      -toQuaternion.x,
      -toQuaternion.y,
      -toQuaternion.z,
      -toQuaternion.w,
    );
  }

  const x = MathUtils.lerp(fromQuaternion.x, toQuaternion.x, t);
  const y = MathUtils.lerp(fromQuaternion.y, toQuaternion.y, t);
  const z = MathUtils.lerp(fromQuaternion.z, toQuaternion.z, t);
  const w = MathUtils.lerp(fromQuaternion.w, toQuaternion.w, t);
  const length = Math.hypot(x, y, z, w);
  if (length <= ANIMA_POSE_CLIP_EPSILON) return [...fromValue];
  return [x / length, y / length, z / length, w / length];
}

function cloneVectorTuple(value: VectorTuple | null): VectorTuple | null {
  return value ? [value[0], value[1], value[2]] : null;
}

function cloneQuaternionTuple(
  value: QuaternionTuple | null,
): QuaternionTuple | null {
  return value ? [value[0], value[1], value[2], value[3]] : null;
}

function getPoseBoneNames(pose: VRMPose | undefined): VRMHumanBoneName[] {
  return Object.keys(pose ?? {}).filter(isVRMHumanBoneName);
}

function toVectorTuple(
  value: VRMPoseTransform["position"],
): VectorTuple | null {
  if (!value) return null;
  return [value[0], value[1], value[2]];
}

function toQuaternionTuple(
  value: VRMPoseTransform["rotation"],
): QuaternionTuple | null {
  if (!value) return null;
  return [value[0], value[1], value[2], value[3]];
}
