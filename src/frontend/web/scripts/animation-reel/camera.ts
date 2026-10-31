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
 * the hero close-up), or a landing-style framing whose fields override the
 * hero close-up's.
 */
export type ReelCamera = string | Partial<StageCamera>;

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
 * Where the camera stands for `camera`: a chat preset, `pip`, or a landing
 * page stop placed as `landing-stage/stage.ts` places it (orbit, aim and
 * distance in head heights, the stop's tall framing on a tall frame) with
 * its lens shift.
 */
export function cameraView(
  avatar: Avatar,
  camera: ReelCamera,
  { width, height }: Size,
): ReelCameraView {
  if (typeof camera === "object") {
    const hero = STAGE_STOPS.find(({ id }) => id === "hero")!;
    return landingView(avatar, { ...hero.camera, ...camera });
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
