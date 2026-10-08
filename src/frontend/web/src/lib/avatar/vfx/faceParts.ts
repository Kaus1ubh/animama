/**
 * Model-agnostic face and eye part detection.
 *
 * VRM does not name face parts, so detection reads spec signals first: the
 * humanoid eye bones, skin weights, the primitives that the `blink` and `aa`
 * expressions morph, expression look-at texture transforms and spring-bone
 * joints. Material names are only a per-role fallback, and user corrections
 * (keyed to the exact VRM digest) override both.
 */
import type { AvatarFacePartCorrection } from "@animama/runtime-contracts/api-types";
import type { VRM } from "@pixiv/three-vrm";
import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

import type { Avatar } from "../Avatar";
import { buildRuntimePrimitiveBindings } from "../vrmEditorInspection";
import { readVertexPosition } from "./avatarPrimitiveUtils";
import type { RuntimePrimitiveBindingEntry } from "./avatarPrimitiveUtils";
import {
  matchAvatarTargetRole,
  resolveEyeIrisTargetBindings,
  resolveFaceTargetBinding,
} from "./avatarRuntimeTargeting";
import { resolveAvatarVFXModelProfile } from "./profiles";
import {
  isAttachmentVFXEntry,
  isEyeHoverVFXEntry,
  isTextureVFXEntry,
  type AvatarVFXParsedEntry,
  type AvatarVFXTargetRole,
} from "./types";

export const AVATAR_FACE_PARTS_SCHEMA = "animama/avatar-face-parts/1";

/** Roles a correction can name; `eye_left`/`eye_right` hold the irises. */
export const AVATAR_FACE_PART_ROLES = [
  "face_skin",
  "eye_left",
  "eye_right",
  "eye_highlight",
  "eyeline",
  "eyelash",
  "hair",
] as const;
export type AvatarFacePartRole = (typeof AVATAR_FACE_PART_ROLES)[number];

/** Lowercase part names for diagnostics and the creator. */
export const AVATAR_FACE_PART_LABELS: Record<AvatarFacePartRole, string> = {
  face_skin: "face skin",
  eye_left: "left eye",
  eye_right: "right eye",
  eye_highlight: "eye highlight",
  eyeline: "eye line",
  eyelash: "eyelash",
  hair: "hair",
};

/** Where a part's bindings came from, in decreasing order of trust. */
export type AvatarFacePartSource =
  | "corrected"
  | "signals"
  | "names"
  | "missing";

export type AvatarFacePart = {
  role: AvatarFacePartRole;
  /** glTF `node:mesh:primitive` keys, as `buildRuntimePrimitiveBindings` emits. */
  bindings: string[];
  source: AvatarFacePartSource;
  /** 0 (missing) to 1 (corrected); signals report how clearly they separated. */
  confidence: number;
  /**
   * For a corrected part, what detection found without the correction. A
   * saved correction pins every required part, so only a part whose bindings
   * differ from detection was changed by the user ({@link isFacePartEdited}).
   */
  detected?: AvatarFacePart;
};

/**
 * A saved correction (`AvatarFacePartCorrection`, shared with the backend via
 * OpenAPI): required face and eye parts, optional others, for one VRM digest.
 */
export type AvatarFacePartCorrections = AvatarFacePartCorrection;

export type AvatarFacePartMap = {
  parts: Record<AvatarFacePartRole, AvatarFacePart>;
  /** Eye-bone primitives classified as eye whites; diagnostic only. */
  eyeWhite: string[];
  diagnostics: string[];
};

export type DetectAvatarFacePartsOptions = {
  /** Allow material-name fallback per role. Defaults to true. */
  names?: boolean;
  /** Select a per-model name profile for the fallback. */
  sourceKey?: string | null;
  sourceUrl?: string | null;
  corrections?: AvatarFacePartCorrections | null;
  /** sha256 of the loaded VRM bytes; a correction must match it. */
  vrmSha256?: string | null;
};

/** Head-skinned: ≥90% of skin weight on the head and its non-spring, non-eye descendants. */
const HEAD_SKINNED_MIN_SHARE = 0.9;
/** "Mostly" skinned to a bone class. */
const MAJORITY_SHARE = 0.5;
/** A primitive weighted ≥80% to one eye bone holds only that eye. */
const SINGLE_EYE_SHARE = 0.8;
/** VRoid bangs root on the head bone, so a spring share marks hair. */
const HAIR_MIN_SPRING_SHARE = 0.1;
/** A highlight is under half its iris's area; a white is larger than it. */
const HIGHLIGHT_MAX_AREA_RATIO = 0.5;
/** Eye lines and lashes move almost entirely when the avatar blinks. */
const BLINK_MOVED_MIN_SHARE = 0.8;
/** …and about as far as the eyelid skin does. */
const BLINK_DISPLACEMENT_MIN_RATIO = 0.5;
/** …and are small compared with the face skin. */
const EYE_DETAIL_MAX_AREA_RATIO = 0.25;
/**
 * The eye window spans the eyes plus this many eye-bone distances: wide enough
 * that face skin (which surrounds the eyes) outweighs the eye whites filling
 * its eye holes.
 */
