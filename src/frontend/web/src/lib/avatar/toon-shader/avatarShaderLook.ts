import type * as THREE from "three";
import { create } from "zustand";
import type { MToonMaterial } from "@pixiv/three-vrm";

import {
  readDebugSetting,
  writeDebugSetting,
  type AvatarShaderId,
} from "./avatarShader";
import {
  LIL_TOON_PRESETS,
  deepenShade,
  lilToonBaseProperties,
  lilToonLookProperties,
  lilToonOutlineUsesSurface,
  scaleRgb,
  type LilToonPreset,
} from "./lilToonLook";
import { vroidLookFor, type ToonLook } from "./vroidPalette";

/*
 * Development-only look settings for the experimental Avatar shaders, set
 * from the debug panel. The defaults reproduce the shaders as tuned (every
 * multiplier 1, ACES, no canvas filter); production builds never read or
 * change them.
 */

export const AVATAR_TONE_MAPPINGS = ["aces", "neutral"] as const;

export type AvatarToneMapping = (typeof AVATAR_TONE_MAPPINGS)[number];

export type AvatarShaderLook = {
  /** Tone-mapping exposure on the Avatar canvases. */
  exposure: number;
  /** Chat canvas ambient light intensity multiplier. */
  ambientLight: number;
  /** Chat canvas directional (key) light intensity multiplier. */
  keyLight: number;
  /** Shadow colour depth: 0 removes shading, above 1 darkens it. */
  shadow: number;
  rim: number;
  outline: number;
  /** lilToon property recipe (`lilToonLook.ts`). */
  lilToonPreset: LilToonPreset;
  /** Tone-mapping curve on the Avatar canvases, lilToon included. */
  toneMapping: AvatarToneMapping;
  /** Chat canvas CSS filter: slightly brighter, softer and less saturated. */
  softGrade: boolean;
  /** Chat canvas CSS filter: a soft white glow around the silhouette. */
  edgeGlow: boolean;
};

/** The look settings a slider controls. */
export type AvatarShaderLookNumberKey = {
  [K in keyof AvatarShaderLook]: AvatarShaderLook[K] extends number ? K : never;
}[keyof AvatarShaderLook];

type LookControl = {
  key: AvatarShaderLookNumberKey;
  label: string;
  min: number;
  max: number;
  step: number;
  /** Whether the control only affects MToon tuned and lilToon materials. */
  toonOnly: boolean;
};

export const AVATAR_SHADER_LOOK_CONTROLS: readonly LookControl[] = [
  {
    key: "exposure",
    label: "Exposure",
    min: 0.4,
    max: 1.6,
    step: 0.05,
    toonOnly: false,
  },
  {
    key: "ambientLight",
    label: "Ambient light",
    min: 0,
    max: 2,
    step: 0.05,
    toonOnly: false,
  },
  {
    key: "keyLight",
    label: "Key light",
    min: 0,
    max: 2,
    step: 0.05,
    toonOnly: false,
  },
  {
    key: "shadow",
    label: "Shadow",
    min: 0,
    max: 2,
    step: 0.05,
    toonOnly: true,
  },
  {
    key: "rim",
    label: "Rim light",
    min: 0,
    max: 2,
    step: 0.05,
    toonOnly: true,
  },
  {
    key: "outline",
    label: "Outline width",
    min: 0,
    max: 2,
    step: 0.05,
    toonOnly: true,
  },
];

export const DEFAULT_AVATAR_SHADER_LOOK: AvatarShaderLook = {
  exposure: 1,
  ambientLight: 1,
  keyLight: 1,
  shadow: 1,
  rim: 1,
  outline: 1,
  lilToonPreset: "current",
  toneMapping: "aces",
  softGrade: false,
  edgeGlow: false,
};

/**
 * What choosing a preset sets: its lilToon recipe plus the lighting and
 * renderer settings that go with it. Each stays adjustable afterwards.
 */
export const AVATAR_SHADER_LOOK_PRESETS: Record<
  LilToonPreset,
  Partial<AvatarShaderLook>
