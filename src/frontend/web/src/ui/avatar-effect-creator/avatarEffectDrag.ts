import * as THREE from "three";

import type {
  AvatarEffectEditorAttachment,
  AvatarEffectEditorAttachmentPatch,
} from "@/lib/avatar/vfx/editor";
import type { AvatarVFXManipulationFrame } from "@/lib/avatar/vfx/placement-guide-types";
import {
  placementOffsetPatch,
  placementRotationPatch,
  placementScalePatch,
  resolvedPlacement,
  type ResolvedPlacement,
} from "./avatarEffectPlacement";
import {
  handleRotationDelta,
  handleScaleFactor,
  planeDragOffset,
  pointerRay,
  rayCameraPlanePoint,
  rayPlaneLocalPoint,
  raycastSurfaceUv,
  stickerDragOffset,
  surfaceDragOffset,
  type ManipulationHit,
  type ScreenPoint,
} from "./directManipulation";

/** The live view a drag reads: the preview camera and its CSS size. */
export type AvatarEffectDragView = {
  camera: THREE.Camera;
  width: number;
  height: number;
};

/** What a drag changes in the creator; one drag is one undo step. */
export type AvatarEffectDragTarget = {
  beginGroup: () => void;
  endGroup: () => void;
  apply: (patch: AvatarEffectEditorAttachmentPatch) => void;
};

type DragAnchor =
  | { kind: "surface"; uv: { x: number; y: number }; pointerShift: ScreenPoint }
  | { kind: "plane"; local: THREE.Vector3; z: number }
  | { kind: "screen"; world: THREE.Vector3 }
  | { kind: "none" };

type DragState = {
  hit: ManipulationHit;
  pointer: ScreenPoint;
  frame: AvatarVFXManipulationFrame;
  attachment: AvatarEffectEditorAttachment;
  placement: ResolvedPlacement;
  anchor: DragAnchor;
};

/**
 * One direct-manipulation gesture on the preview: moving the art along its
 * attachment, or scaling or turning it with a handle. Each value is computed
 * from the gesture's start, so the art follows the pointer without drift, and
 * the whole gesture is one undo group.
 */
export class AvatarEffectDragSession {
  private readonly _state: DragState;
  private readonly _target: AvatarEffectDragTarget;
  private _ended = false;

  private constructor(state: DragState, target: AvatarEffectDragTarget) {
    this._state = state;
    this._target = target;
    target.beginGroup();
  }

  /** Start a gesture; null when the attachment cannot be manipulated. */
  static begin(args: {
    hit: ManipulationHit;
    pointer: ScreenPoint;
    frame: AvatarVFXManipulationFrame;
    attachment: AvatarEffectEditorAttachment;
    view: AvatarEffectDragView;
    target: AvatarEffectDragTarget;
  }): AvatarEffectDragSession | null {
    const placement = resolvedPlacement(args.attachment);
    if (!placement) return null;
    const anchor =
      args.hit.mode === "move"
        ? moveAnchor(args.frame, args.hit, args.pointer, args.view)
        : { kind: "none" as const };
    if (args.hit.mode === "move" && anchor.kind === "none") return null;
    return new AvatarEffectDragSession(
      {
        hit: args.hit,
        pointer: args.pointer,
        frame: args.frame,
        attachment: args.attachment,
        placement,
        anchor,
      },
      args.target,
    );
  }

  /** Apply the gesture at `pointer`; false when it cannot be resolved there. */
  move(pointer: ScreenPoint, view: AvatarEffectDragView): boolean {
    if (this._ended) return false;
    const patch = this.patchAt(pointer, view);
    if (!patch) return false;
    this._target.apply(patch);
    return true;
  }

  /** Close the undo group. Safe to call more than once. */
  end(): void {
    if (this._ended) return;
    this._ended = true;
    this._target.endGroup();
  }