const EYE_WINDOW_HALF_WIDTH = 3;
const EYE_WINDOW_HALF_HEIGHT = 2.5;
const MOVED_EPSILON = 1e-4;

const LOOK_AT_EXPRESSIONS = ["lookLeft", "lookRight", "lookUp", "lookDown"];
const HAIR_NAME_PATTERN = /hair|bang|fringe/i;

type BoneClass = "eye_left" | "eye_right" | "head" | "spring_head" | "other";

type EyeSide = "left" | "right" | "both";

type SkinShares = Record<BoneClass, number>;

type Candidate = {
  entry: RuntimePrimitiveBindingEntry;
  shares: SkinShares;
};

type Geometry2D = {
  /** Triangle area projected on the head's front plane, in m². */
  area: number;
  /** Area of triangles whose centroid lies inside the eye window. */
  eyeWindowArea: number;
  /** Mean vertex coordinate along the face's front axis. */
  front: number;
  center: THREE.Vector3;
  minX: number;
  maxX: number;
};

type EyeWindow = { minX: number; maxX: number; minY: number; maxY: number };

type Context = {
  vrm: VRM;
  gltf: GLTF;
  entries: RuntimePrimitiveBindingEntry[];
  anchor: THREE.Object3D;
  frontSign: 1 | -1;
  diagnostics: string[];
};

/**
 * Identify face skin, irises (per side), eye highlights, eye lines, eyelashes
 * and hair on a loaded VRM. Every role is reported, with `missing` when nothing
 * qualified. With `names: false`, only spec signals and corrections are used.
 */
export function detectAvatarFaceParts(
  vrm: VRM,
  gltf: GLTF,
  options: DetectAvatarFacePartsOptions = {},
): AvatarFacePartMap {
  const useNames = options.names ?? true;
  const entries = buildRuntimePrimitiveBindings({
    scene: vrm.scene,
    sourceGltf: gltf,
  }).entries;
  const anchor = vrm.humanoid?.getNormalizedBoneNode("head") ?? vrm.scene;
  const context: Context = {
    vrm,
    gltf,
    entries,
    anchor,
    frontSign: vrm.meta?.metaVersion === "0" ? -1 : 1,
    diagnostics: [],
  };

  const signals = detectFromSignals(context);
  const names = useNames ? detectFromNames(context, options) : null;

  const parts = {} as Record<AvatarFacePartRole, AvatarFacePart>;
  for (const role of AVATAR_FACE_PART_ROLES) {
    const fromSignals = signals.parts[role];
    if (fromSignals && fromSignals.bindings.length > 0) {
      parts[role] = { role, source: "signals", ...fromSignals };
      continue;
    }
    const fromNames = names?.[role] ?? [];
    parts[role] =
      fromNames.length > 0
        ? { role, bindings: fromNames, source: "names", confidence: 0.5 }
        : { role, bindings: [], source: "missing", confidence: 0 };
  }

  applyCorrections(context, parts, options);
  return {
    parts,
    eyeWhite: signals.eyeWhite,
    diagnostics: context.diagnostics,
  };
}

/** True when the user changed this part's bindings from what was detected. */
export function isFacePartEdited(part: AvatarFacePart): boolean {
  if (part.source !== "corrected") return false;
  const detected = new Set(part.detected?.bindings ?? []);
  return (
    part.bindings.length !== detected.size ||
    part.bindings.some((key) => !detected.has(key))
  );
}

/** VFX target roles in the name matcher's precedence: detail, iris, skin. */
const TARGET_ROLE_PARTS: ReadonlyArray<
  [AvatarVFXTargetRole, readonly AvatarFacePartRole[]]
> = [
  ["eye_highlight", ["eye_highlight"]],
  ["eyeline", ["eyeline"]],
  ["eyelash", ["eyelash"]],
  ["eye_iris", ["eye_left", "eye_right"]],
  ["face_skin", ["face_skin"]],
];

/**
 * Every VFX target role a binding serves. One mesh can hold several parts,
 * such as eyelashes drawn in the eye-line mesh, and an effect on any of them
 * uses it. A part the user corrected comes first, so it is the primary role;
 * the rest follow the name matcher's precedence. Hair is not a VFX target.
 */
export function resolveFacePartTargetRoles(
  map: AvatarFacePartMap | null,
  bindingKey: string,
): AvatarVFXTargetRole[] {
  if (!map) return [];
  const held = TARGET_ROLE_PARTS.filter(([, roles]) =>
    roles.some((role) => map.parts[role].bindings.includes(bindingKey)),
  );
  const edited = held.filter(([, roles]) =>
    roles.some((role) => isFacePartEdited(map.parts[role])),
  );
  return [...edited, ...held.filter((entry) => !edited.includes(entry))].map(
    ([target]) => target,
  );
}

/** The primary VFX target role for a binding ({@link resolveFacePartTargetRoles}). */
export function resolveFacePartTargetRole(
  map: AvatarFacePartMap | null,
  bindingKey: string,
): AvatarVFXTargetRole | null {
  return resolveFacePartTargetRoles(map, bindingKey)[0] ?? null;
}