> = {
  current: {
    lilToonPreset: "current",
    exposure: 1,
    ambientLight: 1,
    keyLight: 1,
    toneMapping: "aces",
    softGrade: false,
    edgeGlow: false,
  },
  nilotoon: {
    lilToonPreset: "nilotoon",
    exposure: 1.1,
    ambientLight: 1.4,
    keyLight: 0.8,
    toneMapping: "neutral",
    softGrade: true,
    edgeGlow: true,
  },
};

const LOOK_STORAGE_KEY = "animama.debug.avatarShaderLook";

/** Stored look values, each clamped to its control's range. */
export function parseAvatarShaderLook(stored: string | null): AvatarShaderLook {
  const look = { ...DEFAULT_AVATAR_SHADER_LOOK };
  let parsed: unknown = null;
  try {
    parsed = stored ? JSON.parse(stored) : null;
  } catch {
    return look;
  }
  if (!parsed || typeof parsed !== "object") return look;
  const values = parsed as Record<string, unknown>;
  for (const { key, min, max } of AVATAR_SHADER_LOOK_CONTROLS) {
    const value = values[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      look[key] = Math.min(max, Math.max(min, value));
    }
  }
  if (LIL_TOON_PRESETS.includes(values.lilToonPreset as LilToonPreset)) {
    look.lilToonPreset = values.lilToonPreset as LilToonPreset;
  }
  if (AVATAR_TONE_MAPPINGS.includes(values.toneMapping as AvatarToneMapping)) {
    look.toneMapping = values.toneMapping as AvatarToneMapping;
  }
  if (typeof values.softGrade === "boolean") look.softGrade = values.softGrade;
  if (typeof values.edgeGlow === "boolean") look.edgeGlow = values.edgeGlow;
  return look;
}

type AvatarShaderLookState = {
  look: AvatarShaderLook;
  setLook: (changes: Partial<AvatarShaderLook>) => void;
  resetLook: () => void;
};

export const useAvatarShaderLookStore = create<AvatarShaderLookState>(
  (set, get) => {
    const save = (look: AvatarShaderLook) => {
      writeDebugSetting(LOOK_STORAGE_KEY, JSON.stringify(look));
      set({ look });
    };
    return {
      look: parseAvatarShaderLook(readDebugSetting(LOOK_STORAGE_KEY)),
      setLook: (changes) => save({ ...get().look, ...changes }),
      resetLook: () => save({ ...DEFAULT_AVATAR_SHADER_LOOK }),
    };
  },
);

export function getAvatarShaderLook(): AvatarShaderLook {
  return useAvatarShaderLookStore.getState().look;
}

/**
 * The chat canvas's CSS filter for the soft grade and edge glow toggles.
 * They stand in for colour grading and bloom, which a transparent canvas
 * and lilToon's in-shader tone mapping make costly to do in WebGL.
 */
export function avatarCanvasFilter(look: AvatarShaderLook): string | undefined {
  const filters = [
    look.softGrade ? "brightness(1.04) contrast(0.92) saturate(0.88)" : "",
    look.edgeGlow ? "drop-shadow(0 0 6px rgba(255, 255, 255, 0.55))" : "",
  ].filter(Boolean);
  return filters.length ? filters.join(" ") : undefined;
}

/** Screen-space MToon outline widths (fraction of view height) per look. */
const MTOON_OUTLINE_WIDTH: Record<ToonLook["kind"], number> = {
  face: 0.0035,
  skin: 0.0045,
  cloth: 0.0045,
  hair: 0.004,
};

/** Tuned MToon's shade, rim and outline values for a look. */
export function tunedMToonLook(look: ToonLook, settings: AvatarShaderLook) {
  return {
    shade: deepenShade(look.shade, settings.shadow),
    rim: scaleRgb(look.rim, settings.rim),
    outlineWidth: MTOON_OUTLINE_WIDTH[look.kind] * settings.outline,
  };
}

/** Every lilToon property a converted material gets from the look. */
export function lilToonMaterialProperties(
  materialName: string,
  settings: AvatarShaderLook,
): Record<string, number | number[]> {
  const look = vroidLookFor(materialName);
  return {
    ...lilToonBaseProperties(settings.lilToonPreset),
    ...(look
      ? lilToonLookProperties(look, settings.lilToonPreset, settings)
      : {}),
  };
}

