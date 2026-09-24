import type { EmotionValue } from "@/lib/emotion";

export const AVATAR_VFX_TARGET_ROLES = [
  "eye_iris",
  "eye_highlight",
  "eyeline",
  "eyelash",
  "face_skin",
] as const;
export type AvatarVFXTargetRole = (typeof AVATAR_VFX_TARGET_ROLES)[number];

export const AVATAR_VFX_ASSET_SHAPES = [
  "single_eye",
  "double_eye",
  "full_face",
] as const;
export type AvatarVFXAssetShape = (typeof AVATAR_VFX_ASSET_SHAPES)[number];

export const AVATAR_VFX_APPLY_MODES = ["replace", "overlay"] as const;
export type AvatarVFXApplyMode = (typeof AVATAR_VFX_APPLY_MODES)[number];

export const AVATAR_VFX_RENDER_MODES = ["texture", "hover_plane"] as const;
export type AvatarVFXRenderMode = (typeof AVATAR_VFX_RENDER_MODES)[number];

export const AVATAR_VFX_KINDS = ["hover", "face_anchored", "texture"] as const;
export type AvatarVFXKind = (typeof AVATAR_VFX_KINDS)[number];

export const AVATAR_VFX_HOVER_KINDS = [
  "eye_hover",
  "mouth_hover",
  "box_hover",
] as const;
export type AvatarVFXHoverKind = (typeof AVATAR_VFX_HOVER_KINDS)[number];

export const AVATAR_VFX_TEXTURE_ANCHORS = [
  "undereye",
  "blush",
  "mouth",
] as const;
export type AvatarVFXTextureAnchor =
  (typeof AVATAR_VFX_TEXTURE_ANCHORS)[number];

export const AVATAR_VFX_REGIONS = [
  "eyes",
  "undereye",
  "blush",
  "mouth",
  "emote",
  "full_face",
] as const;
export type AvatarVFXRegion = (typeof AVATAR_VFX_REGIONS)[number];

export const AVATAR_VFX_STACKABLE_REGIONS = [
  "emote",
  "full_face",
] as const satisfies readonly AvatarVFXRegion[];

export const AVATAR_VFX_TEXTURE_LAYOUTS = ["single", "span"] as const;
export type AvatarVFXTextureLayout =
  (typeof AVATAR_VFX_TEXTURE_LAYOUTS)[number];

