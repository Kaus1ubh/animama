import {
  VRMHumanBoneName,
  type VRM,
  type VRMPose,
  type VRMPoseTransform,
} from "@pixiv/three-vrm";
import { Euler, MathUtils, Quaternion } from "three";

import {
  foldMissingTorsoRotations,
  torsoFoldsOf,
} from "./anatomy/optionalBones";

export const ANIMA_POSE_SCHEMA = "animaPose/1.0" as const;

export type AnimaPoseParent = {
  ref: string;
  inheritHumanoid?: boolean;
  inheritExpressions?: boolean;
};

export type AnimaPose = {
  schema: typeof ANIMA_POSE_SCHEMA;
  id: string;
  name: string;
  parent?: AnimaPoseParent;
  humanoid?: VRMPose;
  expressions?: Record<string, number>;
};

export type ResolvedAnimaPose = Omit<AnimaPose, "parent">;

export type AnimaPosePositionTuple = [number, number, number];

export type AnimaPoseQuaternionTuple = [number, number, number, number];

export type AnimaPoseEulerDegreesTuple = [number, number, number];

export type AnimaPoseRotationOrder = "XYZ";

export type AnimaPoseAuthoringTransform = {
  position?: AnimaPosePositionTuple;
} & (
  | {
      rotation: AnimaPoseQuaternionTuple;
      rotationEulerDegrees?: never;
    }
  | {
      rotation?: never;
      rotationEulerDegrees: AnimaPoseEulerDegreesTuple;
    }
  | {
      rotation?: never;
      rotationEulerDegrees?: never;
    }
);

export type ResolveAnimaPoseById = (
  poseId: string,
) => AnimaPose | null | undefined;

export type AnimaPoseApplyResult = {
  appliedHumanoidBones: VRMHumanBoneName[];
  skippedHumanoidBones: VRMHumanBoneName[];
  appliedExpressions: string[];
  skippedExpressions: string[];
};

const KNOWN_HUMAN_BONE_NAMES = new Set<string>(Object.values(VRMHumanBoneName));
const ANIMA_POSE_ROTATION_ORDER: AnimaPoseRotationOrder = "XYZ";
const EPSILON = 0.000001;

export function parseAnimaPose(value: unknown): AnimaPose {
  const pose = sanitizeAnimaPose(value);
  if (!pose) {
    throw new Error("Invalid animaPose/1.0 payload");
  }
  return pose;
}

export function sanitizeAnimaPose(value: unknown): AnimaPose | null {
  if (!isRecord(value)) return null;
  if (value.schema !== ANIMA_POSE_SCHEMA) return null;

  const id = sanitizeRequiredString(value.id);
  const name = sanitizeRequiredString(value.name);
  if (!id || !name) return null;

  const parent =
    value.parent === undefined
      ? undefined
      : sanitizeAnimaPoseParent(value.parent);
  if (value.parent !== undefined && !parent) return null;

  const rotationOrder = sanitizeRotationOrder(value.rotationOrder);
  if (!rotationOrder) return null;

  const humanoid =
    value.humanoid === undefined
      ? undefined
      : sanitizeHumanoidPose(value.humanoid, rotationOrder);
  if (value.humanoid !== undefined && !humanoid) return null;

  const expressions =
    value.expressions === undefined
      ? undefined
      : sanitizeExpressionWeights(value.expressions);
  if (value.expressions !== undefined && !expressions) return null;

  return {
    schema: ANIMA_POSE_SCHEMA,
    id,
    name,
    ...(parent ? { parent } : {}),
    ...(humanoid ? { humanoid } : {}),
    ...(expressions ? { expressions } : {}),
  };
}

export function resolveAnimaPose(
  pose: AnimaPose,
  resolveById: ResolveAnimaPoseById,
): ResolvedAnimaPose {
  return resolveAnimaPoseInternal(parseAnimaPose(pose), resolveById, []);
}

export function mergeResolvedAnimaPose(
  parent: Pick<ResolvedAnimaPose, "humanoid" | "expressions">,
  child: AnimaPose | ResolvedAnimaPose,
): ResolvedAnimaPose {
  const childPose = parseAnimaPose(child);
  return {
    schema: ANIMA_POSE_SCHEMA,
    id: childPose.id,
    name: childPose.name,
    ...mergePoseTargets(parent, childPose),
  };
}

