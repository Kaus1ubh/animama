import type { AvatarIssue } from "../diagnostics/issues";
import type {
  AvatarEffectAppearance,
  AvatarEffectDefinitionV2,
  AvatarEffectFlipbook,
  AvatarEffectSpin,
  BodyAttachment,
  FaceLandmarkAttachment,
  FaceSurfaceAttachment,
  SilhouetteAttachment,
  StickerAttachment,
} from "@animama/runtime-contracts/api-types";
import {
  zAvatarEffectDefinitionV2,
  zFaceSurfaceAttachment,
} from "@animama/runtime-contracts/validators";

/*
 * Definition enums come from the generated `animama/avatar-effect/2` contract
 * (backend `app/contracts/avatar_effect.py`). The remaining kinds below
 * (`hover`, `face_anchored`, `texture` and their variants) describe the
 * controller's internal render entries, which the definition parser produces.
 */

/** Detected face parts an effect can paint on or hide. */
export const AVATAR_VFX_TARGET_ROLES =
  zFaceSurfaceAttachment.shape.part.options;
export type AvatarVFXTargetRole = FaceSurfaceAttachment["part"];

export type AvatarVFXAssetShape = "single_eye" | "double_eye" | "full_face";

export type AvatarVFXApplyMode = NonNullable<FaceSurfaceAttachment["mode"]>;

export const AVATAR_VFX_RENDER_MODES = ["texture", "hover_plane"] as const;
export type AvatarVFXRenderMode = (typeof AVATAR_VFX_RENDER_MODES)[number];

export type AvatarVFXKind = "hover" | "face_anchored" | "texture";

export type AvatarVFXHoverKind = "eye_hover" | "mouth_hover" | "box_hover";

export type AvatarVFXTextureAnchor = "undereye" | "blush" | "mouth";

/**
 * Attachments beyond the face. Each uses the region of the same name, needs no
 * face part, and coexists with face effects and with each other up to a cap.
 */
export type AvatarVFXAttachmentKind = Extract<
  AvatarEffectDefinitionV2["attachment"]["kind"],
  "body" | "sticker" | "silhouette"
>;

/** Face regions; body, sticker and silhouette have their own attachments. */
export const AVATAR_VFX_REGIONS =
  zAvatarEffectDefinitionV2.shape.region.options.filter(
    (region): region is AvatarVFXRegion =>
      region !== "body" && region !== "sticker" && region !== "silhouette",
  );
export type AvatarVFXRegion = Exclude<
  AvatarEffectDefinitionV2["region"],
  AvatarVFXAttachmentKind
>;

export const AVATAR_VFX_STACKABLE_REGIONS = [
  "emote",
  "full_face",
] as const satisfies readonly AvatarVFXRegion[];

export type AvatarVFXTextureLayout = NonNullable<
  FaceSurfaceAttachment["layout"]
>;

export type AvatarVFXTexturePivot = NonNullable<FaceSurfaceAttachment["pivot"]>;

export type AvatarVFXSide = NonNullable<FaceSurfaceAttachment["side"]>;

/** Internal names for the `/2` forehead, top and top-edge landmark positions. */
export type AvatarVFXHoverPlacement =
  | "forehead-left"
  | "forehead-middle"
  | "forehead-right"
  | "top-left"
  | "top-middle"
  | "top-right"
  | "top-edge-left-corner"
  | "top-edge-left"
  | "top-edge-middle"
  | "top-edge-right"
  | "top-edge-right-corner";

export type AvatarVFXLandmarkPosition = NonNullable<
  FaceLandmarkAttachment["position"]
>;

export const AVATAR_VFX_ANIMATION_PRESETS = [
  "none",
  "pulse",
  "spin",
  "drift",
  "pulse_spin",
] as const;
export type AvatarVFXAnimationPreset =
  (typeof AVATAR_VFX_ANIMATION_PRESETS)[number];

export type AvatarVFXRotationDirection = NonNullable<
  AvatarEffectSpin["direction"]
>;

