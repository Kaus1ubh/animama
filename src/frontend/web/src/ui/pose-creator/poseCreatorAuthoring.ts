import {
  VRMHumanBoneList,
  VRMHumanBoneParentMap,
  type VRMHumanBoneName,
  type VRMPose,
  type VRMPoseTransform,
} from "@pixiv/three-vrm";
import { Euler, MathUtils, Quaternion } from "three";

import type { Avatar } from "@/lib/avatar";
import {
  ANIMA_POSE_SCHEMA,
  AVATAR_POSE_IDS,
  cloneVRMPose,
  getAvatarPose,
  getAnimaPoseHumanoidBoneNames,
  getResolvedAvatarPose,
  mergeResolvedAnimaPose,
  parseAnimaPose,
  resolveAnimaPose,
  type AnimaPose,
} from "@/lib/avatar";
import { readAvatarExpressionValue } from "@/lib/avatar/expressionUtils";
import { POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID } from "@/stores/pose-creator-store";
import type {
  PoseCreatorBasePose,
  PoseCreatorBoneDraft,
  PoseCreatorBoneDrafts,
  PoseCreatorExpressionDrafts,
  PoseCreatorQuaternionTuple,
  PoseCreatorRotationDegrees,
  PoseCreatorVector3Tuple,
} from "@/stores/pose-creator-store";

export type PoseCreatorBoneRow = {
  boneName: VRMHumanBoneName;
  available: boolean;
  rawNodeName: string | null;
  normalizedNodeName: string | null;
  currentEulerDegrees: PoseCreatorRotationDegrees | null;
  draft: PoseCreatorBoneDraft | null;
};

export type PoseCreatorBoneTreeNode = PoseCreatorBoneRow & {
  children: PoseCreatorBoneTreeNode[];
  depth: number;
};

const EULER_ORDER = "XYZ" as const;
const ZERO_ROTATION_DEGREES: PoseCreatorRotationDegrees = {
  x: 0,
  y: 0,
  z: 0,
};
const QUATERNION_ANGULAR_EPSILON_RAD = 0.0001;

export function cloneRotationDegrees(
  value: PoseCreatorRotationDegrees,
): PoseCreatorRotationDegrees {
  return {
    x: value.x,
    y: value.y,
    z: value.z,
  };
}

export function createZeroRotationDegrees(): PoseCreatorRotationDegrees {
  return cloneRotationDegrees(ZERO_ROTATION_DEGREES);
}

export function clampRotationDegrees(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return MathUtils.clamp(value, -180, 180);
}

export function clampExpressionWeight(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return MathUtils.clamp(value, 0, 1);
}

export function formatDegrees(value: number): string {
  return `${value.toFixed(1)} deg`;
}

export function formatExpressionWeight(value: number): string {
  return clampExpressionWeight(value).toFixed(2);
}

/** Allocate the next numeric branch name while preserving the source's base. */
export function createUniquePoseCreatorBranchName(
  sourceName: string,
  existingNames: readonly string[],
): string {
  const normalizedSourceName = sourceName.trim() || "New Pose";
  const numberedSource = /^(.+?)\s*\((\d+)\)$/.exec(normalizedSourceName);
  const baseName = numberedSource?.[1] ?? normalizedSourceName;
  let suffix = numberedSource ? Number(numberedSource[2]) + 1 : 1;
  const usedNames = new Set(
    existingNames.map((name) => name.trim().toLocaleLowerCase()),
  );

  while (usedNames.has(`${baseName} (${suffix})`.toLocaleLowerCase())) {
    suffix += 1;
  }
  return `${baseName} (${suffix})`;
}

export function readPoseCreatorBoneRows(
  avatar: Avatar | null,
  boneDrafts: PoseCreatorBoneDrafts,
): PoseCreatorBoneRow[] {
  const humanoid = avatar?.vrm?.humanoid;

  return VRMHumanBoneList.map((boneName) => {
    const rawNode = humanoid?.getRawBoneNode(boneName) ?? null;
    const normalizedNode = humanoid?.getNormalizedBoneNode(boneName) ?? null;
    return {
      boneName,
      available: Boolean(normalizedNode),
      rawNodeName: rawNode?.name || null,
      normalizedNodeName: normalizedNode?.name || null,
      currentEulerDegrees: normalizedNode
        ? quaternionToEulerDegrees(normalizedNode.quaternion)
        : null,
      draft: boneDrafts[boneName] ?? null,
    };
  });
}