export function applyAnimaPoseToVrm(
  vrm: VRM,
  pose: AnimaPose,
): AnimaPoseApplyResult {
  const sanitizedPose = parseAnimaPose(pose);
  const result: AnimaPoseApplyResult = {
    appliedHumanoidBones: [],
    skippedHumanoidBones: [],
    appliedExpressions: [],
    skippedExpressions: [],
  };

  // A rig without an upper chest (or chest) bends with the bone below it.
  const humanoidPose =
    sanitizedPose.humanoid &&
    foldMissingTorsoRotations(
      sanitizedPose.humanoid,
      torsoFoldsOf(vrm.humanoid),
    );
  if (humanoidPose && Object.keys(humanoidPose).length > 0) {
    const mergedPose = cloneVRMPose(vrm.humanoid.getNormalizedPose());

    for (const boneName of Object.keys(humanoidPose).filter(
      isVRMHumanBoneName,
    ) as VRMHumanBoneName[]) {
      const transform = humanoidPose[boneName];
      if (!transform || !vrm.humanoid.getNormalizedBoneNode(boneName)) {
        result.skippedHumanoidBones.push(boneName);
        continue;
      }

      mergedPose[boneName] = cloneVRMPoseTransform(transform);
      result.appliedHumanoidBones.push(boneName);
    }

    if (result.appliedHumanoidBones.length > 0) {
      vrm.humanoid.setNormalizedPose(mergedPose);
    }
  }

  const expressionManager = vrm.expressionManager;
  const expressions = sanitizedPose.expressions;
  if (expressions) {
    for (const [expressionName, weight] of Object.entries(expressions)) {
      if (!expressionManager?.getExpression(expressionName)) {
        result.skippedExpressions.push(expressionName);
        continue;
      }

      expressionManager.setValue(expressionName, weight);
      result.appliedExpressions.push(expressionName);
    }

    if (result.appliedExpressions.length > 0) {
      expressionManager?.update();
    }
  }

  return result;
}

export function getAnimaPoseHumanoidBoneNames(
  pose: AnimaPose,
): VRMHumanBoneName[] {
  return Object.keys(pose.humanoid ?? {}).filter(
    isVRMHumanBoneName,
  ) as VRMHumanBoneName[];
}

export function getAnimaPoseExpressionNames(pose: AnimaPose): string[] {
  return Object.keys(pose.expressions ?? {});
}

export function cloneAnimaPose(pose: AnimaPose): AnimaPose {
  return {
    schema: ANIMA_POSE_SCHEMA,
    id: pose.id,
    name: pose.name,
    ...(pose.parent ? { parent: cloneAnimaPoseParent(pose.parent) } : {}),
    ...(pose.humanoid ? { humanoid: cloneVRMPose(pose.humanoid) } : {}),
    ...(pose.expressions ? { expressions: { ...pose.expressions } } : {}),
  };
}

export function cloneVRMPose(pose: VRMPose): VRMPose {
  const clonedPose: VRMPose = {};
  for (const boneName of Object.keys(pose).filter(
    isVRMHumanBoneName,
  ) as VRMHumanBoneName[]) {
    const transform = pose[boneName];
    if (transform) {
      clonedPose[boneName] = cloneVRMPoseTransform(transform);
    }
  }
  return clonedPose;
}

export function cloneVRMPoseTransform(
  transform: VRMPoseTransform,
): VRMPoseTransform {
  return {
    ...(transform.position ? { position: [...transform.position] } : {}),
    ...(transform.rotation ? { rotation: [...transform.rotation] } : {}),
  };
}

export function isVRMHumanBoneName(value: string): value is VRMHumanBoneName {
  return KNOWN_HUMAN_BONE_NAMES.has(value);
}