/** Live entries for a part, in binding order. */
export function selectFacePartEntries(
  map: AvatarFacePartMap | null,
  roles: readonly AvatarFacePartRole[],
  entries: readonly RuntimePrimitiveBindingEntry[],
): RuntimePrimitiveBindingEntry[] {
  if (!map) return [];
  const keys = new Set(roles.flatMap((role) => map.parts[role].bindings));
  return entries.filter((entry) => keys.has(entry.bindingKey));
}

/**
 * The first face part an effect needs that the map lacks, or null. Face
 * landmarks need face skin, so every hover and decal needs it; an eye hover
 * also needs the eye(s) it covers; an iris texture needs either iris.
 */
export function findMissingFacePart(
  map: AvatarFacePartMap,
  effect: AvatarVFXParsedEntry,
): AvatarFacePartRole | null {
  const missing = (role: AvatarFacePartRole) =>
    map.parts[role].bindings.length === 0;
  // Body, sticker and silhouette attachments need no face part.
  if (isAttachmentVFXEntry(effect)) return null;
  if (isTextureVFXEntry(effect)) {
    if (effect.targetRole === "eye_iris") {
      return missing("eye_left") && missing("eye_right") ? "eye_left" : null;
    }
    return missing(effect.targetRole) ? effect.targetRole : null;
  }
  if (missing("face_skin")) return "face_skin";
  if (isEyeHoverVFXEntry(effect)) {
    const sides: AvatarFacePartRole[] =
      effect.side && !effect.requiresMirror
        ? [effect.side === "left" ? "eye_left" : "eye_right"]
        : ["eye_left", "eye_right"];
    return sides.find(missing) ?? null;
  }
  return null;
}

/** The live entries landmarks, anchors and hover clearance read. */
export type AvatarFacePartEntries = {
  face: RuntimePrimitiveBindingEntry | null;
  leftEyes: RuntimePrimitiveBindingEntry[];
  rightEyes: RuntimePrimitiveBindingEntry[];
  hair: RuntimePrimitiveBindingEntry[];
};

/**
 * Resolve the Avatar's part map against live entries. An Avatar without a map
 * (a test double, or a load that predates detection) uses name matching.
 */
export function resolveAvatarFacePartEntries(
  avatar: Pick<
    Avatar,
    "facePartMap" | "sourceGltf" | "sourceKey" | "sourceUrl"
  >,
  entries: RuntimePrimitiveBindingEntry[],
): AvatarFacePartEntries {
  const map = avatar.facePartMap;
  if (map) {
    return {
      face: selectFacePartEntries(map, ["face_skin"], entries)[0] ?? null,
      leftEyes: selectFacePartEntries(map, ["eye_left"], entries),
      rightEyes: selectFacePartEntries(map, ["eye_right"], entries),
      hair: selectFacePartEntries(map, ["hair"], entries),
    };
  }
  const source = { sourceKey: avatar.sourceKey, sourceUrl: avatar.sourceUrl };
  const irises = resolveEyeIrisTargetBindings({ ...source, entries });
  return {
    face: resolveFaceTargetBinding({ ...source, entries }),
    leftEyes: irises,
    rightEyes: irises,
    hair: avatar.sourceGltf
      ? resolveNamedHairBindings(avatar.sourceGltf, entries)
      : [],
  };
}

// ─── Signals ────────────────────────────────────────────────────────────────

type SignalParts = Partial<
  Record<AvatarFacePartRole, { bindings: string[]; confidence: number }>
>;

