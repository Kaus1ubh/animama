import * as THREE from "three";

import type { Avatar } from "@/lib/avatar";
import {
  applyAvatarToneMapping,
  isEnhancedRenderingEnabled,
} from "@/lib/avatar/enhanced-rendering/enhancedRendering";
import {
  avatarSceneLights,
  buildSceneCameraPreset,
  type SceneCameraPreset,
} from "@/ui/main/canvas/sceneCameraPresets";

/*
 * Stage and effect parsing shared by the review renderer (`render.ts`), the
 * frame-cost benchmark (`../effect-bench/bench.ts`), the headed preview
 * (`../animation-preview/preview.ts`) and the Action reel recorder
 * (`../animation-reel/reel.ts`).
 */

export {
  effectSourceEntry as effectEntry,
  type EffectSource,
} from "@/lib/avatar/vfx/effectSource";

/**
 * Tone mapping and colour output of the chat canvas (`AvatarSceneLighting`):
 * Neutral at a raised exposure with enhanced rendering, otherwise ACES.
 */
export function applyChatColorPipeline(renderer: THREE.WebGLRenderer): void {
  applyAvatarToneMapping(renderer, isEnhancedRenderingEnabled());
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

/** Where a camera stands, the point it looks at and its vertical field of view. */
export type Framing = {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
};

/** The chat's Portrait camera preset for `avatar` in its current pose. */
export function chatPortraitFraming(avatar: Avatar): Framing {
  return chatCameraFraming(avatar, "portrait");
}

/** A chat camera preset for `avatar` in its current pose. */
export function chatCameraFraming(
  avatar: Avatar,
  preset: SceneCameraPreset,
): Framing {
  const { position, orbitTarget, fov } = buildSceneCameraPreset(preset, {
    avatar,
  }).settings;
  return {
    position: new THREE.Vector3(position.x, position.y, position.z),
    target: new THREE.Vector3(orbitTarget.x, orbitTarget.y, orbitTarget.z),
    fov,
  };
}

/** Add the chat canvas's scene lights (classic or enhanced) to `scene`. */
export function addChatLights(scene: THREE.Scene): void {
  const { ambientIntensity, directional } = avatarSceneLights(
    isEnhancedRenderingEnabled(),
  );
  scene.add(new THREE.AmbientLight(0xffffff, ambientIntensity));
  for (const light of directional) {
    const directionalLight = new THREE.DirectionalLight(
      new THREE.Color(light.color ?? "#ffffff"),
      light.intensity,
    );
    directionalLight.position.set(...light.position);
    scene.add(directionalLight);
  }
}

/**
 * A renderer, scene and camera configured like the chat canvas (`Scene.tsx`):
 * antialiasing, its tone mapping, sRGB output and scene lights, a
 * transparent clear and no stencil buffer. `pixelRatio` 1 keeps review sheets
 * at their tile size; the benchmark uses the chat's DPR.
 */
export function createStage(
  width: number,
  height: number,
  options: {
    pixelRatio?: number;
    preserveDrawingBuffer?: boolean;
    powerPreference?: WebGLPowerPreference;
  } = {},
) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    stencil: false,
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? true,
    ...(options.powerPreference
      ? { powerPreference: options.powerPreference }
      : {}),
  });
  renderer.setPixelRatio(options.pixelRatio ?? 1);
  renderer.setSize(width, height);
  applyChatColorPipeline(renderer);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  addChatLights(scene);
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.01, 20);
  return { renderer, scene, camera };
}