function resolveAnimaPoseInternal(
  pose: AnimaPose,
  resolveById: ResolveAnimaPoseById,
  stack: string[],
): ResolvedAnimaPose {
  if (stack.includes(pose.id)) {
    throw new Error(
      `AnimaPose parent cycle detected: ${[...stack, pose.id].join(" -> ")}`,
    );
  }

  const parentRef = pose.parent?.ref;
  if (!parentRef) {
    return {
      schema: ANIMA_POSE_SCHEMA,
      id: pose.id,
      name: pose.name,
      ...(pose.humanoid ? { humanoid: cloneVRMPose(pose.humanoid) } : {}),
      ...(pose.expressions ? { expressions: { ...pose.expressions } } : {}),
    };
  }

  const parentPose = resolveById(parentRef);
  if (!parentPose) {
    throw new Error(
      `AnimaPose "${pose.id}" references missing parent pose "${parentRef}"`,
    );
  }

  const resolvedParent = resolveAnimaPoseInternal(
    parseAnimaPose(parentPose),
    resolveById,
    [...stack, pose.id],
  );
  const inheritedTargets = {
    ...(pose.parent?.inheritHumanoid === false
      ? {}
      : resolvedParent.humanoid
        ? { humanoid: resolvedParent.humanoid }
        : {}),
    ...(pose.parent?.inheritExpressions === true && resolvedParent.expressions
      ? { expressions: resolvedParent.expressions }
      : {}),
  };

  return mergeResolvedAnimaPose(inheritedTargets, pose);
}

function mergePoseTargets(
  parent: Pick<ResolvedAnimaPose, "humanoid" | "expressions">,
  child: Pick<AnimaPose, "humanoid" | "expressions">,
): Pick<ResolvedAnimaPose, "humanoid" | "expressions"> {
  const humanoid = mergeVRMPoseTargets(parent.humanoid, child.humanoid);
  const expressions = mergeExpressionTargets(
    parent.expressions,
    child.expressions,
  );

  return {
    ...(humanoid ? { humanoid } : {}),
    ...(expressions ? { expressions } : {}),
  };
}

function mergeVRMPoseTargets(
  parent: VRMPose | undefined,
  child: VRMPose | undefined,
): VRMPose | undefined {
  if (!parent && !child) return undefined;

  const merged: VRMPose = parent ? cloneVRMPose(parent) : {};
  for (const boneName of Object.keys(child ?? {}).filter(
    isVRMHumanBoneName,
  ) as VRMHumanBoneName[]) {
    const childTransform = child?.[boneName];
    if (!childTransform) continue;

    merged[boneName] = {
      ...(merged[boneName] ? cloneVRMPoseTransform(merged[boneName]) : {}),
      ...cloneVRMPoseTransform(childTransform),
    };
  }

  return Object.keys(merged).length > 0 ? merged : undefined;
}

