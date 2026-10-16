import type * as THREE from "three";
import { create } from "zustand";
import type { MToonMaterial } from "@pixiv/three-vrm";

import {
  readDebugSetting,
  writeDebugSetting,
  type AvatarShaderId,
} from "./avatarShader";
import { vroidLookFor, type ToonLook } from "./vroidPalette";

/*
 * Development-only look multipliers for the experimental Avatar shaders, set
 * from the debug panel. Every value defaults to 1, which reproduces the
 * shaders as tuned; production builds never read or change them.
 */

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
};

export type AvatarShaderLookKey = keyof AvatarShaderLook;

type LookControl = {
  key: AvatarShaderLookKey;
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
  for (const { key, min, max } of AVATAR_SHADER_LOOK_CONTROLS) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      look[key] = Math.min(max, Math.max(min, value));
    }
  }
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

type Rgb = [number, number, number];

/** Move a shadow colour away from (or towards) white; 0 gives white. */
function deepenShade(rgb: Rgb, strength: number): Rgb {
  // Written so the tuned colour stays exact at the default strength of 1.
  return rgb.map((c) =>
    Math.min(1, Math.max(0, c + (1 - c) * (1 - strength))),
  ) as Rgb;
}

function scaleRgb(rgb: readonly number[], factor: number): Rgb {
  return rgb.map((value) => value * factor) as Rgb;
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

/** lilToon's shadow, rim and outline properties for a look. */
export function lilToonLookProperties(
  look: ToonLook,
  settings: AvatarShaderLook,
): Record<string, number | number[]> {
  const [r, g, b] = look.shade;
  return {
    _ShadowColor: [...deepenShade(look.shade, settings.shadow), 1],
    _Shadow2ndColor: [
      ...deepenShade([r * 0.8, g * 0.75, b * 0.85], settings.shadow),
      0.6,
    ],
    _RimColor: [...scaleRgb(look.rim, 2.5 * settings.rim), 1],
    _OutlineWidth: (look.kind === "face" ? 0.05 : 0.1) * settings.outline,
  };
}

type LilToonLike = THREE.Material & {
  isLilToonMaterial: true;
  setProperty(name: string, value: number | number[]): unknown;
};

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
 * Apply look multipliers to an Avatar loaded with `shader`. Only VRoid
 * materials with a palette look change; default MToon is never touched.
 */
export function applyAvatarShaderLook(
  root: THREE.Object3D,
  shader: AvatarShaderId,
  settings: AvatarShaderLook,
): void {
  if (shader === "mtoon") return;
  forEachMaterial(root, (material) => {
    const look = vroidLookFor(material.name);
    if (!look) return;
    if ((material as Partial<LilToonLike>).isLilToonMaterial) {
      const lil = material as LilToonLike;
      for (const [name, value] of Object.entries(
        lilToonLookProperties(look, settings),
      )) {
        lil.setProperty(name, value);
      }
    } else if (
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
