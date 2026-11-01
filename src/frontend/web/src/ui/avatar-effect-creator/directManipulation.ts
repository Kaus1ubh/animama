import * as THREE from "three";

import type { AvatarVFXManipulationFrame } from "@/lib/avatar/vfx/placement-guide-types";
import {
  baseTextureOf,
  TextureUvMapping,
} from "@/lib/avatar/vfx/textureUvMapping";

/*
 * Screen and drag maths for moving, scaling and turning Avatar Effect art on
 * the creator preview. Everything here is pure: the creator supplies the
 * camera, the pointer and the controller's manipulation frame.
 */

export type ScreenPoint = { x: number; y: number };

/** One drawn copy of the art in CSS pixels, with its handles. */
export type ScreenPlacement = {
  index: number;
  label: string;
  mirrored: boolean;
  rotationSense: 1 | -1;
  /** Top-left, top-right, bottom-right, bottom-left of the image. */
  corners: [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint];
  center: ScreenPoint;
  /** The rotate handle, beyond the middle of the image's top edge. */
  rotateHandle: ScreenPoint;
};

export type ManipulationHit = {
  mode: "move" | "scale" | "rotate";
  placement: ScreenPlacement;
};

/** Distance of the rotate handle beyond the top edge, in CSS pixels. */
export const ROTATE_HANDLE_OFFSET = 28;
/** Pointer radius that grabs a corner or the rotate handle. */
export const HANDLE_HIT_RADIUS = 10;
/**
 * Smallest side of the handle box, in CSS pixels. Art drawn smaller (such as
 * eye art at a narrow width) gets its handles on this box around its centre,
 * so the corners stay apart and grabbable.
 */
export const MIN_HANDLE_BOX = 32;
/** A press this close outside the art still moves it rather than the camera. */
export const ART_GRAB_MARGIN = 12;

/** Project a world point to CSS pixels; null behind the camera. */
export function projectWorldPoint(
  point: THREE.Vector3,
  camera: THREE.Camera,
  width: number,
  height: number,
): ScreenPoint | null {
  const projected = point.clone().project(camera);
  if (
    ![projected.x, projected.y, projected.z].every(Number.isFinite) ||
    projected.z < -1 ||
    projected.z > 1
  )
    return null;
  return {
    x: ((projected.x + 1) * width) / 2,
    y: ((1 - projected.y) * height) / 2,
  };
}

/** A world-space ray through a CSS pixel of the viewport. */
export function pointerRay(
  point: ScreenPoint,
  camera: THREE.Camera,
  width: number,
  height: number,
): THREE.Ray {
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(
    new THREE.Vector2(
      (point.x / Math.max(1, width)) * 2 - 1,
      1 - (point.y / Math.max(1, height)) * 2,
    ),
    camera,
  );
  return raycaster.ray.clone();
}

/** Screen geometry of every placement in a frame; off-screen copies are skipped. */
export function screenPlacements(
  frame: AvatarVFXManipulationFrame,
  camera: THREE.Camera,
  width: number,
  height: number,
): ScreenPlacement[] {
  const result: ScreenPlacement[] = [];
  frame.placements.forEach((placement, index) => {
    const corners = placement.corners.map((corner) =>
      projectWorldPoint(corner, camera, width, height),
    );
    const center = projectWorldPoint(placement.center, camera, width, height);
    if (!center || corners.some((corner) => corner === null)) return;
    const handleCorners = withMinimumSize(
      corners as ScreenPlacement["corners"],
      center,
    );
    const [topLeft, topRight] = handleCorners;
    const top = {
      x: (topLeft!.x + topRight!.x) / 2,
      y: (topLeft!.y + topRight!.y) / 2,
    };
    const away = { x: top.x - center.x, y: top.y - center.y };
    const length = Math.hypot(away.x, away.y) || 1;
    result.push({
      index,
      label: placement.label,
      mirrored: placement.mirrored,
      rotationSense: placement.rotationSense,
      corners: handleCorners,
      center,
      rotateHandle: {
        x: top.x + (away.x / length) * ROTATE_HANDLE_OFFSET,
        y: top.y + (away.y / length) * ROTATE_HANDLE_OFFSET,
      },
    });
  });
  return result;
}