  /** The attachment change for the pointer at `pointer`, from the gesture's start. */
  patchAt(
    pointer: ScreenPoint,
    view: AvatarEffectDragView,
  ): AvatarEffectEditorAttachmentPatch | null {
    const { hit, attachment, placement, frame, anchor } = this._state;
    if (hit.mode === "scale") {
      return placementScalePatch(
        attachment,
        placement,
        handleScaleFactor(hit.placement.center, this._state.pointer, pointer),
      );
    }
    if (hit.mode === "rotate") {
      return placementRotationPatch(
        attachment,
        placement.rotationDeg +
          handleRotationDelta({
            placement: hit.placement,
            start: this._state.pointer,
            current: pointer,
          }),
      );
    }
    const ray = (point: ScreenPoint) =>
      pointerRay(point, view.camera, view.width, view.height);
    if (anchor.kind === "surface" && frame.surface) {
      const uv = raycastSurfaceUv(
        ray({
          x: pointer.x + anchor.pointerShift.x,
          y: pointer.y + anchor.pointerShift.y,
        }),
        frame.surface,
      );
      if (!uv) return null;
      return placementOffsetPatch(
        attachment,
        surfaceDragOffset({
          startOffset: placement.offset,
          startUv: anchor.uv,
          uv,
          mirrored: hit.placement.mirrored,
        }),
      );
    }
    if (anchor.kind === "plane" && frame.offsetSpace) {
      const local = rayPlaneLocalPoint(
        ray(pointer),
        frame.offsetSpace,
        anchor.z,
      );
      if (!local) return null;
      return placementOffsetPatch(
        attachment,
        planeDragOffset({
          startOffset: placement.offset,
          startLocal: anchor.local,
          local,
          mirrored: hit.placement.mirrored,
        }),
      );
    }
    if (anchor.kind === "screen" && frame.unitLength) {
      const center = frame.placements[hit.placement.index]?.center;
      const world = center
        ? rayCameraPlanePoint(ray(pointer), view.camera, center)
        : null;
      if (!world) return null;
      return placementOffsetPatch(
        attachment,
        stickerDragOffset({
          startOffset: placement.offset,
          startWorld: anchor.world,
          world,
          camera: view.camera,
          unitLength: frame.unitLength,
        }),
      );
    }
    return null;
  }
}

/** Where a move gesture grabbed the art, in the space its offset moves in. */
function moveAnchor(
  frame: AvatarVFXManipulationFrame,
  hit: ManipulationHit,
  pointer: ScreenPoint,
  view: AvatarEffectDragView,
): DragAnchor {
  const ray = (point: ScreenPoint) =>
    pointerRay(point, view.camera, view.width, view.height);
  const center = frame.placements[hit.placement.index]?.center;
  if (frame.attachment === "face_surface" && frame.surface) {
    const uv = raycastSurfaceUv(ray(pointer), frame.surface);
    if (uv) return { kind: "surface", uv, pointerShift: { x: 0, y: 0 } };
    // Art can extend past the face; grab it by its centre instead.
    const shift = {
      x: hit.placement.center.x - pointer.x,
      y: hit.placement.center.y - pointer.y,
    };
    const centreUv = raycastSurfaceUv(ray(hit.placement.center), frame.surface);
    return centreUv
      ? { kind: "surface", uv: centreUv, pointerShift: shift }
      : { kind: "none" };
  }
  if (
    (frame.attachment === "face_landmark" || frame.attachment === "body") &&
    frame.offsetSpace &&
    center
  ) {
    const z = center.clone().applyMatrix4(frame.offsetSpace.clone().invert()).z;
    const local = rayPlaneLocalPoint(ray(pointer), frame.offsetSpace, z);
    return local ? { kind: "plane", local, z } : { kind: "none" };
  }
  if (frame.attachment === "sticker" && center) {
    const world = rayCameraPlanePoint(ray(pointer), view.camera, center);
    return world ? { kind: "screen", world } : { kind: "none" };
  }
  return { kind: "none" };
}