export type AvatarVFXBlend = NonNullable<AvatarEffectAppearance["blend"]>;

/** Resolved appearance; opacity is multiplied by keyframes and event fades. */
export type AvatarVFXAppearance = {
  opacity: number;
  /** `#rrggbb` multiplied into the art, or null for none. */
  tint: string | null;
  blend: AvatarVFXBlend;
};

/** Frames laid out left to right, top to bottom on a grid in the image. */
export type AvatarVFXFlipbook = {
  columns: number;
  rows: number;
  frames: number;
  fps: number;
  loop: NonNullable<AvatarEffectFlipbook["loop"]>;
};

/** One keyframe; rotation is in radians internally. */
export type AvatarVFXKeyframe = {
  t: number;
  opacity?: number;
  scale?: number;
  rotation?: number;
  offset?: { x: number; y: number };
};

export type AvatarVFXKeyframes = {
  loop: boolean;
  frames: AvatarVFXKeyframe[];
};

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
  sound?: AvatarVFXSoundConfig;
  /** Opacity, tint and blend; absent means fully opaque, untinted and normal. */
  appearance?: AvatarVFXAppearance;
  /** Unmirrored art for the mirrored eye or side, when the effect has one. */
  otherEyeAssetPath?: string;
  flipbook?: AvatarVFXFlipbook;
  keyframes?: AvatarVFXKeyframes;
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

/** Art, appearance and motion shared by body, sticker and silhouette entries. */
type AvatarVFXAttachmentBaseEntry = {
  id: string;
  label: string;
  description: string;
  assetPath: string;
  appearance: AvatarVFXAppearance;
  animationConfig?: AvatarVFXAnimationConfig;
  sound?: AvatarVFXSoundConfig;
  flipbook?: AvatarVFXFlipbook;
  keyframes?: AvatarVFXKeyframes;
};

export type AvatarVFXBodyBone = BodyAttachment["bone"];

/**
 * A plane on a humanoid body point. `offset` is in metres in the bone's frame
 * (+x toward the viewer's right when facing the avatar, +y up, +z forward);
 * `size` is the plane height in metres; `rotation` turns it in its own plane.
 */
export type AvatarBodyVFXEntry = AvatarVFXAttachmentBaseEntry & {
  kind: "body";
  region: "body";
  bone: AvatarVFXBodyBone;
  offset: AvatarVFXTransformAxisTriple;
  size: number;
  facing: NonNullable<BodyAttachment["facing"]>;
  /** Radians. */
  rotation: number;
};

/**
 * A camera-facing image beside the avatar that follows it. `offset` and `size`
 * are fractions of the avatar's height; `offset` is in the screen plane.
 */
export type AvatarStickerVFXEntry = AvatarVFXAttachmentBaseEntry & {
  kind: "sticker";
  region: "sticker";
  around: NonNullable<StickerAttachment["around"]>;
  offset: { x: number; y: number };
  size: number;
  /** Radians. */
  rotation: number;
};

/**
 * Art drawn only over the avatar's visible pixels. `pattern` tiles the art in
 * screen space (one tile is `patternScale` quarters of the avatar's on-screen
 * height); `tint` fills with the art's average colour. `scroll` is in tiles
 * per second.
 */
export type AvatarSilhouetteVFXEntry = AvatarVFXAttachmentBaseEntry & {
  kind: "silhouette";
  region: "silhouette";
  fill: NonNullable<SilhouetteAttachment["fill"]>;
  patternScale: number;
  scroll: { x: number; y: number };
};

export type AvatarVFXAttachmentEntry =
  | AvatarBodyVFXEntry
  | AvatarStickerVFXEntry
  | AvatarSilhouetteVFXEntry;

/** Everything the definition parser can produce. */
export type AvatarVFXParsedEntry =
  | AvatarVFXCatalogEntry
  | AvatarVFXAttachmentEntry;

/**
 * Placement an applied effect can change in place, without reloading its art
 * (`AvatarVFXController.updateEffectTransform`). Face effects carry their
 * transform (rotations in radians); body and sticker effects their offset,
 * size and in-plane rotation (radians). Silhouettes have no placement.
 */