/**
 * The art's corners, or for art smaller than {@link MIN_HANDLE_BOX} on a side,
 * the same box (same centre, turn and handedness) grown to that size.
 */
function withMinimumSize(
  corners: ScreenPlacement["corners"],
  center: ScreenPoint,
): ScreenPlacement["corners"] {
  const [topLeft, topRight, , bottomLeft] = corners;
  const half = (from: ScreenPoint, to: ScreenPoint) => ({
    x: (to.x - from.x) / 2,
    y: (to.y - from.y) / 2,
  });
  const grow = (axis: ScreenPoint, fallback: ScreenPoint) => {
    const length = Math.hypot(axis.x, axis.y);
    const minimum = MIN_HANDLE_BOX / 2;
    if (length >= minimum) return axis;
    if (length < 1e-6)
      return { x: fallback.x * minimum, y: fallback.y * minimum };
    return {
      x: (axis.x / length) * minimum,
      y: (axis.y / length) * minimum,
    };
  };
  const xHalf = half(topLeft, topRight);
  const yHalf = half(topLeft, bottomLeft);
  const x = grow(xHalf, { x: 1, y: 0 });
  const y = grow(yHalf, { x: 0, y: 1 });
  if (x === xHalf && y === yHalf) return corners;
  const at = (sx: number, sy: number) => ({
    x: center.x + sx * x.x + sy * y.x,
    y: center.y + sx * x.y + sy * y.y,
  });
  return [at(-1, -1), at(1, -1), at(1, 1), at(-1, 1)];
}

/** Shortest distance from a point to a segment. */
function distanceToSegment(
  point: ScreenPoint,
  a: ScreenPoint,
  b: ScreenPoint,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared > 0
      ? Math.min(
          1,
          Math.max(
            0,
            ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared,
          ),
        )
      : 0;
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function inside(point: ScreenPoint, polygon: readonly ScreenPoint[]): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      result = !result;
  }
  return result;
}