function detectFromSignals(context: Context): {
  parts: SignalParts;
  eyeWhite: string[];
} {
  const { vrm, entries } = context;
  const classify = createBoneClassifier(vrm);
  const candidates: Candidate[] = entries.map((entry) => ({
    entry,
    shares: measureSkinShares(entry.object, classify),
  }));
  const parts: SignalParts = {};
  const geometry = new Map<RuntimePrimitiveBindingEntry, Geometry2D>();
  const measure = (entry: RuntimePrimitiveBindingEntry, window?: EyeWindow) => {
    if (!window) {
      const cached = geometry.get(entry);
      if (cached) return cached;
    }
    const result = measurePrimitive(context, entry.object, window ?? null);
    if (!window) geometry.set(entry, result);
    return result;
  };

  // Eyes: irises named by look-at texture transforms, then eye-bone primitives.
  const lookAtIrises = findLookAtTextureEntries(context);
  const eyeBone = candidates.filter(
    (candidate) =>
      candidate.shares.eye_left + candidate.shares.eye_right >= MAJORITY_SHARE,
  );
  const shareOf = (entry: RuntimePrimitiveBindingEntry) =>
    candidates.find((candidate) => candidate.entry === entry)?.shares ?? null;
  // One primitive may hold both eyes (VRoid) or a single side. A look-at
  // texture iris without eye-bone weights holds both.
  const sideOf = (entry: RuntimePrimitiveBindingEntry): EyeSide => {
    const shares = shareOf(entry);
    const eyeTotal = shares ? shares.eye_left + shares.eye_right : 0;
    if (!shares || eyeTotal === 0) return "both";
    const leftShare = shares.eye_left / eyeTotal;
    if (leftShare >= SINGLE_EYE_SHARE) return "left";
    if (leftShare <= 1 - SINGLE_EYE_SHARE) return "right";
    return "both";
  };
  const eyeEntries = unique([
    ...lookAtIrises,
    ...eyeBone.map((candidate) => candidate.entry),
  ]);
  // With separate per-eye primitives, each eye has its own iris, white and
  // highlight, so each side is classified on its own.
  const perSide =
    eyeEntries.some((entry) => sideOf(entry) === "left") &&
    eyeEntries.some((entry) => sideOf(entry) === "right");
  const groups = perSide
    ? (["left", "right", "both"] as const).map((side) =>
        eyeEntries.filter((entry) => sideOf(entry) === side),
      )
    : [eyeEntries];
  const classified = groups
    .filter((group) => group.length > 0)
    .map((group) =>
      classifyEyePrimitives(
        group,
        lookAtIrises.filter((entry) => group.includes(entry)),
        measure,
      ),
    );
  const eyeParts = {
    iris: classified.flatMap((group) => group.iris),
    white: classified.flatMap((group) => group.white),
    highlight: classified.flatMap((group) => group.highlight),
    confidence: Math.min(1, ...classified.map((group) => group.confidence)),
  };
  const left: string[] = [];
  const right: string[] = [];
  for (const iris of eyeParts.iris) {
    const side = sideOf(iris);
    if (side !== "right") left.push(iris.bindingKey);
    if (side !== "left") right.push(iris.bindingKey);
  }
  const eyeConfidence = lookAtIrises.length > 0 ? 0.95 : eyeParts.confidence;
  if (left.length)
    parts.eye_left = { bindings: unique(left), confidence: eyeConfidence };
  if (right.length)
    parts.eye_right = { bindings: unique(right), confidence: eyeConfidence };
  if (eyeParts.highlight.length) {
    parts.eye_highlight = {
      bindings: eyeParts.highlight.map((entry) => entry.bindingKey),
      confidence: 0.8,
    };
  }
  const eyeKeys = new Set(
    [...eyeBone.map((candidate) => candidate.entry), ...lookAtIrises].map(
      (entry) => entry.bindingKey,
    ),
  );

  // Face skin: head-skinned primitives of the mesh morphed by blink and aa.
  const blink = collectMorphBinds(vrm, "blink");
  const aa = collectMorphBinds(vrm, "aa");
  if (blink.size === 0 || aa.size === 0) {
    context.diagnostics.push(
      "The VRM has no blink or aa morph target; face skin and eye details cannot be found from expressions.",
    );
  }
  const faceMeshCandidates = candidates.filter(
    (candidate) =>
      blink.has(candidate.entry.object) &&
      aa.has(candidate.entry.object) &&
      !eyeKeys.has(candidate.entry.bindingKey),
  );
  const window = resolveEyeWindow(context, eyeParts.iris, measure);
  const faceCandidates = faceMeshCandidates
    .filter((candidate) => candidate.shares.head >= HEAD_SKINNED_MIN_SHARE)
    .map((candidate) => {
      const metrics = measure(candidate.entry, window ?? undefined);
      return {
        entry: candidate.entry,
        score: window ? metrics.eyeWindowArea : metrics.area,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score);
  const faceSkin = faceCandidates[0]?.entry ?? null;
  if (faceSkin) {
    const runnerUp = faceCandidates[1]?.score ?? 0;
    const clear = faceCandidates[0].score >= runnerUp * 2;
    parts.face_skin = {
      bindings: [faceSkin.bindingKey],
      confidence: (window ? 0.9 : 0.7) * (clear ? 1 : 0.7),
    };
  }

  // Eye lines and lashes: small face-mesh primitives the blink moves strongly.
  if (faceSkin) {
    const reference = measureMorphDisplacement(faceSkin.object, blink);
    const faceArea = measure(faceSkin).area;
    const details = faceMeshCandidates
      .filter((candidate) => candidate.entry !== faceSkin)
      .filter((candidate) => {
        const displacement = measureMorphDisplacement(
          candidate.entry.object,
          blink,
        );
        const metrics = measure(candidate.entry);
        return (
          reference.max > 0 &&
          displacement.movedShare >= BLINK_MOVED_MIN_SHARE &&
          displacement.max >= reference.max * BLINK_DISPLACEMENT_MIN_RATIO &&
          metrics.area <= faceArea * EYE_DETAIL_MAX_AREA_RATIO &&
          (!window || isInsideWindow(metrics.center, window))
        );
      })
      .map((candidate) => ({
        entry: candidate.entry,
        area: measure(candidate.entry).area,
      }))
      .sort((a, b) => b.area - a.area);
    // The lid line covers more area than the lash strands above it.
    if (details[0]) {
      parts.eyeline = {
        bindings: [details[0].entry.bindingKey],
        confidence: details.length > 1 ? 0.6 : 0.7,
      };
    }
    if (details.length > 1) {
      parts.eyelash = {
        bindings: details.slice(1).map((detail) => detail.entry.bindingKey),
        confidence: 0.6,
      };
    }
  }

  // Hair: head-subtree primitives with a real share on spring joints.
  const faceMeshObjects = new Set(
    faceMeshCandidates.map((candidate) => candidate.entry.object),
  );
  const hair = candidates.filter(
    (candidate) =>
      !faceMeshObjects.has(candidate.entry.object) &&
      !eyeKeys.has(candidate.entry.bindingKey) &&
      candidate.shares.head + candidate.shares.spring_head >=
        HEAD_SKINNED_MIN_SHARE &&
      candidate.shares.spring_head >= HAIR_MIN_SPRING_SHARE,
  );
  if (hair.length) {
    parts.hair = {
      bindings: hair.map((candidate) => candidate.entry.bindingKey),
      confidence: 0.8,
    };
  }

  return {
    parts,
    eyeWhite: eyeParts.white.map((entry) => entry.bindingKey),
  };
}

/**
 * Separate iris, white and highlight among eye-bone primitives. The iris is
 * the primitive most consistent with "whites are larger and behind it,
 * highlights are much smaller and in front of it"; ties go to the larger one.
 */
function classifyEyePrimitives(
  eyeBoneEntries: RuntimePrimitiveBindingEntry[],
  lookAtIrises: RuntimePrimitiveBindingEntry[],
  measure: (entry: RuntimePrimitiveBindingEntry) => Geometry2D,
): {
  iris: RuntimePrimitiveBindingEntry[];
  white: RuntimePrimitiveBindingEntry[];
  highlight: RuntimePrimitiveBindingEntry[];
  confidence: number;
} {
  const all = unique([...lookAtIrises, ...eyeBoneEntries]).filter(
    (entry) => measure(entry).area > 0,
  );
  if (all.length === 0) {
    return { iris: [], white: [], highlight: [], confidence: 0 };
  }
  const isHighlightOf = (
    entry: RuntimePrimitiveBindingEntry,
    iris: Geometry2D,
  ) => {
    const metrics = measure(entry);
    return (
      metrics.area < iris.area * HIGHLIGHT_MAX_AREA_RATIO &&
      metrics.front > iris.front
    );
  };
  const isWhiteOf = (entry: RuntimePrimitiveBindingEntry, iris: Geometry2D) => {
    const metrics = measure(entry);
    return metrics.area > iris.area && metrics.front < iris.front;
  };

  let irisEntries: RuntimePrimitiveBindingEntry[];
  let confidence: number;
  if (lookAtIrises.length > 0) {
    irisEntries = lookAtIrises;
    confidence = 0.95;
  } else {
    const scored = all
      .map((entry) => {
        const iris = measure(entry);
        const consistent = all.filter(
          (other) =>
            other !== entry &&
            (isHighlightOf(other, iris) || isWhiteOf(other, iris)),
        ).length;
        return { entry, consistent, area: iris.area };
      })
      .sort((a, b) => b.consistent - a.consistent || b.area - a.area);
    irisEntries = [scored[0].entry];
    const unexplained = all.length - 1 - scored[0].consistent;
    confidence = unexplained === 0 ? 0.9 : 0.6;
  }
  const irisMetrics = measure(irisEntries[0]);
  const rest = all.filter((entry) => !irisEntries.includes(entry));
  return {
    iris: irisEntries,
    white: rest.filter((entry) => isWhiteOf(entry, irisMetrics)),
    highlight: rest.filter((entry) => isHighlightOf(entry, irisMetrics)),
    confidence,
  };
}

/** Primitives whose material a look-at expression moves with a texture transform. */
function findLookAtTextureEntries(
  context: Context,
): RuntimePrimitiveBindingEntry[] {
  const materials = new Set<THREE.Material>();
  const materialIndices = new Set<number>();
  for (const name of LOOK_AT_EXPRESSIONS) {
    const expression = context.vrm.expressionManager?.getExpression(name);
    for (const bind of expression?.binds ?? []) {
      if (!isTextureTransformBind(bind)) continue;
      materials.add(bind.material);
      const index = context.gltf.parser.associations.get(
        bind.material,
      )?.materials;
      if (typeof index === "number") materialIndices.add(index);
    }
  }
  if (materials.size === 0) return [];
  return context.entries.filter((entry) => {
    const material = Array.isArray(entry.object.material)
      ? entry.object.material[0]
      : entry.object.material;
    return (
      (material !== undefined && materials.has(material)) ||
      (entry.materialIndex !== null && materialIndices.has(entry.materialIndex))
    );
  });
}

function isTextureTransformBind(
  bind: unknown,
): bind is { material: THREE.Material } {
  return (
    typeof bind === "object" &&
    bind !== null &&
    "material" in bind &&
    "offset" in bind &&
    "scale" in bind &&
    (bind as { material: unknown }).material instanceof THREE.Material
  );
}

/** Each morph-bound primitive of an expression and its morph target indices. */
function collectMorphBinds(
  vrm: VRM,
  expressionName: string,
): Map<THREE.Object3D, number[]> {
  const result = new Map<THREE.Object3D, number[]>();
  const expression = vrm.expressionManager?.getExpression(expressionName);
  for (const bind of expression?.binds ?? []) {
    const morph = bind as { primitives?: unknown; index?: unknown };
    if (!Array.isArray(morph.primitives) || typeof morph.index !== "number") {
      continue;
    }
    for (const primitive of morph.primitives as THREE.Object3D[]) {
      const indices = result.get(primitive) ?? [];
      indices.push(morph.index);
      result.set(primitive, indices);
    }
  }
  return result;
}

/** The share of vertices a morph moves and its largest displacement (m). */
function measureMorphDisplacement(
  mesh: THREE.Mesh,
  binds: Map<THREE.Object3D, number[]>,
): { movedShare: number; max: number } {
  const geometry = mesh.geometry;
  const targets = geometry.morphAttributes.position ?? [];
  const position = geometry.getAttribute("position");
  if (!position || position.count === 0) return { movedShare: 0, max: 0 };
  const displacement = new Float32Array(position.count);
  for (const index of binds.get(mesh) ?? []) {
    const target = targets[index];
    if (!target) continue;
    for (let vertex = 0; vertex < target.count; vertex += 1) {
      const length = Math.hypot(
        target.getX(vertex),
        target.getY(vertex),
        target.getZ(vertex),
      );
      displacement[vertex] = Math.max(displacement[vertex], length);
    }
  }
  let moved = 0;
  let max = 0;
  for (const value of displacement) {
    if (value > MOVED_EPSILON) moved += 1;
    max = Math.max(max, value);
  }
  return { movedShare: moved / position.count, max };
}

function createBoneClassifier(
  vrm: VRM,
): (bone: THREE.Object3D | null) => BoneClass {
  const humanoid = vrm.humanoid;
  const head = humanoid?.getRawBoneNode("head") ?? null;
  const leftEye = humanoid?.getRawBoneNode("leftEye") ?? null;
  const rightEye = humanoid?.getRawBoneNode("rightEye") ?? null;
  const springs = new Set<THREE.Object3D>();
  vrm.springBoneManager?.joints.forEach((joint) => springs.add(joint.bone));
  const cache = new Map<THREE.Object3D, BoneClass>();
  return (bone) => {
    if (!bone || !head) return "other";
    const cached = cache.get(bone);
    if (cached) return cached;
    let side: BoneClass | null = null;
    let underHead = false;
    for (let node: THREE.Object3D | null = bone; node; node = node.parent) {
      if (node === leftEye) side ??= "eye_left";
      if (node === rightEye) side ??= "eye_right";
      if (node === head) {
        underHead = true;
        break;
      }
    }
    const result: BoneClass = !underHead
      ? "other"
      : (side ?? (springs.has(bone) ? "spring_head" : "head"));
    cache.set(bone, result);
    return result;
  };
}

/** Normalized skin-weight shares per bone class; unskinned meshes use their parent. */
function measureSkinShares(
  mesh: THREE.Mesh,
  classify: (bone: THREE.Object3D | null) => BoneClass,
): SkinShares {
  const shares: SkinShares = {
    eye_left: 0,
    eye_right: 0,
    head: 0,
    spring_head: 0,
    other: 0,
  };
  const geometry = mesh.geometry;
  const skinIndex = geometry.getAttribute("skinIndex");
  const skinWeight = geometry.getAttribute("skinWeight");
  if (!(mesh instanceof THREE.SkinnedMesh) || !skinIndex || !skinWeight) {
    shares[classify(mesh.parent)] = 1;
    return shares;
  }
  const bones = mesh.skeleton.bones;
  let total = 0;
  for (let vertex = 0; vertex < skinIndex.count; vertex += 1) {
    for (let slot = 0; slot < skinIndex.itemSize; slot += 1) {
      const weight = skinWeight.getComponent(vertex, slot);
      if (weight <= 0) continue;
      shares[classify(bones[skinIndex.getComponent(vertex, slot)] ?? null)] +=
        weight;
      total += weight;
    }
  }
  if (total > 0) {
    for (const key of Object.keys(shares) as BoneClass[]) shares[key] /= total;
  }
  return shares;
}

/** Projected triangle area, front depth and centre in head-anchor space. */
function measurePrimitive(
  context: Context,
  mesh: THREE.Mesh,
  window: EyeWindow | null,
): Geometry2D {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  if (!(position instanceof THREE.BufferAttribute) || position.count === 0) {
    return {
      area: 0,
      eyeWindowArea: 0,
      front: 0,
      center: new THREE.Vector3(),
      minX: 0,
      maxX: 0,
    };
  }
  // Compose the mesh's world matrix without writing `matrixWorld`: before the
  // first frame a VRM 0 scene's raw bones still hold pre-rotation matrices that
  // the bind matrices agree with, so updating an ancestor bone here would skew
  // every later skinned read (landmarks included).
  const meshWorld = composeWorldMatrix(mesh);
  context.anchor.updateWorldMatrix(true, false);
  const inverseAnchor = context.anchor.matrixWorld.clone().invert();
  const points: THREE.Vector3[] = [];
  const center = new THREE.Vector3();
  let front = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let vertex = 0; vertex < position.count; vertex += 1) {
    const point = readVertexPosition(
      mesh,
      position,
      vertex,
      new THREE.Vector3(),
    )
      .applyMatrix4(meshWorld)
      .applyMatrix4(inverseAnchor);
    points.push(point);
    center.add(point);
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    front += point.z * context.frontSign;
  }
  center.multiplyScalar(1 / points.length);
  const index = geometry.getIndex();
  const triangleCount = index ? index.count / 3 : position.count / 3;
  let area = 0;
  let eyeWindowArea = 0;
  const centroid = new THREE.Vector3();
  for (let triangle = 0; triangle < triangleCount; triangle += 1) {
    const a = points[index ? index.getX(triangle * 3) : triangle * 3];
    const b = points[index ? index.getX(triangle * 3 + 1) : triangle * 3 + 1];
    const c = points[index ? index.getX(triangle * 3 + 2) : triangle * 3 + 2];
    if (!a || !b || !c) continue;
    const projected =
      Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
    area += projected;
    if (window) {
      centroid
        .copy(a)
        .add(b)
        .add(c)
        .multiplyScalar(1 / 3);
      if (isInsideWindow(centroid, window)) eyeWindowArea += projected;
    }
  }
  return {
    area,
    eyeWindowArea,
    front: front / points.length,
    center,
    minX,
    maxX,
  };
}

/** An object's world matrix from current local transforms, without mutation. */
function composeWorldMatrix(object: THREE.Object3D): THREE.Matrix4 {
  const world = new THREE.Matrix4();
  const local = new THREE.Matrix4();
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (node.matrixAutoUpdate) {
      local.compose(node.position, node.quaternion, node.scale);
    } else {
      local.copy(node.matrix);
    }
    world.premultiply(local);
  }
  return world;
}