export function buildPoseCreatorBoneTree(
  rows: PoseCreatorBoneRow[],
): PoseCreatorBoneTreeNode[] {
  const rowByName = new Map<VRMHumanBoneName, PoseCreatorBoneRow>();
  const childrenByParent = new Map<
    VRMHumanBoneName | null,
    VRMHumanBoneName[]
  >();

  for (const row of rows) {
    rowByName.set(row.boneName, row);
  }

  for (const row of rows) {
    const configuredParent = VRMHumanBoneParentMap[row.boneName] ?? null;
    const parent =
      configuredParent && rowByName.has(configuredParent)
        ? configuredParent
        : null;
    const siblings = childrenByParent.get(parent) ?? [];
    siblings.push(row.boneName);
    childrenByParent.set(parent, siblings);
  }

  const buildNode = (
    boneName: VRMHumanBoneName,
    depth: number,
  ): PoseCreatorBoneTreeNode => {
    const row = rowByName.get(boneName);
    if (!row) {
      throw new Error(`Missing pose creator bone row for ${boneName}`);
    }
    return {
      ...row,
      depth,
      children: (childrenByParent.get(boneName) ?? []).map((childBoneName) =>
        buildNode(childBoneName, depth + 1),
      ),
    };
  };

  return (childrenByParent.get(null) ?? []).map((boneName) =>
    buildNode(boneName, 0),
  );
}

export function getPoseCreatorBoneAncestorNames(
  boneName: string,
): VRMHumanBoneName[] {
  if (!isPoseCreatorHumanBoneName(boneName)) return [];

  const ancestors: VRMHumanBoneName[] = [];
  const visited = new Set<VRMHumanBoneName>();
  let parent = VRMHumanBoneParentMap[boneName] ?? null;

  while (parent && !visited.has(parent)) {
    ancestors.push(parent);
    visited.add(parent);
    parent = VRMHumanBoneParentMap[parent] ?? null;
  }

  return ancestors;
}

export function getPoseCreatorMirrorBoneName(
  boneName: string,
): VRMHumanBoneName | null {
  if (boneName.startsWith("left")) {
    return getExistingPoseCreatorBoneName(`right${boneName.slice(4)}`);
  }

  if (boneName.startsWith("right")) {
    return getExistingPoseCreatorBoneName(`left${boneName.slice(5)}`);
  }

  return null;
}

export function mirrorPoseCreatorRotationDegrees(
  rotationDegrees: PoseCreatorRotationDegrees,
): PoseCreatorRotationDegrees {
  return {
    x: clampRotationDegrees(rotationDegrees.x),
    y: clampRotationDegrees(-rotationDegrees.y),
    z: clampRotationDegrees(-rotationDegrees.z),
  };
}

export function applyPoseCreatorBasePose(
  avatar: Avatar | null,
  basePose: PoseCreatorBasePose,
): boolean {
  const vrm = avatar?.vrm;
  if (!avatar || !vrm) return false;

  vrm.humanoid.resetNormalizedPose();
  for (const poseId of AVATAR_POSE_IDS) {
    avatar.forgetPose(poseId);
  }

  if (basePose !== POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID) {
    if (!AVATAR_POSE_IDS.includes(basePose)) {
      vrm.update(0);
      return false;
    }
    avatar.applyPose(basePose);
  }

  vrm.update(0);
  return true;
}

export function captureBoneBaseQuaternion(
  avatar: Avatar | null,
  boneName: string,
): PoseCreatorQuaternionTuple | null {
  const normalizedNode = getPoseCreatorNormalizedBoneNode(avatar, boneName);
  if (!normalizedNode) return null;
  return quaternionToTuple(normalizedNode.quaternion);
}

/** Reads the selected normalized bone using the Pose Creator's canonical XYZ Euler basis. */
export function readPoseCreatorBoneRotationDegrees(
  avatar: Avatar | null,
  boneName: string,
): PoseCreatorRotationDegrees | null {
  const normalizedNode = getPoseCreatorNormalizedBoneNode(avatar, boneName);
  return normalizedNode
    ? quaternionToEulerDegrees(normalizedNode.quaternion)
    : null;
}