/** The `_OutlineTex` a converted material should use: its surface or none. */
export function lilToonOutlineTexture<T>(
  map: T | null,
  settings: AvatarShaderLook,
): T | null {
  return lilToonOutlineUsesSurface(settings.lilToonPreset) ? map : null;
}

type LilToonLike = THREE.Material & {
  isLilToonMaterial: true;
  map: THREE.Texture | null;
  lilToonProperties: Record<string, unknown>;
  lilToonTextures: Record<string, THREE.Texture | null | undefined>;
  setProperty(name: string, value: number | number[]): unknown;
  setTexture(name: string, texture: THREE.Texture | null): unknown;
};

function sameValue(current: unknown, next: number | number[]): boolean {
  if (!Array.isArray(next)) return current === next;
  return (
    Array.isArray(current) &&
    current.length === next.length &&
    next.every((value, index) => current[index] === value)
  );
}

/**
 * Update a lilToon material, skipping unchanged values: each change can
 * rebuild its program key, and a slider drag repeats most values.
 */
function applyLilToonLook(lil: LilToonLike, settings: AvatarShaderLook): void {
  for (const [name, value] of Object.entries(
    lilToonMaterialProperties(lil.name, settings),
  )) {
    if (!sameValue(lil.lilToonProperties[name], value)) {
      lil.setProperty(name, value);
    }
  }
  if (!vroidLookFor(lil.name)) return;
  const outlineTexture = lilToonOutlineTexture(lil.map, settings);
  if ((lil.lilToonTextures._OutlineTex ?? null) !== outlineTexture) {
    lil.setTexture("_OutlineTex", outlineTexture);
  }
}

const SHADER_KEY = "animamaAvatarShader";

function forEachMaterial(
  root: THREE.Object3D,
  visit: (material: THREE.Material) => void,
): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(
      visit,
    );
  });
}

/**
 * Apply the look to an Avatar loaded with `shader`: every lilToon material,
 * and VRoid palette materials under tuned MToon. Default MToon is never
 * touched.
 */
export function applyAvatarShaderLook(
  root: THREE.Object3D,
  shader: AvatarShaderId,
  settings: AvatarShaderLook,
): void {
  if (shader === "mtoon") return;
  forEachMaterial(root, (material) => {
    if ((material as Partial<LilToonLike>).isLilToonMaterial) {
      applyLilToonLook(material as LilToonLike, settings);
      return;
    }
    const look = vroidLookFor(material.name);
    if (!look) return;
    if (
      shader === "mtoon-tuned" &&
      (material as Partial<MToonMaterial>).isMToonMaterial
    ) {
      const mtoon = material as MToonMaterial;
      const values = tunedMToonLook(look, settings);
      mtoon.shadeColorFactor.setRGB(...values.shade);
      mtoon.parametricRimColorFactor.setRGB(...values.rim);
      mtoon.outlineWidthFactor = values.outlineWidth;
    }
  });
}

const trackedRoots = new Set<WeakRef<THREE.Object3D>>();
let applyQueued = false;

function applyToTrackedRoots(): void {
  applyQueued = false;
  const settings = getAvatarShaderLook();
  for (const ref of trackedRoots) {
    const root = ref.deref();
    if (!root) {
      trackedRoots.delete(ref);
      continue;
    }
    applyAvatarShaderLook(root, root.userData[SHADER_KEY], settings);
  }
}

/**
 * Keep a loaded Avatar's materials following the look sliders. Held weakly,
 * so a disposed Avatar drops out once collected.
 */
export function trackAvatarShaderLook(
  root: THREE.Object3D,
  shader: AvatarShaderId,
): void {
  if (!import.meta.env.DEV || shader === "mtoon") return;
  root.userData[SHADER_KEY] = shader;
  trackedRoots.add(new WeakRef(root));
}

if (import.meta.env.DEV) {
  // A slider drag fires per pointer move; apply at most once a frame.
  useAvatarShaderLookStore.subscribe(() => {
    if (applyQueued) return;
    applyQueued = true;
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(applyToTrackedRoots);
    } else {
      setTimeout(applyToTrackedRoots, 0);
    }
  });
}