/** A window around both eyes, from the eye bones or else the irises. */
function resolveEyeWindow(
  context: Context,
  irises: RuntimePrimitiveBindingEntry[],
  measure: (entry: RuntimePrimitiveBindingEntry) => Geometry2D,
): EyeWindow | null {
  // Normalized eye nodes, as the landmarks use: updating a raw bone's world
  // matrix here would change later skinned reads before the first frame.
  const humanoid = context.vrm.humanoid;
  const leftEye = humanoid?.getNormalizedBoneNode("leftEye") ?? null;
  const rightEye = humanoid?.getNormalizedBoneNode("rightEye") ?? null;
  let left: THREE.Vector3 | null = null;
  let right: THREE.Vector3 | null = null;
  if (leftEye && rightEye) {
    context.anchor.updateWorldMatrix(true, false);
    left = context.anchor.worldToLocal(
      leftEye.getWorldPosition(new THREE.Vector3()),
    );
    right = context.anchor.worldToLocal(
      rightEye.getWorldPosition(new THREE.Vector3()),
    );
  } else if (irises.length > 0) {
    // Without eye bones the iris primitive spans both eyes; use its extent.
    const iris = measure(irises[0]);
    const quarter = (iris.maxX - iris.minX) / 4;
    left = iris.center.clone().setX(iris.center.x - quarter);
    right = iris.center.clone().setX(iris.center.x + quarter);
  }
  if (!left || !right) return null;
  const distance = Math.max(left.distanceTo(right), 1e-3);
  return {
    minX: Math.min(left.x, right.x) - distance * EYE_WINDOW_HALF_WIDTH,
    maxX: Math.max(left.x, right.x) + distance * EYE_WINDOW_HALF_WIDTH,
    minY: (left.y + right.y) / 2 - distance * EYE_WINDOW_HALF_HEIGHT,
    maxY: (left.y + right.y) / 2 + distance * EYE_WINDOW_HALF_HEIGHT,
  };
}