const distance = (a: ScreenPoint, b: ScreenPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Which handle (if any) is under the pointer: rotate, then corners, then the
 * art, then just outside its edge (within {@link ART_GRAB_MARGIN}), so a press
 * that slightly misses small art still moves it instead of the camera.
 */
export function hitTestManipulation(
  placements: readonly ScreenPlacement[],
  point: ScreenPoint,
  radius = HANDLE_HIT_RADIUS,
): ManipulationHit | null {
  for (const placement of placements) {
    if (distance(point, placement.rotateHandle) <= radius)
      return { mode: "rotate", placement };
    if (placement.corners.some((corner) => distance(point, corner) <= radius))
      return { mode: "scale", placement };
  }
  const placement =
    placements.find((candidate) => inside(point, candidate.corners)) ??
    placements.find((candidate) =>
      candidate.corners.some(
        (corner, index) =>
          distanceToSegment(
            point,
            corner,
            candidate.corners[(index + 1) % candidate.corners.length]!,
          ) <= ART_GRAB_MARGIN,
      ),
    );
  return placement ? { mode: "move", placement } : null;
}

/** Uniform scale factor from dragging a corner relative to the art's centre. */
export function handleScaleFactor(
  center: ScreenPoint,
  start: ScreenPoint,
  current: ScreenPoint,
): number {
  const from = distance(center, start);
  if (from < 1) return 1;
  return Math.max(0.01, distance(center, current) / from);
}

/**
 * The authored rotation change, in degrees, from dragging the rotate handle
 * around the art's centre. Screen angles grow clockwise (y points down); the
 * art's own handedness on screen and its rotation sense set the sign.
 */
export function handleRotationDelta(args: {
  placement: Pick<ScreenPlacement, "center" | "corners" | "rotationSense">;
  start: ScreenPoint;
  current: ScreenPoint;
}): number {
  const { center, corners } = args.placement;
  const angle = (point: ScreenPoint) =>
    Math.atan2(point.y - center.y, point.x - center.x);
  let delta = angle(args.current) - angle(args.start);
  if (delta > Math.PI) delta -= 2 * Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  const [topLeft, topRight, , bottomLeft] = corners;
  const xAxis = { x: topRight.x - topLeft.x, y: topRight.y - topLeft.y };
  const yAxis = { x: bottomLeft.x - topLeft.x, y: bottomLeft.y - topLeft.y };
  const handedness = Math.sign(xAxis.x * yAxis.y - xAxis.y * yAxis.x) || 1;
  return (delta * 180 * args.placement.rotationSense * handedness) / Math.PI;
}

/** Face-surface art: the UV offset after the pointer moved across the face. */
export function surfaceDragOffset(args: {
  startOffset: { x: number; y: number };
  startUv: { x: number; y: number };
  uv: { x: number; y: number };
  /** The effect's own mirrored copy moves its offset the other way. */
  mirrored: boolean;
}): { x: number; y: number } {
  const sign = args.mirrored ? -1 : 1;
  return {
    x: args.startOffset.x + sign * (args.uv.x - args.startUv.x),
    y: args.startOffset.y + (args.uv.y - args.startUv.y),
  };
}

/** Where a ray crosses the plane z = `z` of a frame, in that frame's coordinates. */
export function rayPlaneLocalPoint(
  ray: THREE.Ray,
  frame: THREE.Matrix4,
  z: number,
): THREE.Vector3 | null {
  const local = ray.clone().applyMatrix4(frame.clone().invert());
  const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
  return local.intersectPlane(plane, new THREE.Vector3());
}

/** Landmark and body art: the offset after moving in the frame's x–y plane. */
export function planeDragOffset(args: {
  startOffset: { x: number; y: number; z: number };
  startLocal: { x: number; y: number };
  local: { x: number; y: number };
  mirrored: boolean;
}): { x: number; y: number; z: number } {
  const sign = args.mirrored ? -1 : 1;
  return {
    x: args.startOffset.x + sign * (args.local.x - args.startLocal.x),
    y: args.startOffset.y + (args.local.y - args.startLocal.y),
    z: args.startOffset.z,
  };
}

/** Where a ray crosses the camera-facing plane through `point`. */
export function rayCameraPlanePoint(
  ray: THREE.Ray,
  camera: THREE.Camera,
  point: THREE.Vector3,
): THREE.Vector3 | null {
  const normal = camera.getWorldDirection(new THREE.Vector3());
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, point);
  return ray.intersectPlane(plane, new THREE.Vector3());
}

/** Sticker art: the offset (in avatar heights) after moving in the screen plane. */
export function stickerDragOffset(args: {
  startOffset: { x: number; y: number };
  startWorld: THREE.Vector3;
  world: THREE.Vector3;
  camera: THREE.Camera;
  unitLength: number;
}): { x: number; y: number } {
  const quaternion = args.camera.getWorldQuaternion(new THREE.Quaternion());
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quaternion);
  const moved = args.world.clone().sub(args.startWorld);
  const unit = Math.max(1e-6, args.unitLength);
  return {
    x: args.startOffset.x + moved.dot(right) / unit,
    y: args.startOffset.y + moved.dot(up) / unit,
  };
}

/**
 * Where a ray first meets a mesh's surface, as a position on its texture's
 * image (the UV through the texture's transform, unwrapped so a drag stays
 * continuous), or null.
 */
export function raycastSurfaceUv(
  ray: THREE.Ray,
  mesh: THREE.Mesh,
): { x: number; y: number } | null {
  const raycaster = new THREE.Raycaster(ray.origin, ray.direction);
  const [hit] = raycaster.intersectObject(mesh, false);
  return hit?.uv
    ? TextureUvMapping.of(baseTextureOf(mesh)).transform(hit.uv)
    : null;
}

/** Arrow-key nudge distance in CSS pixels; Shift moves further. */
export function nudgePixels(shift: boolean): number {
  return shift ? 20 : 4;
}

/** The screen direction an arrow key moves the art. */
export function arrowDirection(key: string): ScreenPoint | null {
  switch (key) {
    case "ArrowLeft":
      return { x: -1, y: 0 };
    case "ArrowRight":
      return { x: 1, y: 0 };
    case "ArrowUp":
      return { x: 0, y: -1 };
    case "ArrowDown":
      return { x: 0, y: 1 };
    default:
      return null;
  }
}
