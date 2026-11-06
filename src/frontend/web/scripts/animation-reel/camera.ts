import * as THREE from "three";

import type { Avatar } from "@/lib/avatar";
import {
  DEFAULT_PIP_SCENE_CAMERA_PRESET,
  isSceneCameraPreset,
} from "@/ui/main/canvas/sceneCameraPresets";

import { placeCamera } from "../effect-render/session";
import { chatCameraFraming, type Framing } from "../effect-render/stage";
import {
  STAGE_STOPS,
  TALL_ASPECT,
  type StageCamera,
} from "../landing-stage/stops";

/*
 * Camera framings shared by the reel recorder (`reel.ts`) and the live combo
 * page (`../animation-combo/combo.ts`).
 */

/**
 * A camera: a chat preset, `pip` (the desktop PiP window's default preset),
 * `face` (a face close-up that follows the head, as review sheets draw it),
 * `landing` / `landing:<stop>` (a landing page stop's framing; `landing` is
 * the hero close-up), a landing-style framing whose fields override the
 * hero close-up's, a fixed camera, or a moving camera's keys.
 */
export type ReelCamera =
  | string
  | Partial<StageCamera>
  | ReelFixedCamera
  | { keys: ReelCameraKey[] };

/** How a root or camera key is eased into from the key before. */
export type ReelEase = "linear" | "in" | "out" | "inOut";

export const REEL_EASE: Record<ReelEase, (u: number) => number> = {
  linear: (u) => u,
  in: (u) => u * u * u,
  out: (u) => 1 - (1 - u) ** 3,
  inOut: (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2),
};

/** A key of a moving camera: a fixed camera at take time `at`, eased into. */
export type ReelCameraKey = ReelFixedCamera & {
  at: number;
  ease?: ReelEase;
};

/** A camera standing still in the scene, whatever the Avatar's size. */
export type ReelFixedCamera = {
  position: [number, number, number];
  target: [number, number, number];
  fov?: number;
  shift?: number;
  lift?: number;
};

/** Where a camera stands, plus a landing framing's lens shift (frame shares). */
export type ReelCameraView = {
  framing: Framing;
  offset: { shift: number; lift: number } | null;
  /** Follow the head in a face close-up instead of standing still. */
  face?: boolean;
};

type Size = { width: number; height: number };

/** Head bone height of the Avatar as it stands: the landing camera's unit. */
function headHeight(avatar: Avatar): number {
  const head = avatar.vrm?.humanoid.getRawBoneNode("head");
  if (!head) throw new Error("The Avatar has no head bone to frame.");
  return head.getWorldPosition(new THREE.Vector3()).y;
}

/**
 * Where the camera stands for `camera`: a chat preset, `pip`, a landing
 * page stop placed as `landing-stage/stage.ts` places it (orbit, aim and
 * distance in head heights, the stop's tall framing on a tall frame) with
 * its lens shift, a fixed camera, or a moving camera's first key.
 */
export function cameraView(
  avatar: Avatar,
  camera: ReelCamera,
  { width, height }: Size,
): ReelCameraView {
  if (typeof camera === "object" && "keys" in camera)
    return fixedView(camera.keys[0]!);
  if (typeof camera === "object" && "position" in camera)
    return fixedView(camera as ReelFixedCamera);
  if (typeof camera === "object") {
    const hero = STAGE_STOPS.find(({ id }) => id === "hero")!;
    return landingView(avatar, {
      ...hero.camera,
      ...(camera as Partial<StageCamera>),
    });
  }
  if (camera === "face")
    return {
      framing: chatCameraFraming(avatar, "portrait"),
      offset: null,
      face: true,
    };
  if (camera === "pip")
    return {
      framing: chatCameraFraming(avatar, DEFAULT_PIP_SCENE_CAMERA_PRESET),
      offset: null,
    };
  if (isSceneCameraPreset(camera))
    return { framing: chatCameraFraming(avatar, camera), offset: null };
  const stopId = /^landing(?::(.+))?$/.exec(camera);
  const stop =
    stopId && STAGE_STOPS.find(({ id }) => id === (stopId[1] ?? "hero"));
  if (!stop)
    throw new Error(
      `Unknown camera ${camera}; landing stops are ${STAGE_STOPS.map(({ id }) => id).join(", ")}.`,
    );
  return landingView(
    avatar,
    width / height < TALL_ASPECT
      ? { ...stop.camera, ...stop.tall }
      : stop.camera,
  );
}

/** A landing-style framing: orbit, aim and distance in head heights. */
function landingView(avatar: Avatar, view: StageCamera): ReelCameraView {
  const unit = headHeight(avatar);
  const yaw = THREE.MathUtils.degToRad(view.yaw);
  const target = new THREE.Vector3(0, view.aim * unit, 0);
  return {
    framing: {
      position: new THREE.Vector3(
        Math.sin(yaw) * view.distance * unit,
        target.y + view.rise * unit,
        Math.cos(yaw) * view.distance * unit,
      ),
      target,
      fov: view.fov,
    },
    offset: { shift: view.shift, lift: view.lift },
  };
}

/** A camera standing at `position`, looking at `target`, in metres. */
function fixedView(fixed: ReelFixedCamera) {
  return {
    framing: {
      position: new THREE.Vector3(...fixed.position),
      target: new THREE.Vector3(...fixed.target),
      fov: fixed.fov ?? 35,
    },
    offset: { shift: fixed.shift ?? 0, lift: fixed.lift ?? 0 },
  };
}

/** A moving camera at take time `time`: eased between its keys. */
export function cameraAt(
  keys: readonly ReelCameraKey[],
  time: number,
): ReelCameraView {
  const next = keys.findIndex((key) => key.at > time);
  if (next === -1 || next === 0)
    return fixedView(keys[next === 0 ? 0 : keys.length - 1]!);
  const a = fixedView(keys[next - 1]!);
  const b = fixedView(keys[next]!);
  const key = keys[next]!;
  const u = REEL_EASE[key.ease ?? "linear"](
    (time - keys[next - 1]!.at) / (key.at - keys[next - 1]!.at),
  );
  // The lens zooms evenly: its scale (1 / tan of half the fov) moves linearly.
  const zoom = (fov: number) => 1 / Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  const scale =
    zoom(a.framing.fov) + (zoom(b.framing.fov) - zoom(a.framing.fov)) * u;
  return {
    framing: {
      position: a.framing.position.clone().lerp(b.framing.position, u),
      target: a.framing.target.clone().lerp(b.framing.target, u),
      fov: THREE.MathUtils.radToDeg(2 * Math.atan(1 / scale)),
    },
    offset: {
      shift: a.offset.shift + (b.offset.shift - a.offset.shift) * u,
      lift: a.offset.lift + (b.offset.lift - a.offset.lift) * u,
    },
  };
}

/** Place `camera` for a view, with its lens shift, on a `size` frame. */
export function placeReelCamera(
  camera: THREE.PerspectiveCamera,
  avatar: Avatar,
  { framing, offset, face }: ReelCameraView,
  { width, height }: Size,
): void {
  placeCamera(camera, face ? "face" : "front", avatar, framing);
  if (offset)
    // A negative x offset moves the subject right; a positive y offset, up.
    camera.setViewOffset(
      width,
      height,
      -offset.shift * width,
      offset.lift * height,
      width,
      height,
    );
  else camera.clearViewOffset();
}