function isInsideWindow(point: THREE.Vector3, window: EyeWindow): boolean {
  return (
    point.x >= window.minX &&
    point.x <= window.maxX &&
    point.y >= window.minY &&
    point.y <= window.maxY
  );
}

// ─── Names (per-role fallback) ──────────────────────────────────────────────

type NameSource = { sourceKey?: string | null; sourceUrl?: string | null };

/**
 * Material- and node-name detection, the pre-signal behaviour. Used per role
 * when signals find nothing, and by tests as the comparison baseline.
 */
export function detectAvatarFacePartsByName(
  vrm: VRM,
  gltf: GLTF,
  source: NameSource = {},
): Record<AvatarFacePartRole, string[]> {
  const entries = buildRuntimePrimitiveBindings({
    scene: vrm.scene,
    sourceGltf: gltf,
  }).entries;
  return detectFromNames(
    { vrm, gltf, entries, anchor: vrm.scene, frontSign: 1, diagnostics: [] },
    source,
  );
}

function detectFromNames(
  context: Context,
  source: NameSource,
): Record<AvatarFacePartRole, string[]> {
  const profile = resolveAvatarVFXModelProfile(source);
  const byRole = (role: AvatarVFXTargetRole) =>
    context.entries
      .filter(
        (entry) => matchAvatarTargetRole(entry.materialName, profile) === role,
      )
      .map((entry) => entry.bindingKey);
  const face = resolveFaceTargetBinding({
    ...source,
    entries: context.entries,
  });
  const irises = resolveEyeIrisTargetBindings({
    ...source,
    entries: context.entries,
  }).map((entry) => entry.bindingKey);
  return {
    face_skin: face ? [face.bindingKey] : [],
    eye_left: irises,
    eye_right: irises,
    eye_highlight: byRole("eye_highlight"),
    eyeline: byRole("eyeline"),
    eyelash: byRole("eyelash"),
    hair: resolveNamedHairBindings(context.gltf, context.entries).map(
      (entry) => entry.bindingKey,
    ),
  };
}