export const AVATAR_VFX_TEXTURE_PIVOTS = [
  "top-left",
  "top-center",
  "top-right",
  "center-left",
  "center",
  "center-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;
export type AvatarVFXTexturePivot = (typeof AVATAR_VFX_TEXTURE_PIVOTS)[number];

export const AVATAR_VFX_SIDES = ["left", "right"] as const;
export type AvatarVFXSide = (typeof AVATAR_VFX_SIDES)[number];

export const AVATAR_VFX_HOVER_PLACEMENTS = [
  "forehead-left",
  "forehead-middle",
  "forehead-right",
  "top-left",
  "top-middle",
  "top-right",
  "top-edge-left-corner",
  "top-edge-left",
  "top-edge-middle",
  "top-edge-right",
  "top-edge-right-corner",
] as const;
export type AvatarVFXHoverPlacement =
  (typeof AVATAR_VFX_HOVER_PLACEMENTS)[number];

export const AVATAR_VFX_ANIMATION_PRESETS = [
  "none",
  "pulse",
  "spin",
  "drift",
  "pulse_spin",
] as const;
export type AvatarVFXAnimationPreset =
  (typeof AVATAR_VFX_ANIMATION_PRESETS)[number];

export const AVATAR_VFX_ROTATION_DIRECTIONS = [
  "counterclockwise",
  "clockwise",
] as const;
export type AvatarVFXRotationDirection =
  (typeof AVATAR_VFX_ROTATION_DIRECTIONS)[number];

export const AVATAR_VFX_LIFETIME_KINDS = ["duration", "turns"] as const;

export type AvatarVFXTransformAxisTriple = {
  x: number;
  y: number;
  z: number;
};

export type AvatarVFXTransform = {
  offset: AvatarVFXTransformAxisTriple;
  scale: AvatarVFXTransformAxisTriple;
  rotation: AvatarVFXTransformAxisTriple;
};

export type AvatarVFXAnimationConfig = {
  pulseScaleMin?: number;
  pulseScaleMax?: number;
  pulseCyclesPerSecond?: number;
  rotationAmountTurns?: number;
  rotationRadiansPerSecond?: number;
  rotationDirection?: AvatarVFXRotationDirection;
  driftPerSecond?: {
    x?: number;
    y?: number;
  };
};

export type AvatarVFXDurationLifetime = {
  kind: "duration";
  runEndBufferSec: number;
};

export type AvatarVFXTurnsLifetime = {
  kind: "turns";
  turns: number;
};

export type AvatarVFXLifetime =
  | AvatarVFXDurationLifetime
  | AvatarVFXTurnsLifetime;

export type AvatarVFXResolvedAnimationConfig = {
  pulseEnabled: boolean;
  pulseScaleMin: number;
  pulseScaleMax: number;
  pulseCyclesPerSecond: number;
  spinEnabled: boolean;
  rotationAmountTurns: number;
  rotationRadiansPerSecond: number;
  rotationDirection: AvatarVFXRotationDirection;
  driftEnabled: boolean;
  driftPerSecond: {
    x: number;
    y: number;
  };
};

export type AvatarVFXTextureSlot = "map" | "shadeMultiplyTexture";

export type AvatarVFXFlattenColorSnapshot = {
  r: number;
  g: number;
  b: number;
  a: number;
  cssColor: string;
};

export type AvatarVFXFaceFlattenSnapshot = {
  status: "unavailable" | "ready";
  faceBindingKey: string | null;
  previewEyes: boolean;
  previewMouth: boolean;
  autoEyes: boolean;
  autoMouth: boolean;
  activeEyes: boolean;
  activeMouth: boolean;
  sampledColor: AvatarVFXFlattenColorSnapshot | null;
  warning: string | null;
};

export type AvatarVFXSoundConfig = {
  onApply?: string;
};

type AvatarVFXBaseEntry = {
  id: string;
  label: string;
  description: string;
  assetPath: string;
  region: AvatarVFXRegion;
  transform: AvatarVFXTransform;
  animationConfig?: AvatarVFXAnimationConfig;
  emotions?: EmotionValue[];
  lifetime?: AvatarVFXLifetime;
  sound?: AvatarVFXSoundConfig;
};

type AvatarVFXCanDisableRoles = {
  disableTargetRoles?: AvatarVFXTargetRole[];
};

export type AvatarEyeHoverVFXEntry = AvatarVFXBaseEntry &
  AvatarVFXCanDisableRoles & {
    kind: "hover";
    hoverKind: "eye_hover";
    /** Close the original eyes while the effect is active; defaults to true. */
    forceBlink?: boolean;
    /** Hide eye highlights, lines and lashes in addition to explicit roles; defaults to true. */
    autoDisableEyeMaterials?: boolean;
    /** Cover painted eye detail with sampled skin color; defaults to true. */
    faceCleanup?: boolean;
    side?: AvatarVFXSide;
    requiresMirror?: boolean;
    skinBackdrop?: boolean;
  };

export type AvatarMouthHoverVFXEntry = AvatarVFXBaseEntry & {
  kind: "hover";
  hoverKind: "mouth_hover";
  /** Cover painted mouth detail with sampled skin color; defaults to true. */
  faceCleanup?: boolean;
  skinBackdrop?: boolean;
};

export type AvatarBoxHoverVFXEntry = AvatarVFXBaseEntry & {
  kind: "hover";
  hoverKind: "box_hover";
  placement: AvatarVFXHoverPlacement;
};

export type AvatarHoverVFXEntry =
  | AvatarEyeHoverVFXEntry
  | AvatarMouthHoverVFXEntry
  | AvatarBoxHoverVFXEntry;

type AvatarFaceAnchoredVFXBaseEntry = AvatarVFXBaseEntry & {
  kind: "face_anchored";
  anchor: AvatarVFXTextureAnchor;
  pivot?: AvatarVFXTexturePivot;
};

export type AvatarFaceAnchoredSingleDecalVFXEntry =
  AvatarFaceAnchoredVFXBaseEntry & {
    anchor: "undereye" | "blush";
    layout: "single";
    side: AvatarVFXSide;
    requiresMirror?: boolean;
  };

export type AvatarFaceAnchoredSpanDecalVFXEntry =
  AvatarFaceAnchoredVFXBaseEntry & {
    anchor: "undereye" | "blush";
    layout: "span";
  };

export type AvatarFaceAnchoredMouthVFXEntry = AvatarFaceAnchoredVFXBaseEntry & {
  anchor: "mouth";
  /** Cover painted mouth detail with sampled skin color; defaults to true. */
  faceCleanup?: boolean;
};

export type AvatarFaceAnchoredVFXEntry =
  | AvatarFaceAnchoredSingleDecalVFXEntry
  | AvatarFaceAnchoredSpanDecalVFXEntry
  | AvatarFaceAnchoredMouthVFXEntry;

export type AvatarTextureVFXEntry = AvatarVFXBaseEntry &
  AvatarVFXCanDisableRoles & {
    kind: "texture";
    targetRole: AvatarVFXTargetRole;
    assetShape: AvatarVFXAssetShape;
    applyMode: AvatarVFXApplyMode;
    side?: AvatarVFXSide;
    requiresMirror?: boolean;
  };

export type AvatarVFXCatalogEntry =
  | AvatarHoverVFXEntry
  | AvatarFaceAnchoredVFXEntry
  | AvatarTextureVFXEntry;

export type AvatarVFXNormalizedRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AvatarVFXModelProfile = {
  sourceKeys?: string[];
  sourceUrls?: string[];
  eyeHighlightMaterialPatterns?: RegExp[];
  eyelineMaterialPatterns?: RegExp[];
  eyelashMaterialPatterns?: RegExp[];
  eyeMaterialPatterns?: RegExp[];
  faceMaterialPatterns?: RegExp[];
  eyeLayout?: {
    left: AvatarVFXNormalizedRect;
    right: AvatarVFXNormalizedRect;
    mirrorRight: boolean;
  };
  faceLayout?: {
    rect: AvatarVFXNormalizedRect;
  };
};

export type AvatarVFXTargetBindingTextureSlot = {
  slot: AvatarVFXTextureSlot;
  width: number | null;
  height: number | null;
  sizeLabel: string | null;
  canOverlay: boolean;
};

export type AvatarVFXTargetBindingSnapshot = {
  bindingKey: string;
  targetRole: AvatarVFXTargetRole;
  materialIndex: number | null;
  materialName: string | null;
  objectName: string | null;
  objectType: string;
  textureSlots: AvatarVFXTargetBindingTextureSlot[];
  availableEffectIds: string[];
  activeEffectId: string | null;
  activeEffectIds: string[];
  activeEffectCount: number;
  activeAnimationPreset: AvatarVFXAnimationPreset | null;
  activeApplyMode: AvatarVFXApplyMode | null;
  warning: string | null;
};

export type AvatarVFXAppliedEffectSnapshot = {
  appliedEffectId: string;
  bindingKey: string;
  targetRole: AvatarVFXTargetRole;
  materialName: string | null;
  effectId: string;
  effectLabel: string;
  renderMode: AvatarVFXRenderMode;
  animationPreset: AvatarVFXAnimationPreset | null;
  applyMode: AvatarVFXApplyMode | null;
  effect: AvatarVFXCatalogEntry;
  transform: AvatarVFXTransform;
  animationConfig: AvatarVFXResolvedAnimationConfig;
};

export type AvatarVFXSnapshot = {
  catalog: AvatarVFXCatalogEntry[];
  targetBindings: AvatarVFXTargetBindingSnapshot[];
  activeEffects: AvatarVFXAppliedEffectSnapshot[];
  flatten: AvatarVFXFaceFlattenSnapshot;
  warnings: string[];
};

/**
 * Small read-only projection for playback observation and browser journeys.
 * It deliberately excludes catalog entries, bindings, transforms, and media.
 */
export type AvatarVFXObservationSnapshot = {
  activeEffects: Array<{
    effectId: string;
    targetRole: AvatarVFXTargetRole;
    animationPreset: AvatarVFXAnimationPreset | null;
    renderMode: AvatarVFXRenderMode;
  }>;
  warningCount: number;
};

const AVATAR_VFX_REGION_SET = new Set<string>(AVATAR_VFX_REGIONS);

const AVATAR_VFX_STACKABLE_REGION_SET = new Set<string>(
  AVATAR_VFX_STACKABLE_REGIONS,
);

export const DEFAULT_AVATAR_VFX_DURATION_LIFETIME =
  Object.freeze<AvatarVFXDurationLifetime>({
    kind: "duration",
    runEndBufferSec: 5,
  });

export function isAvatarVFXRegion(value: unknown): value is AvatarVFXRegion {
  return typeof value === "string" && AVATAR_VFX_REGION_SET.has(value);
}

export function isAvatarVFXRegionStackable(region: AvatarVFXRegion): boolean {
  return AVATAR_VFX_STACKABLE_REGION_SET.has(region);
}

export function isHoverVFXEntry(
  effect: AvatarVFXCatalogEntry,
): effect is AvatarHoverVFXEntry {
  return effect.kind === "hover";
}

export function isEyeHoverVFXEntry(
  effect: AvatarVFXCatalogEntry,
): effect is AvatarEyeHoverVFXEntry {
  return effect.kind === "hover" && effect.hoverKind === "eye_hover";
}

export function isBoxHoverVFXEntry(
  effect: AvatarVFXCatalogEntry,
): effect is AvatarBoxHoverVFXEntry {
  return effect.kind === "hover" && effect.hoverKind === "box_hover";
}

export function isMouthHoverVFXEntry(
  effect: AvatarVFXCatalogEntry,
): effect is AvatarMouthHoverVFXEntry {
  return effect.kind === "hover" && effect.hoverKind === "mouth_hover";
}

export function isFaceAnchoredVFXEntry(
  effect: AvatarVFXCatalogEntry,
): effect is AvatarFaceAnchoredVFXEntry {
  return effect.kind === "face_anchored";
}

export function isTextureVFXEntry(
  effect: AvatarVFXCatalogEntry,
): effect is AvatarTextureVFXEntry {
  return effect.kind === "texture";
}

export function getAvatarVFXRenderMode(
  effect: AvatarVFXCatalogEntry,
): AvatarVFXRenderMode {
  return effect.kind === "hover" ? "hover_plane" : "texture";
}

export function getAvatarVFXRegion(
  effect: AvatarVFXCatalogEntry,
): AvatarVFXRegion {
  return effect.region;
}

export function getAvatarVFXLifetime(
  effect: AvatarVFXCatalogEntry,
): AvatarVFXLifetime | null {
  return effect.lifetime ?? null;
}

export function getAvatarVFXTargetRole(
  effect: AvatarVFXCatalogEntry,
): AvatarVFXTargetRole {
  if (effect.kind === "texture") {
    return effect.targetRole;
  }
  if (effect.kind === "face_anchored") {
    return "face_skin";
  }
  return effect.hoverKind === "eye_hover" ? "eye_iris" : "face_skin";
}

export function getAvatarVFXApplyMode(
  effect: AvatarVFXCatalogEntry,
): AvatarVFXApplyMode | null {
  if (effect.kind === "texture") {
    return effect.applyMode;
  }
  if (effect.kind === "face_anchored") {
    return "overlay";
  }
  return null;
}

export function isEmotionSelectableVFXEntry(
  effect: AvatarVFXCatalogEntry,
): effect is AvatarVFXCatalogEntry & {
  emotions: EmotionValue[];
  lifetime: AvatarVFXLifetime;
} {
  return (
    Array.isArray(effect.emotions) &&
    effect.emotions.length > 0 &&
    effect.lifetime !== undefined
  );
}