function mergeExpressionTargets(
  parent: Record<string, number> | undefined,
  child: Record<string, number> | undefined,
): Record<string, number> | undefined {
  const merged = {
    ...(parent ?? {}),
    ...(child ?? {}),
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

function cloneAnimaPoseParent(parent: AnimaPoseParent): AnimaPoseParent {
  return {
    ref: parent.ref,
    ...(parent.inheritHumanoid === false ? { inheritHumanoid: false } : {}),
    ...(parent.inheritExpressions === true ? { inheritExpressions: true } : {}),
  };
}

function sanitizeAnimaPoseParent(value: unknown): AnimaPoseParent | null {
  if (!isRecord(value)) return null;

  const ref = sanitizeRequiredString(value.ref);
  if (!ref) return null;
  if (
    value.inheritHumanoid !== undefined &&
    typeof value.inheritHumanoid !== "boolean"
  ) {
    return null;
  }
  if (
    value.inheritExpressions !== undefined &&
    typeof value.inheritExpressions !== "boolean"
  ) {
    return null;
  }

  return {
    ref,
    ...(value.inheritHumanoid === false ? { inheritHumanoid: false } : {}),
    ...(value.inheritExpressions === true ? { inheritExpressions: true } : {}),
  };
}

function sanitizeHumanoidPose(
  value: unknown,
  rotationOrder: AnimaPoseRotationOrder,
): VRMPose | null {
  if (!isRecord(value)) return null;

  const pose: VRMPose = {};
  for (const [boneName, rawTransform] of Object.entries(value)) {
    if (!isVRMHumanBoneName(boneName)) return null;
    if (!isRecord(rawTransform)) return null;

    const transform = sanitizePoseTransform(rawTransform, rotationOrder);
    if (!transform) return null;
    pose[boneName] = transform;
  }

  return pose;
}

function sanitizePoseTransform(
  value: Record<string, unknown>,
  rotationOrder: AnimaPoseRotationOrder,
): VRMPoseTransform | null {
  const position =
    value.position === undefined
      ? undefined
      : sanitizeFiniteTuple(value.position, 3);
  if (value.position !== undefined && !position) return null;

  if (
    value.rotation !== undefined &&
    value.rotationEulerDegrees !== undefined
  ) {
    return null;
  }

  const rotation =
    value.rotation === undefined
      ? undefined
      : sanitizeQuaternionTuple(value.rotation);
  if (value.rotation !== undefined && !rotation) return null;

  const rotationEulerDegrees =
    value.rotationEulerDegrees === undefined
      ? undefined
      : sanitizeFiniteTuple(value.rotationEulerDegrees, 3);
  if (value.rotationEulerDegrees !== undefined && !rotationEulerDegrees) {
    return null;
  }

  const transformBase: Pick<AnimaPoseAuthoringTransform, "position"> = {
    ...(position ? { position } : {}),
  };

  if (rotation) {
    return canonicalizeAuthoringTransform(
      {
        ...transformBase,
        rotation,
      },
      rotationOrder,
    );
  }

  if (rotationEulerDegrees) {
    return canonicalizeAuthoringTransform(
      {
        ...transformBase,
        rotationEulerDegrees,
      },
      rotationOrder,
    );
  }

  return canonicalizeAuthoringTransform(transformBase, rotationOrder);
}

function canonicalizeAuthoringTransform(
  transform: AnimaPoseAuthoringTransform,
  rotationOrder: AnimaPoseRotationOrder,
): VRMPoseTransform {
  return {
    ...(transform.position ? { position: transform.position } : {}),
    ...(transform.rotation
      ? { rotation: transform.rotation }
      : transform.rotationEulerDegrees
        ? {
            rotation: quaternionFromEulerDegrees(
              transform.rotationEulerDegrees,
              rotationOrder,
            ),
          }
        : {}),
  };
}

function sanitizeRotationOrder(value: unknown): AnimaPoseRotationOrder | null {
  if (value === undefined || value === ANIMA_POSE_ROTATION_ORDER) {
    return ANIMA_POSE_ROTATION_ORDER;
  }
  return null;
}

function sanitizeExpressionWeights(
  value: unknown,
): Record<string, number> | null {
  if (!isRecord(value)) return null;

  const expressions: Record<string, number> = {};
  for (const [name, rawWeight] of Object.entries(value)) {
    if (
      !name.trim() ||
      typeof rawWeight !== "number" ||
      !Number.isFinite(rawWeight)
    ) {
      return null;
    }
    expressions[name] = clampUnitInterval(rawWeight);
  }

  return expressions;
}

function sanitizeQuaternionTuple(
  value: unknown,
): AnimaPoseQuaternionTuple | null {
  const tuple = sanitizeFiniteTuple(value, 4);
  if (!tuple) return null;

  const length = Math.hypot(tuple[0], tuple[1], tuple[2], tuple[3]);
  if (length <= EPSILON) return null;

  return tuple.map((entry) => entry / length) as AnimaPoseQuaternionTuple;
}

function quaternionFromEulerDegrees(
  value: AnimaPoseEulerDegreesTuple,
  rotationOrder: AnimaPoseRotationOrder,
): AnimaPoseQuaternionTuple {
  const quaternion = new Quaternion()
    .setFromEuler(
      new Euler(
        MathUtils.degToRad(value[0]),
        MathUtils.degToRad(value[1]),
        MathUtils.degToRad(value[2]),
        rotationOrder,
      ),
    )
    .normalize();

  return [
    roundQuaternionComponent(quaternion.x),
    roundQuaternionComponent(quaternion.y),
    roundQuaternionComponent(quaternion.z),
    roundQuaternionComponent(quaternion.w),
  ];
}

function roundQuaternionComponent(value: number): number {
  const rounded = Number(value.toFixed(8));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function sanitizeFiniteTuple(
  value: unknown,
  length: 3,
): [number, number, number] | null;
function sanitizeFiniteTuple(
  value: unknown,
  length: 4,
): [number, number, number, number] | null;
function sanitizeFiniteTuple(value: unknown, length: 3 | 4) {
  if (!Array.isArray(value) || value.length !== length) return null;
  if (
    !value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  ) {
    return null;
  }
  return length === 3
    ? (value as [number, number, number])
    : (value as [number, number, number, number]);
}

function sanitizeRequiredString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function clampUnitInterval(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
