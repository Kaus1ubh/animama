import {
  type VRMExpression,
  VRMExpressionPresetName,
  VRMLookAtExpressionApplier,
  VRMRequiredHumanBoneName,
} from "@pixiv/three-vrm";

import { ARKIT_BLENDSHAPES } from "../arkit";
import type { FaceRegion } from "../arkitFaceCompositions";
import {
  arkitMixOf,
  isAnimamaFaceExpression,
  type FaceRegionSource,
} from "../arkitFaceExpressions";
import type { Avatar } from "../Avatar";
import type { AvatarMaterialMode, AvatarSpringMode } from "../avatarSettings";
import {
  expressionPlaysSomething,
  faceSignalSourceOf,
  type SynthesizedFaceSignalSource,
} from "../faceSignals";
import {
  automaticDecisionSinceLoad,
  type AutomaticMaterialsDecision,
} from "../liltoon/lilToonGpuCheck";
import {
  missingOptionalBones,
  type OptionalBoneStandIn,
} from "../poses/anatomy/optionalBones";
import type {
  AvatarEyeEstimate,
  AvatarFacePartRole,
  AvatarFacePartSource,
} from "../vfx/faceParts";
import { mergeAvatarIssues, type AvatarIssue } from "./issues";

/** A face part as Diagnostics shows it: how it was found, never its names. */
export type AvatarDiagnosticsFacePart = {
  role: AvatarFacePartRole;
  source: AvatarFacePartSource;
  /** For an estimated eye, what places it (blinking or its bone). */
  estimate?: AvatarEyeEstimate;
  /**
   * For face skin, true when it is the head region of a mesh part that holds
   * the whole body (`findFaceSkinRegion`).
   */
  headRegion?: true;
  /** Mesh parts that are this part throughout. */
  bindingCount: number;
  /**
   * Mesh parts that hold this part as a region (lashes in the face mesh, the
   * face in a whole-body mesh).
   */
  regionCount: number;
  confidence: number;
};

/**
 * Where a standard expression the Avatar plays comes from: the file, an ARKit
 * mix, Animama's composition of MMD morphs (and ARKit mixes) by region, or,
 * for a blink or viseme the file leaves empty, the shapes `faceSignals.ts`
 * filled it from (the file's left and right blinks, MMD, ARKit or VRChat).
 */
export type AvatarExpressionSource = "model" | SynthesizedFaceSignalSource;

/** Where each region of a mood preset's face comes from (R12). */
export type AvatarMoodFace = {
  preset: string;
} & Record<FaceRegion, FaceRegionSource>;

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
    /** Each mood preset's face, region by region, as emotions play it. */
    moods: AvatarMoodFace[];
    /** Names emotions or clips asked for that the Avatar cannot play. */
    unresolved: { names: string[]; otherCount: number };
  };
  motion: {
    humanoidBones: number;
    missingRequiredBones: string[];
    /**
     * Optional bones that Gestures, poses or contacts use and the rig lacks,
     * each with the bone that stands in for it (`optionalBones.ts`).
     */
    missingOptionalBones: OptionalBoneStandIn[];
    springJoints: number;
    springColliders: number;
    /** The wind setting in effect, and whether wind and updraft apply. */
    wind: { mode: AvatarSpringMode; ambientForces: boolean };
    /**
     * How far the arms and hands rest from VRoid's T-pose (degrees) and
     * whether they were normalized; null before a load measured them.
     */
    restPose: {
      armDegrees: number;
      handDegrees: number;
      armsNormalized: boolean;
      handsNormalized: boolean;
    } | null;
  };
  /**
   * How the file's authored lilToon materials render under the material
   * setting it loaded with; null when the file has none.
   */
  materials: {
    mode: AvatarMaterialMode;
    lilToon: "rendered" | "fallback";
    /** What Automatic chose at load and why; null under lilToon or Simple. */
    automatic: AutomaticMaterialsDecision | null;
    /**
     * What Automatic would choose now, when a GPU measurement stored since
     * this load changes it: materials are built at load, so the next load
     * uses it. Null otherwise.
     */
    nextLoad: AutomaticMaterialsDecision | null;
  } | null;
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
      ? Object.values(map.parts).map((part) => {
          const regionKeys = new Set(
            (part.regions ?? []).map((region) => region.bindingKey),
          );
          return {
            role: part.role,
            source: part.source,
            ...(part.estimate ? { estimate: part.estimate } : {}),
            ...(part.role === "face_skin" && regionKeys.size > 0
              ? { headRegion: true as const }
              : {}),
            // A binding the part holds only a region of counts as a region.
            bindingCount: part.bindings.filter((key) => !regionKeys.has(key))
              .length,
            regionCount: part.regions?.length ?? 0,
            confidence: part.confidence,
          };
        })
      : [],
    landmarks: avatar.getFaceLandmarksSnapshot()?.status ?? "unavailable",
    textureAnchors:
      avatar.getFaceTextureAnchorsSnapshot()?.status ?? "unavailable",
  };
}

