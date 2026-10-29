import type { VRM, VRMHumanBoneName } from "@pixiv/three-vrm";
import * as THREE from "three";

import { createLogger } from "@/lib/logger";

import {
  avatarScale,
  CanonicalSkeleton,
  CONTACT_REFERENCE_HEIGHT,
} from "./poses/anatomy/arms";
import { createBoneClassifier } from "./vfx/boneClasses";

const logger = createLogger("AvatarProportions");

/*
 * An Avatar's face, head and body size, measured once per loaded VRM, for
 * placing head art, hand-to-face contacts and camera framing on Avatars whose
 * heads are much larger than an adult's (chibi, mascot and robot Avatars).
 *
 * Avatar Effects, contacts and the chat's camera presets are authored on the
 * Included Avatars, whose faces are under a fifth of the head bone's height
 * above the feet. Those proportions keep today's behaviour exactly: placement
 * follows the body's size as before. Only a head that outgrows them moves
 * placement over to the face's own size ({@link headSized}).
 *
 * The face is measured where `Avatar` registers it ({@link setAvatarFaceSize}:
 * its UV island within the face bounds, so ears, hats, hoods and hair skinned
 * to the head are left out). Without a registered face (no face found, or a
 * model loaded without an `Avatar`) the head box stands in.
 */

/**
 * The Included Avatars' face size (m): the larger of the face's height and
 * width, 0.220–0.223 m (their heights; widths 0.16–0.20).
 */
export const REFERENCE_FACE_SIZE = 0.22;

/**
 * The Included Avatars' head-box size (m), the stand-in without a measured
 * face: the larger of its height and width, 0.241–0.252 m.
 */
export const REFERENCE_HEAD_SIZE = 0.25;

/**
 * Share of the head bone's height above the feet that the face (or head box)
 * spans, within which proportions count as an adult's, and from which they
 * count as fully big-headed. Faces measure 0.16–0.18 on the Included Avatars
 * and up to about 0.25 on anime proportions; head boxes reach about 0.28 with
 * head-skinned hair, ears or a hood. Twice the Included share (0.4) and more,
 * as on chibi Avatars, is fully big-headed; between the two the weight ramps
 * linearly.
 */
export const BIG_HEAD_SHARE = { start: 0.3, full: 0.4 } as const;

/**
 * Sizes (`avatarScale`: rest head-bone height above the feet over 1.25 m, the
 * measure contacts scale by) within which body effects keep their authored
 * metres: the Included Avatars' (Annie 1.012, Andrew 1.094), widened by 10%
 * each way. A smaller or larger model scales them by its size over the nearer
 * edge, so they grow continuously past the band (R9). Head height rather than
 * bounding height, so hair, ears and hats do not count.
 */
export const BODY_EFFECT_SCALE_BAND = { min: 0.91, max: 1.2 } as const;

/** The scale body effects take on a model whose `avatarScale` is `size`. */
export function bodyEffectScale(size: number): number {
  if (size < BODY_EFFECT_SCALE_BAND.min)
    return size / BODY_EFFECT_SCALE_BAND.min;
  if (size > BODY_EFFECT_SCALE_BAND.max)
    return size / BODY_EFFECT_SCALE_BAND.max;
  return 1;
}

/**
 * Points down the body that effects authored on the Included Avatars are
 * placed between, top down: the neck bone, the shoulders (the upper arm
 * bones), the upper chest, chest, spine and hips bones, the feet (foot bones)
 * and the ground under them (the model's origin).
 */
export const BODY_LANDMARKS = [
  "neck",
  "shoulders",
  "upperChest",
  "chest",
  "spine",
  "hips",
  "feet",
  "ground",
] as const;

export type BodyLandmark = (typeof BODY_LANDMARKS)[number];

/** Bones along the spine that are also body landmarks. */
export const SPINE_BONES = [
  "neck",
  "upperChest",
  "chest",
  "spine",
  "hips",
] as const satisfies readonly (BodyLandmark & VRMHumanBoneName)[];