/**
 * Hair by name: everything under a top-level node named like hair, else any
 * primitive whose material, object or ancestor is named like hair.
 */
export function resolveNamedHairBindings(
  gltf: GLTF,
  entries: readonly RuntimePrimitiveBindingEntry[],
): RuntimePrimitiveBindingEntry[] {
  const rawNodes: unknown[] = Array.isArray(gltf.parser.json.nodes)
    ? gltf.parser.json.nodes
    : [];
  const parents = new Map<number, number>();
  rawNodes.forEach((node, index) => {
    for (const child of readChildren(node)) parents.set(child, index);
  });
  const nodeIndices = new Set<number>();
  const meshIndices = new Set<number>();
  const stack = rawNodes
    .map((node, index) => ({ node, index }))
    .filter(
      ({ node, index }) =>
        !parents.has(index) && HAIR_NAME_PATTERN.test(readName(node)),
    )
    .map(({ index }) => index);
  while (stack.length > 0) {
    const index = stack.pop() ?? -1;
    if (index < 0 || nodeIndices.has(index)) continue;
    nodeIndices.add(index);
    const node = rawNodes[index];
    const mesh = (node as { mesh?: unknown } | null)?.mesh;
    if (typeof mesh === "number") meshIndices.add(mesh);
    stack.push(
      ...readChildren(node).filter((child) => child < rawNodes.length),
    );
  }
  const rooted = entries.filter(
    (entry) =>
      (entry.nodeIndex !== null && nodeIndices.has(entry.nodeIndex)) ||
      meshIndices.has(entry.meshIndex),
  );
  if (rooted.length > 0) return rooted;
  return entries.filter((entry) => {
    if (
      HAIR_NAME_PATTERN.test(entry.materialName ?? "") ||
      HAIR_NAME_PATTERN.test(entry.objectName ?? "")
    ) {
      return true;
    }
    for (let node = entry.object.parent; node; node = node.parent) {
      if (HAIR_NAME_PATTERN.test(node.name)) return true;
    }
    return false;
  });
}