export type AvatarVFXEffectTransform =
  | { kind: "face"; transform: AvatarVFXTransform }
  | {
      kind: "body";
      offset: AvatarVFXTransformAxisTriple;
      size: number;
      rotation: number;
    }
  | {
      kind: "sticker";
      offset: { x: number; y: number };
      size: number;
      rotation: number;
    };

/** The placement of a parsed entry, or null for a silhouette. */
export function avatarVFXEffectTransformOf(
  effect: AvatarVFXParsedEntry,
): AvatarVFXEffectTransform | null {
  if (effect.kind === "silhouette") return null;
  if (effect.kind === "body")
    return {
      kind: "body",
      offset: { ...effect.offset },
      size: effect.size,
      rotation: effect.rotation,
    };
  if (effect.kind === "sticker")
    return {
      kind: "sticker",
      offset: { ...effect.offset },
      size: effect.size,
      rotation: effect.rotation,
    };
  return {
    kind: "face",
    transform: {
      offset: { ...effect.transform.offset },
      scale: { ...effect.transform.scale },
      rotation: { ...effect.transform.rotation },
    },
  };
}

export function isAttachmentVFXEntry(
  effect: AvatarVFXParsedEntry,
): effect is AvatarVFXAttachmentEntry {
  return (
    effect.kind === "body" ||
    effect.kind === "sticker" ||
    effect.kind === "silhouette"
  );
}

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
    /** Where each eye's art may draw, when its cell reaches past its iris. */
    clip?: {
      left: AvatarVFXNormalizedRect;
      right: AvatarVFXNormalizedRect;
    };
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
  /** Primary role; a corrected face part comes first. */
  targetRole: AvatarVFXTargetRole;
  /** Every role the mesh serves, primary first. */
  targetRoles: AvatarVFXTargetRole[];
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

/** How an attachment effect is drawn. */
export type AvatarVFXAttachmentRenderMode =
  | "body_plane"
  | "sticker_plane"
  | "silhouette_overlay";

/** One active body, sticker or silhouette effect, oldest first. */
export type AvatarVFXAttachmentEffectSnapshot = {
  appliedEffectId: string;
  effectId: string;
  effectLabel: string;
  attachmentKind: AvatarVFXAttachmentKind;
  renderMode: AvatarVFXAttachmentRenderMode;
  animationPreset: AvatarVFXAnimationPreset | null;
  /** The resolved body bone, sticker root or overlaid primitive count. */
  target: string;
};

export type AvatarVFXSnapshot = {
  catalog: AvatarVFXCatalogEntry[];
  targetBindings: AvatarVFXTargetBindingSnapshot[];
  /** Face effects, which live on face-part bindings. */
  activeEffects: AvatarVFXAppliedEffectSnapshot[];
  /** Body, sticker and silhouette effects. */
  attachmentEffects: AvatarVFXAttachmentEffectSnapshot[];
  flatten: AvatarVFXFaceFlattenSnapshot;
  warnings: string[];
  /** `warnings` as stable codes, for the Diagnostics view. */
  issues: AvatarIssue[];
};

/**
 * Small read-only projection for playback observation and browser journeys.
 * It deliberately excludes catalog entries, bindings, transforms, and media.
 */
export type AvatarVFXObservationSnapshot = {
  activeEffects: Array<{
    effectId: string;
    /** The face part, or the attachment kind for body, sticker and silhouette. */
    targetRole: AvatarVFXTargetRole | AvatarVFXAttachmentKind;
    animationPreset: AvatarVFXAnimationPreset | null;
    renderMode: AvatarVFXRenderMode | AvatarVFXAttachmentRenderMode;
  }>;
  warningCount: number;
};

const AVATAR_VFX_REGION_SET = new Set<string>(AVATAR_VFX_REGIONS);

const AVATAR_VFX_STACKABLE_REGION_SET = new Set<string>(
  AVATAR_VFX_STACKABLE_REGIONS,
);

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
