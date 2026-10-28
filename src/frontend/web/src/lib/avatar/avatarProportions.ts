import type { VRM } from "@pixiv/three-vrm";
import * as THREE from "three";

import { createLogger } from "@/lib/logger";

import { avatarScale, CanonicalSkeleton } from "./poses/anatomy/arms";
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
   * Null without a head bone or head vertices.
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
});

/** The head box, measured once per VRM (the costly part). */
const headBoxes = new WeakMap<VRM, THREE.Box3 | null>();
/** Face sizes `Avatar` registered, per VRM. */
const faceSizes = new WeakMap<VRM, number>();
const measured = new WeakMap<VRM, AvatarProportions>();

/**
 * Register the face `Avatar` measured for `vrm` (in the normalized head
 * bone's space; null when it found none), so proportions follow the face
 * rather than the head box. Called whenever the face is (re)measured: at load
 * and after a face part correction.
 */
export function setAvatarFaceSize(vrm: VRM, face: THREE.Box3 | null): void {
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
 * pose. Without a VRM, and for what a model lacks (feet, a face or head
 * vertices), the values of {@link NEUTRAL_AVATAR_PROPORTIONS} apply.
 */
export function measureAvatarProportions(
  vrm: VRM | null | undefined,
): AvatarProportions {
  if (!vrm) return NEUTRAL_AVATAR_PROPORTIONS;
  let proportions = measured.get(vrm);
  if (!proportions) {
    proportions = computeProportions(vrm);
    measured.set(vrm, proportions);
  }
  return proportions;
}

function computeProportions(vrm: VRM): AvatarProportions {
  const size = measureAvatarScale(vrm);
  const headBox = headBoxOf(vrm);
  const face = faceSizes.get(vrm);
  const boxSize = headBox
    ? Math.max(headBox.max.y - headBox.min.y, headBox.max.x - headBox.min.x)
    : 0;
  const measuredFrom = face ? "face" : headBox ? "head_box" : null;
  const headSize = face ?? boxSize;
  // The head bone's height above the feet, which `avatarScale` measures.
  const share = size ? headSize / (size * 1.25) : 0;
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
    bigHead: THREE.MathUtils.clamp(
      (share - BIG_HEAD_SHARE.start) /
        (BIG_HEAD_SHARE.full - BIG_HEAD_SHARE.start),
      0,
      1,
    ),
  };
}

/** `vrm`'s head box, measured once; null (logged) when it cannot be. */
function headBoxOf(vrm: VRM): THREE.Box3 | null {
  if (headBoxes.has(vrm)) return headBoxes.get(vrm) ?? null;
  let box: THREE.Box3 | null = null;
  try {
    const head = vrm.humanoid?.getNormalizedBoneNode("head") ?? null;
    box = head ? measureHeadBounds(vrm, head) : null;
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

/**
 * `avatarScale` of `vrm`, or null without hips, head or feet, or with no
 * positive head height (a malformed rig with its head at or below its feet).
 */
function measureAvatarScale(vrm: VRM): number | null {
  const humanoid = vrm.humanoid;
  if (
    !humanoid?.getNormalizedBoneNode("hips") ||
    !humanoid.getNormalizedBoneNode("head") ||
    !humanoid.getNormalizedBoneNode("leftFoot")
  ) {
    return null;
  }
  const size = avatarScale(new CanonicalSkeleton(vrm));
  return Number.isFinite(size) && size > 0 ? size : null;
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
 * The bounds, in `space`'s frame, of every visible vertex of `vrm` skinned
 * mainly to the head or eye bones ({@link HEAD_VERTEX_SHARE}), as posed now.
 * An unskinned mesh counts when it hangs below the head. Null without a head
 * bone or head vertices. Measure before effects apply, so effect geometry is
 * not part of it. The review renders (`effects:render`) judge "on the head"
 * by the same box.
 */
export function measureHeadBounds(
  vrm: VRM,
  space: THREE.Object3D,
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
  vrm.scene.traverseVisible((object) => {
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
  });
  return box.isEmpty() ? null : box;
}
