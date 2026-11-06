import type { Avatar } from "@/lib/avatar";
import type {
  PresentationPreferences,
  SettingsPreferences,
} from "@/lib/settings/preferences";

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

/** Presets in menu order; the camera controls word each one. */
export const SCENE_CAMERA_PRESETS: readonly SceneCameraPreset[] = [
  "full-body",
  "full-body-close",
  "portrait",
  "portrait-close",
];

/** Whether `value` names a chat camera preset, for untrusted input. */
export function isSceneCameraPreset(
  value: unknown,
): value is SceneCameraPreset {
  return SCENE_CAMERA_PRESETS.some((preset) => preset === value);
}

/** The PiP window's preset until the owner picks another. */
export const DEFAULT_PIP_SCENE_CAMERA_PRESET: SceneCameraPreset =
  "portrait-close";

/** The window whose camera preset is saved: the chat canvas or desktop PiP. */
export type SceneCameraPresetWindow = "main" | "pip";

/** Where each window's preset is saved under user `presentation` preferences. */
const SAVED_SCENE_CAMERA_PRESET_KEYS = {
  main: "camera_preset",
  pip: "pip_camera_preset",
} as const satisfies Record<
  SceneCameraPresetWindow,
  keyof PresentationPreferences
>;

/** The window's saved preset, or null when none is saved or it is unknown. */
export function readSavedSceneCameraPreset(
  preferences: SettingsPreferences | null,
  target: SceneCameraPresetWindow,
): SceneCameraPreset | null {
  const saved =
    preferences?.presentation?.[SAVED_SCENE_CAMERA_PRESET_KEYS[target]];
  return isSceneCameraPreset(saved) ? saved : null;
}

/** A user preferences patch that saves the window's preset. */
export function savedSceneCameraPresetPatch(
  target: SceneCameraPresetWindow,
  preset: SceneCameraPreset,
): SettingsPreferences {
  return {
    presentation: { [SAVED_SCENE_CAMERA_PRESET_KEYS[target]]: preset },
  };
}

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

/** Ambient and directional lights for an Avatar canvas. */
export type AvatarSceneLights = {
  ambientIntensity: number;
  directional: readonly {
    position: readonly [number, number, number];
    intensity: number;
    /** CSS colour; white when omitted. */
    color?: string;
  }[];
};

/** The classic lighting: one white key light from the upper right. */
export const DEFAULT_SCENE_LIGHTS: AvatarSceneLights = {
  ambientIntensity: 0.7,
  directional: [{ position: [3, 4, 2], intensity: 1.1 }],
};

/**
 * Three-point lighting for enhanced rendering: a warm key from the front
 * right, a cool fill from the left and a white rim light from behind.
 */
export const ENHANCED_SCENE_LIGHTS: AvatarSceneLights = {
  ambientIntensity: 0.5,
  directional: [
    { position: [1.6, 2.4, 2.6], intensity: 1.3, color: "#fff3e6" },
    { position: [-2.5, 1, 2], intensity: 0.35, color: "#e6ecff" },
    { position: [-1.5, 2.5, -3], intensity: 0.6, color: "#ffffff" },
  ],
};

/** The lights for classic or enhanced rendering. */
export function avatarSceneLights(enhanced: boolean): AvatarSceneLights {
  return enhanced ? ENHANCED_SCENE_LIGHTS : DEFAULT_SCENE_LIGHTS;
}

/**
 * The widest Portrait framing, against the body's framing scale: Full body
 * (close)'s distance (2.2 m) over Portrait's (1.6 m), so it shows no more.
 */
const PORTRAIT_WIDEST = 2.2 / 1.6;

/**
 * The widest Portrait (close) framing, against Portrait's scale: 1.5 times
 * its 0.8 m is three quarters of Portrait's 1.6 m.
 */
const PORTRAIT_CLOSE_WIDEST = 1.5;

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
  // Presets are framed for the Included Avatars. Portrait presets scale their
  // offsets from the head bone and their distance by the head's framing
  // scale, so a big head (chibi, mascot, robot) shows its face, not its chin.
  // Full-body presets scale their camera and aim about the floor by the
  // body's, so a short chibi fills the frame and its head stays in view.
  // Both are 1 on the Included Avatars (`avatarProportions.ts`).
  const avatar = options?.avatar;
  const head = avatar?.getHeadFramingScale() ?? 1;
  const body = avatar?.getBodyFramingScale() ?? 1;
  // A chibi's face is half its height, so framing by the face alone would
  // show more than Full body: Portrait shows no more than Full body (close),
  // and Portrait (close) no more than three quarters of Portrait. On adult
  // proportions the head and body scales match and neither limit applies.
  const portrait = Math.min(head, PORTRAIT_WIDEST * body);
  const portraitClose = Math.min(head, PORTRAIT_CLOSE_WIDEST * portrait);
  // Aim at a big head's centre (hat included) rather than its head bone at
  // the skull's base, so the top of the head stays in view; 0 for adults.
  const aim = avatar?.getHeadFramingCenter() ?? 0;

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
          position: { x: 0, y: 1.2 * body, z: 3.2 * body },
          fov: 35,
          orbitTarget: { x: 0, y: 1.0 * body, z: 0 },
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
          position: { x: 0, y: 1.2 * body, z: 2.2 * body },
          fov: 35,
          orbitTarget: { x: 0, y: 1.0 * body, z: 0 },
        },
      };
    case "portrait":
      return {
        bindings: {
          positionYBone: "head",
          positionYOffset: aim,
          orbitTargetYBone: "head",
          orbitTargetYOffset: aim - 0.1 * portrait,
        },
        settings: {
          // Leave enough headroom for Reaction VFX while retaining a facial
          // expression-focused composition.
          position: { x: 0, y: headY + aim, z: 1.6 * portrait },
          fov: 35,
          orbitTarget: { x: 0, y: headY + aim - 0.1 * portrait, z: 0 },
        },
      };
    case "portrait-close":
      return {
        bindings: {
          positionYBone: "head",
          positionYOffset: aim,
          orbitTargetYBone: "head",
          orbitTargetYOffset: aim,
        },
        settings: {
          position: { x: 0, y: headY + aim, z: 0.8 * portraitClose },
          fov: 35,
          orbitTarget: { x: 0, y: headY + aim, z: 0 },
        },
      };
  }
}

/**
 * Views creator previews add to the chat presets. Chat keeps
 * {@link SCENE_CAMERA_PRESETS}; these are not offered there.
 */
export type CreatorCameraPreset = SceneCameraPreset | "portrait-three-quarter";

/** Horizontal angle of the three-quarter view, toward the viewer's right. */
const THREE_QUARTER_ANGLE = (40 * Math.PI) / 180;

/** Chat presets, plus a close three-quarter view of the face for creators. */
export function buildCreatorCameraPreset(
  preset: CreatorCameraPreset,
  options?: Parameters<typeof buildSceneCameraPreset>[1],
): SceneCameraPresetState {
  if (preset !== "portrait-three-quarter")
    return buildSceneCameraPreset(preset, options);
  const close = buildSceneCameraPreset("portrait-close", options);
  const { position, orbitTarget } = close.settings;
  const distance = position.z - orbitTarget.z;
  return {
    bindings: close.bindings,
    settings: {
      ...close.settings,
      position: {
        x: orbitTarget.x + Math.sin(THREE_QUARTER_ANGLE) * distance,
        y: position.y,
        z: orbitTarget.z + Math.cos(THREE_QUARTER_ANGLE) * distance,
      },
    },
  };
}
