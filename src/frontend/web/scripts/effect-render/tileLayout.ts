import * as THREE from "three";

import type { Avatar } from "@/lib/avatar";
import { ATTACHMENT_PLANE_NAME_PREFIX } from "@/lib/avatar/vfx/AvatarAttachmentEffects";
import { createBoneClassifier } from "@/lib/avatar/vfx/faceParts";

/*
 * Where the Avatar is in a review tile, for checking where an effect's art
 * lands (`effect-render.mjs`): the head's rect, from a box around the
 * vertices skinned mainly to the head, kept in head-bone space so it follows
 * the head through a Gesture or Reaction, and the body and sticker art in
 * view.
 */

/** Tile pixels `[x0, x1) × [y0, y1)`, from the tile's top-left corner. */
export type PixelRect = { x0: number; y0: number; x1: number; y1: number };

/** The head bone and the head's bounds in that bone's space. */
export type HeadBox = { bone: THREE.Object3D; box: THREE.Box3 };

/**
 * Where the Avatar is in one tile: the head's rect (null without a head box)
 * and the effect IDs (as the effect controller's snapshot names them) of
 * body and sticker art whose centre is in view.
 */
export type TileLayout = {
  headRect: PixelRect | null;
  artInView: string[];
};

/**
 * Share of a vertex's skin weight on the head and eye bones that makes it
 * part of the head. Hair and other spring bones under the head do not count,
 * so long hair does not stretch the head down the body.
 */
const HEAD_VERTEX_SHARE = 0.5;

const HEAD_CLASSES = new Set(["head", "eye_left", "eye_right"]);

/**
 * Measure the head box of `avatar` in its current pose: the bounds, in raw
 * head-bone space, of every visible vertex skinned mainly to the head or eye
 * bones (an unskinned mesh counts when it hangs below the head). Measure
 * before effects apply, so effect geometry is not part of it. Null without a
 * head bone or head vertices.
 */
export function measureHeadBox(avatar: Avatar): HeadBox | null {
  const vrm = avatar.vrm;
  const bone = vrm?.humanoid.getRawBoneNode("head") ?? null;
  if (!vrm || !bone) return null;
  const classify = createBoneClassifier(vrm);
  const isHead = (node: THREE.Object3D | null) =>
    HEAD_CLASSES.has(classify(node));
  vrm.scene.updateMatrixWorld(true);
  const toHead = bone.matrixWorld.clone().invert();
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
    for (let vertex = 0; vertex < position.count; vertex += 1) {
      if (skinned) {
        let total = 0;
        let head = 0;
        for (let slot = 0; slot < skinIndex.itemSize; slot += 1) {
          const weight = skinWeight.getComponent(vertex, slot);
          if (weight <= 0) continue;
          total += weight;
          if (isHead(bones[skinIndex.getComponent(vertex, slot)] ?? null))
            head += weight;
        }
        if (total <= 0 || head / total < HEAD_VERTEX_SHARE) continue;
      }
      // Skinning and morphs as they are now, in the mesh's space.
      object.getVertexPosition(vertex, point);
      box.expandByPoint(
        point.applyMatrix4(object.matrixWorld).applyMatrix4(toHead),
      );
    }
  });
  return box.isEmpty() ? null : { bone, box };
}

/** Whether `point` (world space) is in front of `camera`. */
function inFront(point: THREE.Vector3, camera: THREE.Camera): boolean {
  // Camera space looks down -z.
  return point.clone().applyMatrix4(camera.matrixWorldInverse).z < 0;
}

/**
 * The head box's corners as `camera` sees them now, bounded as a rect of the
 * `width × height` tile and clipped to it. The whole tile when a corner is
 * behind the camera (its projection would be meaningless).
 */
function projectHeadBox(
  head: HeadBox,
  camera: THREE.Camera,
  width: number,
  height: number,
): PixelRect {
  head.bone.updateWorldMatrix(true, false);
  const { min, max } = head.box;
  const corner = new THREE.Vector3();
  const rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (let index = 0; index < 8; index += 1) {
    corner
      .set(
        index & 1 ? max.x : min.x,
        index & 2 ? max.y : min.y,
        index & 4 ? max.z : min.z,
      )
      .applyMatrix4(head.bone.matrixWorld);
    if (!inFront(corner, camera))
      return { x0: 0, y0: 0, x1: width, y1: height };
    corner.project(camera);
    const x = ((corner.x + 1) / 2) * width;
    const y = ((1 - corner.y) / 2) * height;
    rect.x0 = Math.min(rect.x0, x);
    rect.x1 = Math.max(rect.x1, x);
    rect.y0 = Math.min(rect.y0, y);
    rect.y1 = Math.max(rect.y1, y);
  }
  const clamp = (value: number, limit: number) =>
    Math.min(limit, Math.max(0, value));
  return {
    x0: clamp(Math.floor(rect.x0), width),
    y0: clamp(Math.floor(rect.y0), height),
    x1: clamp(Math.ceil(rect.x1), width),
    y1: clamp(Math.ceil(rect.y1), height),
  };
}

/** Whether world-space `point` projects inside `camera`'s view. */
function inView(point: THREE.Vector3, camera: THREE.Camera): boolean {
  if (!inFront(point, camera)) return false;
  const ndc = point.clone().project(camera);
  return Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1;
}

/**
 * Where `avatar` is in the `width × height` tile `camera` has just drawn:
 * the projected head box (`head`, null without one) and the body and sticker
 * art whose plane centre, as drawn, is in view. Art centred outside every
 * tile, such as a hand's art hanging below the frame in the rest pose,
 * cannot show there.
 */
export function measureTileLayout(
  avatar: Avatar,
  head: HeadBox | null,
  camera: THREE.Camera,
  width: number,
  height: number,
): TileLayout {
  camera.updateMatrixWorld();
  const effectIds = new Map(
    avatar.vfxController
      ?.getSnapshot()
      .attachmentEffects.map((effect) => [
        effect.appliedEffectId,
        effect.effectId,
      ]) ?? [],
  );
  const artInView = new Set<string>();
  const centre = new THREE.Vector3();
  avatar.scene?.traverseVisible((object) => {
    if (!object.name.startsWith(ATTACHMENT_PLANE_NAME_PREFIX)) return;
    const effectId = effectIds.get(
      object.name.slice(ATTACHMENT_PLANE_NAME_PREFIX.length),
    );
    // A sticker's plane is placed for the camera as it draws.
    if (
      effectId &&
      inView(centre.setFromMatrixPosition(object.matrixWorld), camera)
    )
      artInView.add(effectId);
  });
  return {
    headRect: head ? projectHeadBox(head, camera, width, height) : null,
    artInView: [...artInView],
  };
}