export function applyBoneDraft(
  avatar: Avatar | null,
  boneName: string,
  draft: PoseCreatorBoneDraft,
): boolean {
  const normalizedNode = getPoseCreatorNormalizedBoneNode(avatar, boneName);
  if (!normalizedNode) return false;
  normalizedNode.quaternion.copy(
    quaternionFromRotationDegrees(draft.rotationDegrees),
  );
  avatar?.vrm?.update(0);
  return true;
}

export function restoreBoneBaseQuaternion(
  avatar: Avatar | null,
  boneName: string,
  draft: PoseCreatorBoneDraft,
): boolean {
  const normalizedNode = getPoseCreatorNormalizedBoneNode(avatar, boneName);
  if (!normalizedNode) return false;
  normalizedNode.quaternion.copy(quaternionFromTuple(draft.baseQuaternion));
  avatar?.vrm?.update(0);
  return true;
}

export function createBoneDraft(
  avatar: Avatar | null,
  boneName: string,
  rotationDegrees: PoseCreatorRotationDegrees,
  previousDraft?: PoseCreatorBoneDraft | null,
  baseQuaternionOverride?: PoseCreatorQuaternionTuple | null,
): PoseCreatorBoneDraft | null {
  const baseQuaternion =
    previousDraft?.baseQuaternion ??
    baseQuaternionOverride ??
    captureBoneBaseQuaternion(avatar, boneName);
  if (!baseQuaternion) return null;
  return {
    baseQuaternion,
    rotationDegrees: cloneRotationDegrees(rotationDegrees),
    ...(previousDraft?.position
      ? { position: [...previousDraft.position] as PoseCreatorVector3Tuple }
      : {}),
  };
}

export function getBoneDraftBaseDegrees(
  draft: PoseCreatorBoneDraft,
): PoseCreatorRotationDegrees {
  return quaternionToEulerDegrees(quaternionFromTuple(draft.baseQuaternion));
}

export function isBoneDraftAtBase(draft: PoseCreatorBoneDraft): boolean {
  if (draft.position) return false;
  const baseQuaternion = quaternionFromTuple(draft.baseQuaternion);
  const rotationQuaternion = quaternionFromRotationDegrees(
    draft.rotationDegrees,
  );
  return areQuaternionsWithinAngularEpsilon(baseQuaternion, rotationQuaternion);
}

export type PoseCreatorPoseExportMode = "inherited" | "baked";

type BuildPoseCreatorAnimaPoseOptions = {
  id?: string | null;
  name?: string | null;
  parentPose?: PoseCreatorBasePose | null;
  mode?: PoseCreatorPoseExportMode;
};

export function buildPoseCreatorAnimaPose(
  boneDrafts: PoseCreatorBoneDrafts,
  expressionDrafts: PoseCreatorExpressionDrafts,
  options: BuildPoseCreatorAnimaPoseOptions = {},
): AnimaPose | null {
  return buildPoseCreatorInheritedAnimaPose(
    boneDrafts,
    expressionDrafts,
    options,
  );
}

export function buildPoseCreatorInheritedAnimaPose(
  boneDrafts: PoseCreatorBoneDrafts,
  expressionDrafts: PoseCreatorExpressionDrafts,
  options: BuildPoseCreatorAnimaPoseOptions = {},
): AnimaPose | null {
  const parentRef = getPoseCreatorParentRef(options.parentPose);
  const humanoid: VRMPose = {};
  const parentHumanoid = parentRef
    ? getResolvedAvatarPose(parentRef).humanoid
    : undefined;

  for (const [boneName, draft] of Object.entries(boneDrafts)) {
    if (!isPoseCreatorHumanBoneName(boneName)) continue;
    const transform = buildPoseCreatorDraftTransform(
      boneName,
      draft,
      parentHumanoid,
    );
    if (transform) {
      humanoid[boneName as VRMHumanBoneName] = transform;
    }
  }

  const expressions: Record<string, number> = {};
  for (const [expressionName, draft] of Object.entries(expressionDrafts)) {
    expressions[expressionName] = clampExpressionWeight(draft.value);
  }

  if (
    Object.keys(humanoid).length === 0 &&
    Object.keys(expressions).length === 0 &&
    !parentRef
  ) {
    return null;
  }

  return parseAnimaPose({
    schema: ANIMA_POSE_SCHEMA,
    id: options.id?.trim() || "pose_creator_draft",
    name: options.name?.trim() || "Pose Creator Draft",
    ...(parentRef ? { parent: { ref: parentRef } } : {}),
    ...(Object.keys(humanoid).length > 0 ? { humanoid } : {}),
    ...(Object.keys(expressions).length > 0 ? { expressions } : {}),
  });
}