export type SpineBone = (typeof SPINE_BONES)[number];

/** An Avatar's rest body measures ({@link AvatarProportions.body}). */
export type AvatarBody = {
  /**
   * Each landmark's rest height below the head bone (m, negative), for the
   * landmarks the rig has, each lower than the one above it.
   */
  heights: Partial<Record<BodyLandmark, number>>;
  /**
   * The rest height below the head bone of each spine bone the rig has,
   * unfiltered: where an effect anchored at that bone stands.
   */
  spineBones: Partial<Record<SpineBone, number>>;
  /**
   * Half the shoulders' width plus half the hips' width (upper arm and upper
   * leg bones); null without them.
   */
  torsoWidth: number | null;
  /** Upper arm to hand along the arm, the longer side (m); null without arms. */
  armLength: number | null;
  /** Upper leg to foot along the leg, the longer side (m); null without legs. */
  legLength: number | null;
};

/**
 * The Included Avatars' body measures at `avatarScale` 1 (Annie's and
 * Andrew's averaged, each over its size), against which a big-headed
 * Avatar's are read ({@link bodyHeightFromReference}).
 */
export const REFERENCE_AVATAR_BODY = {
  heights: {
    neck: -0.08,
    shoulders: -0.118,
    upperChest: -0.204,
    chest: -0.309,
    spine: -0.422,
    hips: -0.48,
    feet: -1.25,
    ground: -1.35,
  },
  spineBones: {},
  torsoWidth: 0.178,
  armLength: 0.44,
  legLength: 0.73,
} as const satisfies AvatarBody;

/**
 * The top of the head over the head bone's height above the feet on the
 * Included Avatars: their head boxes reach about 0.2 m above a 1.25–1.37 m
 * head bone.
 */
export const REFERENCE_TOP_OVER_HEAD_BONE = 1.15;

/**
 * Share of a vertex's skin weight on the head and eye bones that makes it
 * part of the head. Hair and other spring bones under the head do not count,
 * so long hair does not stretch the head down the body.
 */
const HEAD_VERTEX_SHARE = 0.5;
const HEAD_CLASSES = new Set(["head", "eye_left", "eye_right"]);

/** What {@link measureAvatarProportions} found for one VRM. */
export type AvatarProportions = {
  /**
   * The head's bounds, in the normalized head bone's space at load: every
   * vertex skinned mainly to the head or eye bones ({@link measureHeadBounds}),
   * accessories skinned to the head included. Head art keeps clear of it.
   * Null without a head bone or head vertices, and on adult proportions with
   * a registered face, where nothing reads it (so it is not measured).
   */
  headBox: THREE.Box3 | null;
  /**
   * What `headSize` measures: the registered face, the head box standing in
   * for it, or nothing.
   */
  measuredFrom: "face" | "head_box" | null;
  /** The face's (or head box's) larger extent, height or width (m); 0 unmeasured. */
  headSize: number;
  /**
   * `headSize` over the Included Avatars' ({@link REFERENCE_FACE_SIZE} or
   * {@link REFERENCE_HEAD_SIZE}); 1 unmeasured. Big-headed Avatars size and
   * place head art, head contacts and camera framing by it.
   */
  headScale: number;
  /** `avatarScale` (head bone above the feet over 1.25 m); 1 without feet. */
  avatarScale: number;
  /** {@link bodyEffectScale} of `avatarScale`: 1 at the Included sizes. */
  bodyScale: number;
  /**
   * How far the head outgrows adult proportions, 0–1 ({@link BIG_HEAD_SHARE}):
   * 0 keeps body-sized placement, 1 places by the head's own size.
   */
  bigHead: number;
  /**
   * The body's rest landmarks and limb lengths, which place body effects on a
   * big head's body; null without hips, head or feet, or on adult proportions,
   * where nothing reads them (so they are not measured).
   */
  body: AvatarBody | null;
};

