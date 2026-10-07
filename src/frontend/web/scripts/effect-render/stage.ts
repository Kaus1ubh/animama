import * as THREE from "three";

import { parseAvatarEffectDefinition } from "@/lib/avatar/vfx/definition";
import { DEFAULT_SCENE_LIGHTS } from "@/ui/main/canvas/sceneCameraPresets";

/*
 * Stage and effect parsing shared by the review renderer (`render.ts`) and
 * the frame-cost benchmark (`../effect-bench/bench.ts`).
 */

export type EffectSource = {
  stem: string;
  contentId: string;
  name: string;
  description: string;
  definition: Record<string, unknown>;
  imageUrl: string;
  /** Served `art.otherEyeImage`, when the definition names one. */
  otherImageUrl: string | null;
};

/**
 * A renderer, scene and camera configured like the chat canvas (`Scene.tsx`):
 * antialiasing, ACES Filmic, sRGB output, the default scene lights, a
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
  // React Three Fiber defaults used by the chat canvas (`Scene.tsx`).
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(
    new THREE.AmbientLight(0xffffff, DEFAULT_SCENE_LIGHTS.ambientIntensity),
  );
  for (const light of DEFAULT_SCENE_LIGHTS.directional) {
    const directional = new THREE.DirectionalLight(0xffffff, light.intensity);
    directional.position.set(...light.position);
    scene.add(directional);
  }
  const camera = new THREE.PerspectiveCamera(35, width / height, 0.01, 20);
  return { renderer, scene, camera };
}

/** Parse a source the same way runtime catalog loading parses a stored `/2` definition. */
export function effectEntry(effect: EffectSource) {
  return parseAvatarEffectDefinition(effect.definition, {
    id: effect.contentId,
    label: effect.name,
    description: effect.description || effect.name,
    assetPath: effect.imageUrl,
    ...(effect.otherImageUrl
      ? { otherEyeAssetPath: effect.otherImageUrl }
      : {}),
  });
}