/** Where a registered standard expression comes from. */
function expressionSource(expression: VRMExpression): AvatarExpressionSource {
  const signal = faceSignalSourceOf(expression);
  if (signal) return signal;
  if (arkitMixOf(expression)) return "arkit";
  return isAnimamaFaceExpression(expression) ? "mmd" : "model";
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
    // three-vrm registers every preset a VRM 0 file lists, so one that plays
    // nothing is missing; `neutral` is empty by design.
    if (
      expression &&
      (name === VRMExpressionPresetName.Neutral ||
        expressionPlaysSomething(expression))
    ) {
      presets.push({ name, source: expressionSource(expression) });
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
    moods: Object.entries(arkitFace?.moods ?? {}).map(([preset, regions]) => ({
      preset,
      ...regions,
    })),
    unresolved: {
      names: unresolved.filter(isStandardExpressionName),
      otherCount: unresolved.filter((name) => !isStandardExpressionName(name))
        .length,
    },
  };
}

/**
 * A face with nothing to play moods (no VRoid parts, MMD morphs, ARKit shapes
 * or mood presets) stays neutral: lids are not lowered and mouth visemes are
 * not used for moods (owner decision 8), so say so.
 */
function expressionIssues(
  expressions: AvatarLiveDiagnostics["expressions"],
): AvatarIssue[] {
  const neutral =
    expressions.moods.length > 0 &&
    expressions.moods.every(
      (mood) =>
        mood.brow === "none" && mood.eye === "none" && mood.mouth === "none",
    );
  return neutral ? [{ code: "face_expressions_none" }] : [];
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
    missingOptionalBones: humanoid
      ? missingOptionalBones((bone) => Boolean(humanoid.getRawBoneNode(bone)))
      : [],
    springJoints: springs?.joints.size ?? 0,
    springColliders: springs?.colliders.length ?? 0,
    wind: { mode: avatar.springMode, ambientForces: avatar.ambientForces },
    restPose: avatar.restPose
      ? {
          armDegrees: Math.round(avatar.restPose.armDegrees),
          handDegrees: Math.round(avatar.restPose.handDegrees),
          armsNormalized: avatar.restPose.armsNormalized,
          handsNormalized: avatar.restPose.handsNormalized,
        }
      : null,
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
  const expressions = collectExpressions(avatar);
  const issues = mergeAvatarIssues(
    avatar.loadIssues,
    expressionIssues(expressions),
    avatar.facePartMap?.issues,
    avatar.getFaceLandmarksSnapshot()?.issues,
    avatar.getFaceTextureAnchorsSnapshot()?.issues,
    avatar.springBonePhysicsController?.getSnapshot().issues,
    avatar.vfxController?.getSnapshot().issues,
  );
  return {
    face: collectFace(avatar),
    expressions,
    motion: collectMotion(avatar),
    materials:
      avatar.lilToonMaterials === "none"
        ? null
        : {
            mode: avatar.materialMode,
            lilToon: avatar.lilToonMaterials,
            automatic: avatar.automaticMaterials,
            nextLoad: automaticDecisionSinceLoad(avatar.automaticMaterials),
          },
    issues,
  };
}