export function buildPoseCreatorBakedAnimaPose(
  boneDrafts: PoseCreatorBoneDrafts,
  expressionDrafts: PoseCreatorExpressionDrafts,
  options: BuildPoseCreatorAnimaPoseOptions = {},
): AnimaPose | null {
  const inheritedPose = buildPoseCreatorInheritedAnimaPose(
    boneDrafts,
    expressionDrafts,
    options,
  );
  if (!inheritedPose) return null;

  const parentRef = inheritedPose.parent?.ref ?? null;
  if (!parentRef) {
    return parseAnimaPose({
      ...inheritedPose,
      parent: undefined,
    });
  }

  const parentPose = getResolvedAvatarPose(parentRef);
  return parseAnimaPose(
    mergeResolvedAnimaPose(
      parentPose.humanoid
        ? { humanoid: cloneVRMPose(parentPose.humanoid) }
        : {},
      inheritedPose,
    ),
  );
}

/** Resolve a saved editable pose into a parent-free authoring snapshot. */
export function bakePoseCreatorAnimaPose(pose: AnimaPose): AnimaPose {
  const parsedPose = parseAnimaPose(pose);
  return parseAnimaPose(
    resolveAnimaPose(parsedPose, (parentId) => {
      try {
        return getAvatarPose(parentId);
      } catch {
        return null;
      }
    }),
  );
}

export function buildPoseCreatorAnimaPoseForExport(
  boneDrafts: PoseCreatorBoneDrafts,
  expressionDrafts: PoseCreatorExpressionDrafts,
  options: BuildPoseCreatorAnimaPoseOptions = {},
): AnimaPose | null {
  return options.mode === "baked"
    ? buildPoseCreatorBakedAnimaPose(boneDrafts, expressionDrafts, options)
    : buildPoseCreatorInheritedAnimaPose(boneDrafts, expressionDrafts, options);
}

export function formatPoseCreatorAnimaPoseJson(pose: AnimaPose): string {
  return JSON.stringify(pose, null, 2);
}

function getPoseCreatorParentRef(
  parentPose: PoseCreatorBasePose | null | undefined,
): string | null {
  if (!parentPose || parentPose === POSE_CREATOR_VRM_T_POSE_BASE_POSE_ID) {
    return null;
  }
  return parentPose;
}

function buildPoseCreatorDraftTransform(
  boneName: VRMHumanBoneName,
  draft: PoseCreatorBoneDraft,
  parentHumanoid: VRMPose | undefined,
): VRMPoseTransform | null {
  const transform: VRMPoseTransform = {};
  if (draft.position) {
    transform.position = [...draft.position];
  }

  const rotationQuaternion = quaternionFromRotationDegrees(
    draft.rotationDegrees,
  );
  const parentRotation = parentHumanoid?.[boneName]?.rotation;
  const shouldExportRotation = parentRotation
    ? !areQuaternionsWithinAngularEpsilon(
        rotationQuaternion,
        quaternionFromTuple(parentRotation),
      )
    : true;

  if (shouldExportRotation) {
    transform.rotation = quaternionToTuple(rotationQuaternion);
  }

  return transform.position || transform.rotation ? transform : null;
}

export function applyPoseCreatorDraftsToAvatar(
  avatar: Avatar | null,
  basePose: PoseCreatorBasePose,
  boneDrafts: PoseCreatorBoneDrafts,
  expressionDrafts: PoseCreatorExpressionDrafts,
): boolean {
  if (!avatar) return false;
  applyPoseCreatorBasePose(avatar, basePose);
  avatar.clearAllExpressionOverrides();

  for (const [boneName, draft] of Object.entries(boneDrafts)) {
    applyBoneDraft(avatar, boneName, draft);
  }

  for (const [expressionName, draft] of Object.entries(expressionDrafts)) {
    avatar.setExpression(expressionName, clampExpressionWeight(draft.value));
  }

  avatar.vrm?.update(0);
  return true;
}

