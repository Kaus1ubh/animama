import {
  VRMExpressionPresetName,
  VRMLookAtExpressionApplier,
  VRMRequiredHumanBoneName,
} from "@pixiv/three-vrm";

import { ARKIT_BLENDSHAPES } from "../arkit";
import { arkitMixOf } from "../arkitFaceExpressions";
import type { Avatar } from "../Avatar";
import type {
  AvatarFacePartRole,
  AvatarFacePartSource,
} from "../vfx/faceParts";
import { mergeAvatarIssues, type AvatarIssue } from "./issues";

/** A face part as Diagnostics shows it: how it was found, never its names. */
export type AvatarDiagnosticsFacePart = {
  role: AvatarFacePartRole;
  source: AvatarFacePartSource;
  bindingCount: number;
  confidence: number;
};

/** Where a standard expression the Avatar plays comes from. */
export type AvatarExpressionSource = "model" | "arkit";

/**
 * Facts read from a loaded Avatar. Names are limited to standard vocabularies
 * (VRM presets and bones, ARKit shapes, VRoid `Fcl_` parts); anything else is
 * counted, because custom names are author-specific.
 */
export type AvatarLiveDiagnostics = {
  face: {
    /** False when part detection failed and effects fall back to names. */
    detected: boolean;
    parts: AvatarDiagnosticsFacePart[];
    landmarks: "ready" | "unavailable";
    textureAnchors: "ready" | "unavailable";
  };
  expressions: {
    presets: { name: string; source: AvatarExpressionSource }[];
    missingPresets: string[];
    arkit: { resolved: number; total: number; playsFaces: boolean };
    /** Names emotions or clips asked for that the Avatar cannot play. */
    unresolved: { names: string[]; otherCount: number };
  };
  motion: {
    humanoidBones: number;
    missingRequiredBones: string[];
    springJoints: number;
    springColliders: number;
    /** The per-Avatar wind setting; Automatic until Avatar settings exist. */
    wind: "automatic";
    /** Rest-pose check; not measured yet. */
    restPose: null;
  };
  issues: AvatarIssue[];
};

const PRESET_NAMES: readonly string[] = Object.values(VRMExpressionPresetName);
/** Presets only a model that looks with expressions (not bones) needs. */
const LOOK_PRESETS = new Set<string>([
  VRMExpressionPresetName.LookUp,
  VRMExpressionPresetName.LookDown,
  VRMExpressionPresetName.LookLeft,
  VRMExpressionPresetName.LookRight,
]);
const ARKIT_NAMES = new Set<string>(ARKIT_BLENDSHAPES);

/** True for names from a standard vocabulary, which reports may list. */
export function isStandardExpressionName(name: string): boolean {
  return (
    PRESET_NAMES.includes(name) || ARKIT_NAMES.has(name) || /^Fcl_/.test(name)
  );
}

function collectFace(avatar: Avatar): AvatarLiveDiagnostics["face"] {
  const map = avatar.facePartMap;
  return {
    detected: map !== null,
    parts: map
      ? Object.values(map.parts).map((part) => ({
          role: part.role,
          source: part.source,
          bindingCount: part.bindings.length,
          confidence: part.confidence,
        }))
      : [],
    landmarks: avatar.getFaceLandmarksSnapshot()?.status ?? "unavailable",
    textureAnchors:
      avatar.getFaceTextureAnchorsSnapshot()?.status ?? "unavailable",
  };
}

function collectExpressions(
  avatar: Avatar,
): AvatarLiveDiagnostics["expressions"] {
  const manager = avatar.vrm?.expressionManager ?? null;
  const looksWithExpressions =
    avatar.vrm?.lookAt?.applier instanceof VRMLookAtExpressionApplier;
  const presets: AvatarLiveDiagnostics["expressions"]["presets"] = [];
  const missingPresets: string[] = [];
  for (const name of PRESET_NAMES) {
    const expression = manager?.getExpression(name) ?? null;
    if (expression) {
      presets.push({
        name,
        source: arkitMixOf(expression) ? "arkit" : "model",
      });
    } else if (looksWithExpressions || !LOOK_PRESETS.has(name)) {
      // A model that looks with its eye bones does not need look expressions.
      missingPresets.push(name);
    }
  }
  const unresolved =
    avatar.expressionController?.unresolvedExpressionNames ?? [];
  const arkitFace = avatar.arkitFace;
  return {
    presets,
    missingPresets,
    arkit: {
      resolved: arkitFace?.capability.resolved.size ?? 0,
      total: ARKIT_BLENDSHAPES.length,
      playsFaces: arkitFace?.playsFacesWithArkit ?? false,
    },
    unresolved: {
      names: unresolved.filter(isStandardExpressionName),
      otherCount: unresolved.filter((name) => !isStandardExpressionName(name))
        .length,
    },
  };
}

function collectMotion(avatar: Avatar): AvatarLiveDiagnostics["motion"] {
  const humanoid = avatar.vrm?.humanoid ?? null;
  const springs = avatar.vrm?.springBoneManager ?? null;
  return {
    humanoidBones: humanoid
      ? Object.values(humanoid.humanBones).filter((bone) => bone?.node).length
      : 0,
    missingRequiredBones: Object.values(VRMRequiredHumanBoneName).filter(
      (name) => !humanoid?.getRawBoneNode(name),
    ),
    springJoints: springs?.joints.size ?? 0,
    springColliders: springs?.colliders.length ?? 0,
    wind: "automatic",
    restPose: null,
  };
}

/**
 * Collect what Diagnostics shows for a loaded Avatar: face, expressions,
 * motion and every warning its face parts, landmarks, texture anchors,
 * springs and effects recorded, each listed once.
 */
export function collectAvatarLiveDiagnostics(
  avatar: Avatar,
): AvatarLiveDiagnostics {
  const issues = mergeAvatarIssues(
    avatar.loadIssues,
    avatar.facePartMap?.issues,
    avatar.getFaceLandmarksSnapshot()?.issues,
    avatar.getFaceTextureAnchorsSnapshot()?.issues,
    avatar.springBonePhysicsController?.getSnapshot().issues,
    avatar.vfxController?.getSnapshot().issues,
  );
  return {
    face: collectFace(avatar),
    expressions: collectExpressions(avatar),
    motion: collectMotion(avatar),
    issues,
  };
}