function readChildren(node: unknown): number[] {
  const children = (node as { children?: unknown } | null)?.children;
  return Array.isArray(children)
    ? children.filter((child): child is number => typeof child === "number")
    : [];
}

function readName(node: unknown): string {
  const name = (node as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name.trim() : "";
}

// ─── Corrections ────────────────────────────────────────────────────────────

/**
 * Replace detected roles with a correction for the same VRM bytes. Unknown
 * keys are dropped; a role left with no known key keeps its detection. An
 * explicitly empty optional role marks the part as absent.
 */
function applyCorrections(
  context: Context,
  parts: Record<AvatarFacePartRole, AvatarFacePart>,
  options: DetectAvatarFacePartsOptions,
): void {
  const corrections = options.corrections;
  if (!corrections) return;
  if (corrections.schema !== AVATAR_FACE_PARTS_SCHEMA) {
    context.diagnostics.push(
      `Ignored face part corrections with unsupported schema ${String(corrections.schema)}.`,
    );
    return;
  }
  const digest = options.vrmSha256?.trim().toLowerCase() ?? "";
  if (!digest || corrections.vrm_sha256.trim().toLowerCase() !== digest) {
    context.diagnostics.push(
      digest
        ? "Ignored face part corrections made for different VRM bytes."
        : "Ignored face part corrections because the VRM digest is unknown.",
    );
    return;
  }
  const known = new Set(context.entries.map((entry) => entry.bindingKey));
  for (const role of AVATAR_FACE_PART_ROLES) {
    const requested = corrections.parts[role];
    if (requested === undefined || requested === null) continue;
    const bindings = unique(requested).filter((key) => known.has(key));
    const unknown = requested.filter((key) => !known.has(key));
    if (unknown.length > 0) {
      context.diagnostics.push(
        `Ignored unknown ${role} correction bindings: ${unknown.join(", ")}.`,
      );
    }
    if (requested.length > 0 && bindings.length === 0) continue;
    parts[role] = {
      role,
      bindings,
      source: "corrected",
      confidence: 1,
      detected: parts[role],
    };
  }
}

function unique<T>(values: readonly T[]): T[] {
  return Array.from(new Set(values));
}