export function createPoseCreatorDraftsFromAnimaPose(
  avatar: Avatar | null,
  pose: AnimaPose,
  basePose: PoseCreatorBasePose,
): {
  boneDrafts: PoseCreatorBoneDrafts;
  expressionDrafts: PoseCreatorExpressionDrafts;
} {
  const parsedPose = parseAnimaPose(pose);
  applyPoseCreatorBasePose(avatar, basePose);

  const boneDrafts: PoseCreatorBoneDrafts = {};
  for (const boneName of getAnimaPoseHumanoidBoneNames(parsedPose)) {
    const transform = parsedPose.humanoid?.[boneName];
    if (!transform?.rotation && !transform?.position) continue;
    const baseQuaternion = captureBoneBaseQuaternion(avatar, boneName);
    if (!baseQuaternion) continue;

    boneDrafts[boneName] = {
      baseQuaternion,
      rotationDegrees: transform.rotation
        ? quaternionToEulerDegrees(quaternionFromTuple(transform.rotation))
        : quaternionToEulerDegrees(quaternionFromTuple(baseQuaternion)),
      ...(transform.position
        ? {
            position: [...transform.position] as PoseCreatorVector3Tuple,
          }
        : {}),
    };
  }

  const expressionDrafts: PoseCreatorExpressionDrafts = {};
  for (const [expressionName, weight] of Object.entries(
    parsedPose.expressions ?? {},
  )) {
    expressionDrafts[expressionName] = {
      baseValue: readAvatarExpressionValue(avatar, expressionName),
      value: clampExpressionWeight(weight),
    };
  }

  return {
    boneDrafts,
    expressionDrafts,
  };
}

export function replacePoseCreatorDraftWithAnimaPose(
  avatar: Avatar | null,
  pose: AnimaPose,
  basePose: PoseCreatorBasePose,
): {
  boneDrafts: PoseCreatorBoneDrafts;
  expressionDrafts: PoseCreatorExpressionDrafts;
} {
  const drafts = createPoseCreatorDraftsFromAnimaPose(avatar, pose, basePose);
  applyPoseCreatorDraftsToAvatar(
    avatar,
    basePose,
    drafts.boneDrafts,
    drafts.expressionDrafts,
  );
  return drafts;
}

/** Resolves only standard normalized humanoid bones accepted by pose assets. */
export function getPoseCreatorNormalizedBoneNode(
  avatar: Avatar | null,
  boneName: string,
) {
  if (!isPoseCreatorHumanBoneName(boneName)) return null;
  return avatar?.vrm?.humanoid.getNormalizedBoneNode(boneName) ?? null;
}

function getExistingPoseCreatorBoneName(
  value: string,
): VRMHumanBoneName | null {
  return isPoseCreatorHumanBoneName(value) ? value : null;
}

function isPoseCreatorHumanBoneName(value: string): value is VRMHumanBoneName {
  return (VRMHumanBoneList as string[]).includes(value);
}

function quaternionFromTuple(value: PoseCreatorQuaternionTuple): Quaternion {
  return new Quaternion(value[0], value[1], value[2], value[3]).normalize();
}

function quaternionToTuple(quaternion: Quaternion): PoseCreatorQuaternionTuple {
  return [
    roundQuaternionComponent(quaternion.x),
    roundQuaternionComponent(quaternion.y),
    roundQuaternionComponent(quaternion.z),
    roundQuaternionComponent(quaternion.w),
  ];
}

function roundQuaternionComponent(value: number): number {
  return Number(value.toFixed(8));
}

function areQuaternionsWithinAngularEpsilon(
  left: Quaternion,
  right: Quaternion,
): boolean {
  const dot = Math.min(1, Math.abs(left.dot(right)));
  const angle = 2 * Math.acos(dot);
  return angle <= QUATERNION_ANGULAR_EPSILON_RAD;
}

function quaternionFromRotationDegrees(
  rotationDegrees: PoseCreatorRotationDegrees,
): Quaternion {
  return new Quaternion()
    .setFromEuler(
      new Euler(
        MathUtils.degToRad(rotationDegrees.x),
        MathUtils.degToRad(rotationDegrees.y),
        MathUtils.degToRad(rotationDegrees.z),
        EULER_ORDER,
      ),
    )
    .normalize();
}

function quaternionToEulerDegrees(
  quaternion: Quaternion,
): PoseCreatorRotationDegrees {
  const euler = new Euler().setFromQuaternion(quaternion, EULER_ORDER);
  return {
    x: MathUtils.radToDeg(euler.x),
    y: MathUtils.radToDeg(euler.y),
    z: MathUtils.radToDeg(euler.z),
  };
}
