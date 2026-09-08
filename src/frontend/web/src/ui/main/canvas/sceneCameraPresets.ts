"use client";

import type { Avatar } from "@/lib/avatar";

export type SceneVector3 = {
  x: number;
  y: number;
  z: number;
};

export type SceneCameraYBoneBinding = "manual" | "hips" | "chest" | "head";

export type SceneCameraSettings = {
  position: SceneVector3;
  fov: number;
  orbitTarget: SceneVector3;
};

export type SceneCameraBindings = {
  positionYBone: SceneCameraYBoneBinding;
  positionYOffset: number;
  orbitTargetYBone: SceneCameraYBoneBinding;
  orbitTargetYOffset: number;
};

export type SceneCameraPreset =
  | "full-body"
  | "full-body-close"
  | "portrait"
  | "portrait-close";

export type SceneCameraPresetState = {
  bindings: SceneCameraBindings;
  settings: SceneCameraSettings;
};

export function sceneVector3ToArray(
  value: SceneVector3,
): [number, number, number] {
  return [value.x, value.y, value.z];
}

export const DEFAULT_SCENE_CAMERA = {
  position: sceneVector3ToArray({ x: 0, y: 1.2, z: 3.2 }),
  fov: 35,
};

export const DEFAULT_SCENE_ORBIT_TARGET = sceneVector3ToArray({
  x: 0,
  y: 1.0,
  z: 0,
});

export const DEFAULT_SCENE_LIGHTS = {
  ambientIntensity: 0.7,
  directional: [
    {
      position: [3, 4, 2] as const,
      intensity: 1.1,
    },
  ],
};

export function buildSceneCameraPreset(
  preset: SceneCameraPreset,
  options?: {
    avatar?: Avatar | null;
    fallbackSettings?: SceneCameraSettings;
  },
): SceneCameraPresetState {
  const fallbackSettings = options?.fallbackSettings;
  const headY =
    options?.avatar?.getCameraAnchorY("head") ??
    fallbackSettings?.position.y ??
    1.2;

  switch (preset) {
    case "full-body":
      return {
        bindings: {
          positionYBone: "manual",
          positionYOffset: 0,
          orbitTargetYBone: "manual",
          orbitTargetYOffset: 0,
        },
        settings: {
          position: { x: 0, y: 1.2, z: 3.2 },
          fov: 35,
          orbitTarget: { x: 0, y: 1.0, z: 0 },
        },
      };
    case "full-body-close":
      return {
        bindings: {
          positionYBone: "manual",
          positionYOffset: 0,
          orbitTargetYBone: "manual",
          orbitTargetYOffset: 0,
        },
        settings: {
          position: { x: 0, y: 1.2, z: 2.2 },
          fov: 35,
          orbitTarget: { x: 0, y: 1.0, z: 0 },
        },
      };
    case "portrait":
      return {
        bindings: {
          positionYBone: "head",
          positionYOffset: 0,
          orbitTargetYBone: "head",
          orbitTargetYOffset: -0.1,
        },
        settings: {
          // Leave enough headroom for Reaction VFX while retaining a facial
          // expression-focused composition.
          position: { x: 0, y: headY, z: 1.6 },
          fov: 35,
          orbitTarget: { x: 0, y: headY - 0.1, z: 0 },
        },
      };
    case "portrait-close":
      return {
        bindings: {
          positionYBone: "head",
          positionYOffset: 0,
          orbitTargetYBone: "head",
          orbitTargetYOffset: 0,
        },
        settings: {
          position: { x: 0, y: headY, z: 0.8 },
          fov: 35,
          orbitTarget: { x: 0, y: headY, z: 0 },
        },
      };
  }
}