/** Proportions that change nothing: the Included Avatars' placement. */
export const NEUTRAL_AVATAR_PROPORTIONS: AvatarProportions = Object.freeze({
  headBox: null,
  measuredFrom: null,
  headSize: 0,
  headScale: 1,
  avatarScale: 1,
  bodyScale: 1,
  bigHead: 0,
  body: null,
});

/** The head box, measured at most once per VRM, when first read (the costly part). */
const headBoxes = new WeakMap<VRM, THREE.Box3 | null>();
/**
 * The meshes each VRM showed when its proportions were first asked for (at
 * load), so a head box measured later, after a face correction, leaves out
 * effect geometry and keeps meshes an effect has hidden, as at load.
 */
const modelMeshes = new WeakMap<VRM, readonly THREE.Mesh[]>();
/** Face sizes `Avatar` registered, per VRM. */
const faceSizes = new WeakMap<VRM, number>();
const measured = new WeakMap<VRM, AvatarProportions>();

/** Record `vrm`'s visible meshes, once: a cheap walk, unlike the head box. */
function rememberModelMeshes(vrm: VRM): void {
  if (modelMeshes.has(vrm)) return;
  const meshes: THREE.Mesh[] = [];
  // A stand-in VRM without a scene (as some tests build) records none.
  vrm.scene?.traverseVisible((object) => {
    if (object instanceof THREE.Mesh) meshes.push(object);
  });
  modelMeshes.set(vrm, meshes);
}

/**
 * Register the face `Avatar` measured for `vrm` (in the normalized head
 * bone's space; null when it found none), so proportions follow the face
 * rather than the head box. Called whenever the face is (re)measured: at load
 * and after a face part correction.
 */
export function setAvatarFaceSize(vrm: VRM, face: THREE.Box3 | null): void {
  rememberModelMeshes(vrm);
  const size =
    face && !face.isEmpty() ? face.getSize(new THREE.Vector3()) : null;
  if (size && Math.max(size.x, size.y) > 0) {
    faceSizes.set(vrm, Math.max(size.x, size.y));
  } else {
    faceSizes.delete(vrm);
  }
  measured.delete(vrm);
}

/**
 * The proportions of `vrm`, measured the first time they are asked for and
 * kept for that VRM until its face is registered again. `Avatar` measures at
 * load, before any effect changes the model; a clip prepared first (for its
 * contacts) may trigger the head box measurement earlier, from the loaded
 * pose. The head box is measured only when read: without a registered face,
 * or for a big one. Without a VRM, and for what a model lacks (feet, a face
 * or head vertices), the values of {@link NEUTRAL_AVATAR_PROPORTIONS} apply.
 */
export function measureAvatarProportions(
  vrm: VRM | null | undefined,
): AvatarProportions {
  if (!vrm) return NEUTRAL_AVATAR_PROPORTIONS;
  rememberModelMeshes(vrm);
  let proportions = measured.get(vrm);
  if (!proportions) {
    proportions = computeProportions(vrm);
    measured.set(vrm, proportions);
  }
  return proportions;
}

function computeProportions(vrm: VRM): AvatarProportions {
  const skeleton = canonicalSkeletonOf(vrm);
  const size = skeleton ? avatarScaleOf(skeleton) : null;
  const face = faceSizes.get(vrm);
  // The head box is the costly part. Only a missing face (it stands in) and
  // a big head (head art keeps clear of its top) read it; every other use
  // goes through `headSized` at weight 0, so an adult face skips the measure.
  const faceBigHead = face ? bigHeadWeight(face, size) : 0;
  const headBox = !face || faceBigHead > 0 ? headBoxOf(vrm) : null;
  const boxSize = headBox
    ? Math.max(headBox.max.y - headBox.min.y, headBox.max.x - headBox.min.x)
    : 0;
  const measuredFrom = face ? "face" : headBox ? "head_box" : null;
  const headSize = face ?? boxSize;
  const bigHead = face ? faceBigHead : bigHeadWeight(headSize, size);
  return {
    headBox,
    measuredFrom,
    headSize,
    headScale:
      measuredFrom === "face"
        ? headSize / REFERENCE_FACE_SIZE
        : measuredFrom === "head_box"
          ? headSize / REFERENCE_HEAD_SIZE
          : 1,
    avatarScale: size ?? 1,
    bodyScale: size ? bodyEffectScale(size) : 1,
    bigHead,
    body: skeleton && size && bigHead > 0 ? measureBody(skeleton) : null,
  };
}

/**
 * The big-head weight ({@link BIG_HEAD_SHARE}) of a face or head box
 * `headSize` metres across on a model whose `avatarScale` is `size` (null
 * without feet: 0).
 */
function bigHeadWeight(headSize: number, size: number | null): number {
  // The head bone's height above the feet, which `avatarScale` measures.
  const share = size ? headSize / (size * CONTACT_REFERENCE_HEIGHT) : 0;
  return THREE.MathUtils.clamp(
    (share - BIG_HEAD_SHARE.start) /
      (BIG_HEAD_SHARE.full - BIG_HEAD_SHARE.start),
    0,
    1,
  );
}

/** `vrm`'s head box, measured once; null (logged) when it cannot be. */
function headBoxOf(vrm: VRM): THREE.Box3 | null {
  if (headBoxes.has(vrm)) return headBoxes.get(vrm) ?? null;
  let box: THREE.Box3 | null = null;
  try {
    const head = vrm.humanoid?.getNormalizedBoneNode("head") ?? null;
    box = head ? measureHeadBounds(vrm, head, modelMeshes.get(vrm)) : null;
  } catch (error) {
    // An unusual model keeps body-sized placement, said once per model.
    logger.warn(
      "Measure",
      "Unable to measure the head; head art keeps body-sized placement",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
  headBoxes.set(vrm, box);
  return box;
}

/** `vrm`'s rest skeleton, or null without hips, head or feet. */
function canonicalSkeletonOf(vrm: VRM): CanonicalSkeleton | null {
  const humanoid = vrm.humanoid;
  if (
    !humanoid?.getNormalizedBoneNode("hips") ||
    !humanoid.getNormalizedBoneNode("head") ||
    !humanoid.getNormalizedBoneNode("leftFoot")
  ) {
    return null;
  }
  return new CanonicalSkeleton(vrm);
}

/**
 * `avatarScale` of `skeleton`, or null with no positive head height (a
 * malformed rig with its head at or below its feet).
 */
function avatarScaleOf(skeleton: CanonicalSkeleton): number | null {
  const size = avatarScale(skeleton);
  return Number.isFinite(size) && size > 0 ? size : null;
}

/** Each landmark's bones: one, or a pair whose heights are averaged. */
const LANDMARK_BONES: Record<
  Exclude<BodyLandmark, "ground">,
  readonly VRMHumanBoneName[]
> = {
  neck: ["neck"],
  shoulders: ["leftUpperArm", "rightUpperArm"],
  upperChest: ["upperChest"],
  chest: ["chest"],
  spine: ["spine"],
  hips: ["hips"],
  feet: ["leftFoot", "rightFoot"],
};

/** `skeleton`'s {@link AvatarBody}; its head is above its feet. */
function measureBody(skeleton: CanonicalSkeleton): AvatarBody {
  const headY = skeleton.restPosition("head")!.y;
  const heights: Partial<Record<BodyLandmark, number>> = {};
  // Top down, keeping only landmarks below the one above, so heights fall.
  let above = 0;
  for (const landmark of BODY_LANDMARKS) {
    let height: number | null;
    if (landmark === "ground") {
      height = -headY;
    } else {
      const ys = LANDMARK_BONES[landmark]
        .map((bone) => skeleton.restPosition(bone)?.y)
        .filter((y): y is number => y !== undefined);
      height = ys.length
        ? ys.reduce((sum, y) => sum + y, 0) / ys.length - headY
        : null;
    }
    if (height === null || !(height < above)) continue;
    heights[landmark] = height;
    above = height;
  }
  const halfWidth = (left: VRMHumanBoneName, right: VRMHumanBoneName) => {
    const a = skeleton.restPosition(left);
    const b = skeleton.restPosition(right);
    return a && b ? Math.abs(a.x - b.x) / 2 : null;
  };
  const shoulders = halfWidth("leftUpperArm", "rightUpperArm");
  const hips = halfWidth("leftUpperLeg", "rightUpperLeg");
  const spineBones: Partial<Record<SpineBone, number>> = {};
  for (const bone of SPINE_BONES) {
    const position = skeleton.restPosition(bone);
    if (position) spineBones[bone] = position.y - headY;
  }
  return {
    heights,
    spineBones,
    torsoWidth: shoulders && hips ? shoulders + hips : null,
    armLength: limbLength(skeleton, ["UpperArm", "LowerArm", "Hand"]),
    legLength: limbLength(skeleton, ["UpperLeg", "LowerLeg", "Foot"]),
  };
}

/**
 * The longer side's rest length along a limb's bones (`left`/`right` plus
 * each part), or null when neither side has them all.
 */
function limbLength(
  skeleton: CanonicalSkeleton,
  parts: readonly string[],
): number | null {
  let longest: number | null = null;
  for (const side of ["left", "right"]) {
    const points = parts.map((part) =>
      skeleton.restPosition(`${side}${part}` as VRMHumanBoneName),
    );
    if (points.some((point) => !point)) continue;
    let length = 0;
    for (let at = 1; at < points.length; at += 1)
      length += points[at]!.distanceTo(points[at - 1]!);
    if (length > 0 && (longest === null || length > longest)) longest = length;
  }
  return longest;
}

/**
 * The height below `proportions`' head bone that a point `height` metres
 * from the Included Avatars' head bone corresponds to: between two of their
 * {@link REFERENCE_AVATAR_BODY} landmarks, the same share of the way between
 * this body's; past the lowest, by the body's size; above the head bone, by
 * the head's ({@link AvatarProportions.headScale}). Without measured
 * landmarks, `height` times the body's size.
 */
export function bodyHeightFromReference(
  proportions: AvatarProportions,
  height: number,
): number {
  if (height >= 0) return height * proportions.headScale;
  const measured = proportions.body?.heights ?? {};
  let reference = 0;
  let placed = 0;
  for (const landmark of BODY_LANDMARKS) {
    const to = measured[landmark];
    if (to === undefined) continue;
    const from = REFERENCE_AVATAR_BODY.heights[landmark];
    if (height >= from) {
      return (
        placed + ((height - reference) / (from - reference)) * (to - placed)
      );
    }
    reference = from;
    placed = to;
  }
  return placed + (height - reference) * proportions.bodyScale;
}

/**
 * A size for head-placed things on Avatar `proportions`: `bodySized` (what
 * they use today, from the body or authored metres) for adult proportions,
 * `headSized` for a fully big head, and in between on the ramp. Exactly
 * `bodySized` on the Included Avatars.
 */
export function headSized(
  proportions: AvatarProportions,
  bodySized: number,
  headSized: number,
): number {
  const weight = proportions.bigHead;
  if (weight <= 0) return bodySized;
  if (weight >= 1) return headSized;
  return bodySized + (headSized - bodySized) * weight;
}

/**
 * How much larger than the Included Avatars' framing a camera frames the
 * head of an Avatar of `proportions`: the body's size ({@link bodyEffectScale},
 * 1 for the Included Avatars) for adult proportions, a big head's face size
 * over theirs, ramping between.
 */
export function headFramingScale(proportions: AvatarProportions): number {
  return headSized(proportions, proportions.bodyScale, proportions.headScale);
}

/**
 * Where a camera framing the head aims, in metres above the head bone: 0 for
 * adult proportions (the head bone), a big head's centre (its head box's,
 * hat included), ramping between. A chibi's face and hat rise far above the
 * head bone at the skull's base.
 */
export function headFramingCenter(proportions: AvatarProportions): number {
  const box = proportions.headBox;
  return headSized(proportions, 0, box ? (box.min.y + box.max.y) / 2 : 0);
}

/**
 * How much larger than the Included Avatars' framing a camera frames the
 * whole body of an Avatar of `proportions`: the body's size for adult
 * proportions, and for a big head its height to the top of the head box
 * against the Included Avatars' ({@link REFERENCE_TOP_OVER_HEAD_BONE}), so
 * the head stays in view, ramping between.
 */
export function bodyFramingScale(proportions: AvatarProportions): number {
  const headY = proportions.avatarScale * CONTACT_REFERENCE_HEIGHT;
  const top = headY + Math.max(0, proportions.headBox?.max.y ?? 0);
  return headSized(
    proportions,
    proportions.bodyScale,
    Math.max(headY, top / REFERENCE_TOP_OVER_HEAD_BONE) /
      CONTACT_REFERENCE_HEIGHT,
  );
}

/**
 * The bounds, in `space`'s frame, of every visible vertex of `vrm` skinned
 * mainly to the head or eye bones ({@link HEAD_VERTEX_SHARE}), as posed now.
 * An unskinned mesh counts when it hangs below the head. Null without a head
 * bone or head vertices. Measure before effects apply, so effect geometry is
 * not part of it, or pass the model's own `meshes` (recorded before effects
 * applied) to measure only those, visible or not now. The review renders
 * (`effects:render`) judge "on the head" by the same box.
 */
export function measureHeadBounds(
  vrm: VRM,
  space: THREE.Object3D,
  meshes?: readonly THREE.Mesh[],
): THREE.Box3 | null {
  if (!vrm.humanoid?.getRawBoneNode("head")) return null;
  const classify = createBoneClassifier(vrm);
  const isHead = (node: THREE.Object3D | null) =>
    HEAD_CLASSES.has(classify(node));
  vrm.scene.updateMatrixWorld(true);
  space.updateWorldMatrix(true, false);
  const toSpace = space.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const point = new THREE.Vector3();
  const addHeadVertices = (object: THREE.Object3D) => {
    if (!(object instanceof THREE.Mesh)) return;
    const geometry = object.geometry as THREE.BufferGeometry;
    const position = geometry.getAttribute("position");
    if (!position) return;
    const skinIndex = geometry.getAttribute("skinIndex");
    const skinWeight = geometry.getAttribute("skinWeight");
    const skinned =
      object instanceof THREE.SkinnedMesh && skinIndex && skinWeight
        ? object
        : null;
    if (!skinned && !isHead(object.parent)) return;
    const bones = skinned?.skeleton.bones ?? [];
    // Classify each bone once; vertices only read the results. A skinned
    // mesh with no head or eye bone (the body, clothes) has no head vertex.
    const headBones = bones.map((bone) => isHead(bone));
    if (skinned && !headBones.some(Boolean)) return;
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      if (skinned) {
        let total = 0;
        let head = 0;
        for (let slot = 0; slot < skinIndex.itemSize; slot += 1) {
          const weight = skinWeight.getComponent(vertex, slot);
          if (weight <= 0) continue;
          total += weight;
          if (headBones[skinIndex.getComponent(vertex, slot)]) head += weight;
        }
        if (total <= 0 || head / total < HEAD_VERTEX_SHARE) continue;
      }
      // Skinning and morphs as they are now, in the mesh's space.
      object.getVertexPosition(vertex, point);
      box.expandByPoint(
        point.applyMatrix4(object.matrixWorld).applyMatrix4(toSpace),
      );
    }
  };
  if (meshes) meshes.forEach(addHeadVertices);
  else vrm.scene.traverseVisible(addHeadVertices);
  return box.isEmpty() ? null : box;
}
